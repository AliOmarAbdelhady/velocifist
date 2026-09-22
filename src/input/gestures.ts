// GestureSolver — the virtual steering wheel + pedals (PLAN §5).
//
// Conventions (all coords mirrored: screen-left = player-left, y down):
//   · wheelAngleDeg: + = counter-clockwise = LEFT turn (right hand over left).
//     DriverIntent.steer stays car-convention (+ = right), so steer = −curve(w).
//   · grip ∈ [0,1] per hand from finger-curl + thumb-across, scale-normalized
//     by hand size (person- and distance-independent).
//   · Displacement-vector formulation: v = (R−aR) − (L−aL). Pure translations
//     cancel; there is NO angle-wrap problem when hands cross — atan2 covers
//     the full ±180° naturally.
// Pure module except injected persistence (save/load). No per-frame allocation.

import type { DriverIntent } from '../sim/intent';
import { LM } from './handTypes';
import type { HandPair } from './handTracks';
import { OneEuro, DEFAULT_ONE_EURO } from './oneEuro';

export interface GestureConfig {
  /** grip above → fist; below → released (hysteresis band = dead zone) */
  fistOn: number;
  fistOff: number;
  /** majority vote window / threshold */
  voteWindow: number;
  voteMin: number;
  /** wheel dead zone (deg), lock (deg), response curve exponent */
  wheelDeadzoneDeg: number;
  wheelLockDeg: number;
  wheelCurveExp: number;
  /** wheel angle slew limit, deg/s */
  wheelRateDeg: number;
  /** hands farther than this × wheel radius from wheel center lose authority */
  zoneRadiusFactor: number;
  /** regrip window, s */
  regripWindow: number;
  /** hands fully lost → AUTO-HOLD after this, s */
  handsLostGrace: number;
  /** auto-hold brake level */
  autoHoldBrake: number;
  /** pedal slews, 1/s */
  throttleRamp: number;
  brakeRamp: number;
  coastDecay: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  fistOn: 0.72,
  fistOff: 0.52,
  voteWindow: 5,
  voteMin: 3,
  wheelDeadzoneDeg: 28,
  wheelLockDeg: 100,
  wheelCurveExp: 1.35,
  wheelRateDeg: 430,
  zoneRadiusFactor: 1.8,
  regripWindow: 1.2,
  handsLostGrace: 0.9,
  autoHoldBrake: 0.35,
  throttleRamp: 3,
  brakeRamp: 4,
  coastDecay: 2,
};

export interface CalibrationData {
  anchorLx: number;
  anchorLy: number;
  anchorRx: number;
  anchorRy: number;
  shoulderRef: number;
}

export type SolverStatus =
  | 'UNCALIBRATED'
  | 'CALIBRATING'
  | 'TRACKING'
  | 'PARTIAL'
  | 'HANDS_LOST';

const CAL_FRAMES = 75; // ~2.5 s at 30 fps
const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** Continuous grip metric from 21 landmarks (PLAN §5.4). */
export function computeGrip(d: Float32Array): number {
  // hand scale: wrist → middle MCP (robust to person size and camera distance)
  const sx = d[LM.MIDDLE_MCP * 3] - d[LM.WRIST * 3];
  const sy = d[LM.MIDDLE_MCP * 3 + 1] - d[LM.WRIST * 3 + 1];
  const handScale = Math.max(1e-4, Math.hypot(sx, sy));

  let curlSum = 0;
  const fingers: Array<[number, number, number]> = [
    [LM.INDEX_MCP, LM.INDEX_PIP, LM.INDEX_TIP],
    [LM.MIDDLE_MCP, LM.MIDDLE_PIP, LM.MIDDLE_TIP],
    [13, LM.RING_PIP, LM.RING_TIP],
    [17, LM.PINKY_PIP, LM.PINKY_TIP],
  ];
  for (const [m, p, tp] of fingers) {
    const ux = d[p * 3] - d[m * 3];
    const uy = d[p * 3 + 1] - d[m * 3 + 1];
    const vx = d[tp * 3] - d[p * 3];
    const vy = d[tp * 3 + 1] - d[p * 3 + 1];
    const nu = Math.hypot(ux, uy);
    const nv = Math.hypot(vx, vy);
    const cos = clamp((ux * vx + uy * vy) / Math.max(1e-6, nu * nv), -1, 1);
    // extended finger: segments aligned → angle ≈ 0 → curl 0; folded: ≈ π → curl 1
    curlSum += Math.acos(cos) / Math.PI;
  }
  const tx = d[LM.THUMB_TIP * 3] - d[LM.INDEX_MCP * 3];
  const ty = d[LM.THUMB_TIP * 3 + 1] - d[LM.INDEX_MCP * 3 + 1];
  const thumbAcross = 1 - clamp(Math.hypot(tx, ty) / handScale / 1.1, 0, 1);
  return 0.85 * (curlSum / 4) + 0.15 * thumbAcross;
}

/** Hysteresis + majority-vote fist detector for one hand. */
class FistDetector {
  private state = false;
  private rawState = false;
  private ring: boolean[] = [];

  update(grip: number, cfg: GestureConfig): boolean {
    if (grip > cfg.fistOn) this.rawState = true;
    else if (grip < cfg.fistOff) this.rawState = false;
    this.ring.push(this.rawState);
    if (this.ring.length > cfg.voteWindow) this.ring.shift();
    let votes = 0;
    for (const v of this.ring) if (v) votes++;
    this.state = votes >= cfg.voteMin;
    return this.state;
  }

  reset(): void {
    this.state = false;
    this.rawState = false;
    this.ring.length = 0;
  }
}

export interface SolverState {
  status: SolverStatus;
  wheelAngleDeg: number;
  gripL: number;
  gripR: number;
  fistL: boolean;
  fistR: boolean;
  zoneAuthority: number;
  confidence: number;
  latencyHintMs: number;
  /** seconds since both hands were confidently seen (AR countdown / glow) */
  handsAgeS: number;
}

export class GestureSolver {
  readonly intent: DriverIntent = { steer: 0, throttle: 0, brake: 0 };

  private readonly cfg: GestureConfig;
  private calib: CalibrationData | null = null;
  private calibAccum: Float64Array | null = null;
  private calibFrames = 0;
  private calibrating = false;

  private readonly fistL = new FistDetector();
  private readonly fistR = new FistDetector();
  private readonly fxL = new OneEuro({ ...DEFAULT_ONE_EURO });
  private readonly fyL = new OneEuro({ ...DEFAULT_ONE_EURO });
  private readonly fxR = new OneEuro({ ...DEFAULT_ONE_EURO });
  private readonly fyR = new OneEuro({ ...DEFAULT_ONE_EURO });

  private wheelAngle = 0; // deg, + = left
  private gripLv = 0;
  private gripRv = 0;
  private zone = 0;
  private status: SolverStatus = 'UNCALIBRATED';
  private conf = 0;
  private lastDriveTime = -1e9;
  private lastSeenTime = -1e9;
  private tPrev = -1;
  private readonly saveCalib: (c: CalibrationData) => void;

  constructor(
    cfg: Partial<GestureConfig> = {},
    persistence: {
      load?: () => CalibrationData | null;
      save?: (c: CalibrationData) => void;
    } = {},
  ) {
    this.cfg = { ...DEFAULT_GESTURE_CONFIG, ...cfg };
    this.saveCalib = persistence.save ?? (() => undefined);
    this.calib = persistence.load?.() ?? null;
    if (this.calib) this.status = 'HANDS_LOST';
  }

  get calibrated(): boolean {
    return this.calib !== null;
  }

  get calibrationProgress(): number {
    return this.calibrating ? this.calibFrames / CAL_FRAMES : this.calibrated ? 1 : 0;
  }

  beginCalibration(): void {
    this.calibrating = true;
    this.calibFrames = 0;
    this.calibAccum = new Float64Array(4);
    this.status = 'CALIBRATING';
  }

  get state(): SolverState {
    return {
      status: this.status,
      wheelAngleDeg: this.wheelAngle,
      gripL: this.gripLv,
      gripR: this.gripRv,
      fistL: this.fistStateL,
      fistR: this.fistStateR,
      zoneAuthority: this.zone,
      confidence: this.conf,
      latencyHintMs: 0,
      handsAgeS: this.tPrev - this.lastSeenTime,
    };
  }

  private fistStateL = false;
  private fistStateR = false;

  update(pair: HandPair, t: number): void {
    const dt = this.tPrev < 0 ? 0.033 : clamp(t - this.tPrev, 1e-3, 0.2);
    this.tPrev = t;

    const both = pair.left !== null && pair.right !== null;
    const any = pair.left !== null || pair.right !== null;
    if (any) this.lastSeenTime = t;

    // ---- calibration capture ----
    if (this.calibrating) {
      if (both && pair.confidence > 0.35) {
        const acc = this.calibAccum!;
        acc[0] += pair.left!.data[0];
        acc[1] += pair.left!.data[1];
        acc[2] += pair.right!.data[0];
        acc[3] += pair.right!.data[1];
        this.calibFrames++;
        if (this.calibFrames >= CAL_FRAMES) {
          const n = this.calibFrames;
          const c: CalibrationData = {
            anchorLx: acc[0] / n,
            anchorLy: acc[1] / n,
            anchorRx: acc[2] / n,
            anchorRy: acc[3] / n,
            shoulderRef: 0.3,
          };
          c.shoulderRef = clamp(Math.abs(c.anchorRx - c.anchorLx), 0.12, 0.6);
          this.calib = c;
          this.calibrating = false;
          this.saveCalib(c);
          this.status = 'TRACKING';
        }
      }
      this.zeroPedals(dt);
      return;
    }

    if (!this.calib) {
      this.status = 'UNCALIBRATED';
      this.zeroPedals(dt);
      return;
    }

    // ---- grip per hand ----
    if (pair.left) {
      this.gripLv = computeGrip(pair.left.data);
      this.fistStateL = this.fistL.update(this.gripLv, this.cfg);
    } else {
      this.gripLv = 0;
      this.fistStateL = this.fistL.update(0.0, this.cfg); // drains the vote ring
    }
    if (pair.right) {
      this.gripRv = computeGrip(pair.right.data);
      this.fistStateR = this.fistR.update(this.gripRv, this.cfg);
    } else {
      this.gripRv = 0;
      this.fistStateR = this.fistR.update(0.0, this.cfg);
    }

    // ---- steering wheel (needs both hands) ----
    let target = 0;
    let zone = 0;
    if (both) {
      const c = this.calib;
      const lx = this.fxL.filter(pair.left!.data[0], t);
      const ly = this.fyL.filter(pair.left!.data[1], t);
      const rx = this.fxR.filter(pair.right!.data[0], t);
      const ry = this.fyR.filter(pair.right!.data[1], t);
      const vx = (rx - c.anchorRx) - (lx - c.anchorLx);
      const vy = (ry - c.anchorRy) - (ly - c.anchorLy);
      // magnitude gate first: at neutral, v ≈ 0 and atan2 of noise is ±90°+
      // (singularity). |v| ≈ shoulderRef × wheel-angle-rad, so gate ≈ 6°–10°.
      const magN = Math.hypot(vx, vy) / Math.max(0.05, c.shoulderRef);
      const magGate = clamp((magN - 0.105) / 0.07, 0, 1);
      const ang = magN > 1e-4 ? (-Math.atan2(vy, vx) * 180) / Math.PI : 0;
      target = clamp(ang, -this.cfg.wheelLockDeg, this.cfg.wheelLockDeg) * magGate;
      // zone gating: fade authority when hands leave the wheel neighbourhood
      const cx = (c.anchorLx + c.anchorRx) / 2;
      const cy = (c.anchorLy + c.anchorRy) / 2;
      const radius = Math.max(0.05, c.shoulderRef / 2);
      const dmax = Math.max(Math.hypot(lx - cx, ly - cy), Math.hypot(rx - cx, ry - cy));
      const fadeStart = this.cfg.zoneRadiusFactor * radius;
      zone = clamp((fadeStart + 0.3 * radius - dmax) / (0.3 * radius), 0, 1);
    }
    this.zone = zone;
    const slew = this.cfg.wheelRateDeg * dt;
    this.wheelAngle += clamp(target - this.wheelAngle, -slew, slew);
    if (!any) this.wheelAngle *= Math.max(0, 1 - 0.5 * dt); // decay on loss

    const a = clamp(
      (Math.abs(this.wheelAngle) - this.cfg.wheelDeadzoneDeg) /
        (this.cfg.wheelLockDeg - this.cfg.wheelDeadzoneDeg),
      0,
      1,
    );
    const response = Math.pow(a, this.cfg.wheelCurveExp) * zone;
    this.intent.steer = -Math.sign(this.wheelAngle) * response;

    // ---- pedal FSM (regrip-aware, PLAN §5.5) ----
    const handsLost = t - this.lastSeenTime > this.cfg.handsLostGrace;
    if (handsLost) {
      this.status = 'HANDS_LOST';
    } else if (both) {
      this.status = 'TRACKING';
    } else {
      this.status = 'PARTIAL';
    }

    const inDrive = this.fistStateL && this.fistStateR;
    const oneFist = this.fistStateL !== this.fistStateR;
    const noFist = !this.fistStateL && !this.fistStateR;
    if (inDrive) this.lastDriveTime = t;
    const regrip = oneFist && t - this.lastDriveTime < this.cfg.regripWindow;
    // ROBUSTNESS (M7): one hand dropped out of frame while the other still
    // grips → HOLD everything. Detection flicker must not cut the throttle;
    // the missing hand was not "opened" (that would be a deliberate brake).
    const partialHold = oneFist && (!pair.left || !pair.right);

    if (handsLost) {
      // AUTO-HOLD: lift throttle, gentle brake, hold/decay steering
      this.intent.throttle = Math.max(0, this.intent.throttle - 5 * dt);
      this.intent.brake = approach(this.intent.brake, this.cfg.autoHoldBrake, 2 * dt);
    } else if (inDrive) {
      this.intent.brake = approach(this.intent.brake, 0, 5 * dt);
      this.intent.throttle = approach(this.intent.throttle, 1, this.cfg.throttleRamp * dt);
    } else if (regrip || partialHold) {
      // one palm opened mid-corner (hand-over-hand) or one hand flickered
      // out of frame: hold everything
    } else if (noFist && both) {
      // both palms intentionally open → brake
      this.intent.throttle = Math.max(0, this.intent.throttle - 5 * dt);
      this.intent.brake = approach(this.intent.brake, 1, this.cfg.brakeRamp * dt);
    } else {
      // coast / partial: decay throttle, release brake
      this.intent.throttle = Math.max(0, this.intent.throttle - this.cfg.coastDecay * dt);
      this.intent.brake = approach(this.intent.brake, 0, this.cfg.brakeRamp * dt);
    }

    this.conf = both ? pair.confidence * zone : any ? pair.confidence * 0.5 * zone : 0;
  }

  private zeroPedals(dt: number): void {
    this.intent.steer = 0;
    this.intent.throttle = Math.max(0, this.intent.throttle - 5 * dt);
    this.intent.brake = approach(this.intent.brake, 0, 5 * dt);
    this.conf = 0;
  }
}

function approach(v: number, target: number, maxStep: number): number {
  return v + clamp(target - v, -maxStep, maxStep);
}
