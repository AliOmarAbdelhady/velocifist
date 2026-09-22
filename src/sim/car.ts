// VELOCIFIST vehicle dynamics — deterministic arcade bicycle model (PLAN §6).
//
// Frame conventions (locked in M0, PILL 009):
//   heading h: forward vector = (sin h, −cos h) in world (x,z); h = 0 faces −z.
//   +x = screen right; turning right ⇒ heading increases.
// Body-frame velocities: u (forward), w (lateral, + = toward car's right).
// Tire model: F(α) = μ·Fz·sin(B·atan(C·α)) per axle — simplified Pacejka with
// progressive grip loss past ~7° slip. Grip circle clamps lateral capacity by
// the longitudinal force already used (throttle/brake) per axle ⇒ power
// oversteer for RWD, braking understeer — the "feel" layer emerges from physics,
// not scripts. Semi-implicit Euler at a fixed step; no allocations in step().

import type { DriverIntent } from './intent';
import type { Projection, RoadGuide, SpinePoint } from './road';

export interface CarTune {
  id: string;
  name: string;
  drivetrain: 'RWD' | 'AWD';
  /** kg */
  mass: number;
  /** yaw moment of inertia, kg·m² */
  iz: number;
  /** CG → front axle, m */
  a: number;
  /** CG → rear axle, m */
  b: number;
  /** CG height, m (longitudinal weight transfer) */
  hCg: number;
  /** tire friction coefficients */
  muFront: number;
  muRear: number;
  /** tire curve shape (shared per axle for now) */
  stiffB: number;
  stiffC: number;
  /** aero grip bonus at vMax, e.g. 0.2 = +20% lateral grip at top speed */
  downforce: number;
  /** max road-wheel steer at standstill, rad */
  deltaMax: number;
  /** speed at which steering authority halves, m/s */
  steerFadeSpeed: number;
  /** road-wheel steering slew rate, rad/s */
  steerRate: number;
  /** engine power, W (force = P/v above the launch cap) */
  powerW: number;
  /** traction-limited launch force, N */
  launchForce: number;
  /** drive force fraction on the front axle (0 = RWD) */
  driveSplitFront: number;
  /** top speed, m/s — physics headroom only (drag balance, test bounds) */
  vMax: number;
  /** ADR-012 cruise cap, m/s — the soft limiter and gear spread anchor;
   *  full gas plateaus here (80 km/h class, old-arcade constant cruise) */
  vCruise: number;
  /** quadratic drag coefficient, N/(m/s)² */
  dragK: number;
  /** rolling resistance, N */
  rollForce: number;
  /** total brake force, N (split below, grip-clamped per axle) */
  brakeForce: number;
  brakeSplitFront: number;
  /** drivable half width before grass, m */
  roadHalfWidth: number;
  healthMax: number;
  /** validation targets (PLAN §6.3, ADR-012 cruise regime):
   *  targetCruise = 0→75 km/h seconds, targetBrake = 75→0 metres */
  targetCruise: number;
  targetBrake: number;
  /** visuals */
  bodyDims: [number, number, number];
  color: number;
}

const G = 9.81;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

const GEAR_FRACTIONS = [0, 0.085, 0.165, 0.25, 0.345, 0.47, 0.62, 1.0001];

// reused projection scratch (module scope: zero allocation per step)
const CAR_PROJ: Projection = { s: 0, lat: 0 };
const CAR_SPINE: SpinePoint = { x: 0, z: 0, heading: 0 };

export class Car {
  // world pose
  x = 0;
  z = 0;
  heading = 0;
  // body velocities
  u = 0; // forward, m/s
  w = 0; // lateral (right+), m/s
  omega = 0; // yaw rate, rad/s (+ = turning right)
  steer = 0; // current road-wheel angle, rad
  distance = 0; // odometer, m
  // derived / for downstream systems
  axLast = 0; // forward body accel, m/s² (pitch visuals, transfer)
  ayLast = 0; // lateral body accel incl. centripetal, m/s² (roll visuals)
  beta = 0; // sideslip angle, rad
  rearSlip = 0; // rear-axle lateral saturation 0..1 (drift FX later)
  gear = 1; // 1..7
  rpmNorm = 0; // 0..1 (engine audio in M6)
  /** Curved-world guide (M4): when set, off-road + soft wall use the lateral
   *  offset from the road spine instead of |x|. Null = straight road (tests). */
  guide: RoadGuide | null = null;
  /** EASY MODE (user directive, ADR-008): lane-keep + stability assists are
   *  always on in the game. Tests opt out for raw-dynamics gates. */
  laneAssist = true;
  /** engine power multiplier (damage CRITICAL state sets 0.92) */
  powerScale = 1;
  /** last driver intent (audio + brake lights read these; derived state,
   *  not part of the dynamics hash) */
  throttleIn = 0;
  brakeIn = 0;
  /** surface flag from the last step (audio rumble + FX read it) */
  offRoadLast = false;
  readonly tune: CarTune;

  constructor(tune: CarTune) {
    this.tune = tune;
  }

  step(dt: number, intent: DriverIntent): void {
    const t = this.tune;
    this.throttleIn = intent.throttle;
    this.brakeIn = intent.brake;

    // ---- surface + aero ----
    // curved world: measure the road-frame lateral offset when a guide is set
    let latAbs: number;
    let latSigned = 0;
    if (this.guide) {
      this.guide.project(this.x, this.z, CAR_PROJ);
      latSigned = CAR_PROJ.lat;
      latAbs = Math.abs(latSigned);
    } else {
      latAbs = Math.abs(this.x);
    }
    const offRoad = latAbs > t.roadHalfWidth;
    this.offRoadLast = offRoad;
    // EASY: grass punishes less — recoverable, not a run-ender
    const gripScale = offRoad ? 0.7 : 1;
    // downforce: supercars literally stick more the faster they go
    // (normalized over the CRUISE cap, ADR-012 — full stick at 80 km/h)
    const speedFrac = Math.min(1, Math.abs(this.u) / t.vCruise);
    const aero = 1 + t.downforce * speedFrac * speedFrac;

    // ---- steering: speed-sensitive range, slew-limited, slide assist ----
    const dMax = t.deltaMax / (1 + Math.abs(this.u) / t.steerFadeSpeed);
    let target = clamp(intent.steer, -1, 1) * dMax;
    if (this.rearSlip > 0.62 && Math.abs(this.beta) > 0.08) {
      // counter-steer assist (EASY: earlier + stronger than the M1 tune) —
      // only when the rear axle is genuinely saturated AND the body slides;
      // never during normal cornering (β is naturally nonzero there).
      target = clamp(target + 0.55 * this.beta * dMax, -dMax, dMax);
    }
    if (this.laneAssist && this.guide) {
      // EASY: lane-keep assist — steer toward the road heading ahead plus a
      // gentle centre-line pull. Full strength with quiet hands (|steer| <
      // 0.4), faded to 35% when the player is deliberately steering.
      this.guide.sample(CAR_PROJ.s + 14 + 0.24 * Math.abs(this.u), CAR_SPINE);
      let dh = CAR_SPINE.heading - this.heading;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      dh += clamp(-latSigned * 0.045, -0.14, 0.14); // drift back to centre
      const k = 0.7 * (Math.abs(intent.steer) < 0.4 ? 1 : 0.35);
      target = clamp(target + clamp(k * dh, -0.3, 0.3), -dMax * 1.15, dMax * 1.15);
    }
    const rate = t.steerRate * dt;
    this.steer += clamp(target - this.steer, -rate, rate);

    // ---- axle loads with longitudinal weight transfer ----
    const L = t.a + t.b;
    const FzTotal = t.mass * G;
    const transfer = clamp(this.axLast, -12, 12) * t.hCg * t.mass;
    const Fzf = Math.max((FzTotal * t.b - transfer) / L, 0.2 * ((FzTotal * t.b) / L));
    const Fzr = Math.max((FzTotal * t.a + transfer) / L, 0.2 * ((FzTotal * t.a) / L));

    // ---- longitudinal forces (per axle, grip-clamped) ----
    // drag opposes motion (sign-aware so coasting can never push the car backward)
    const drag = t.dragK * this.u * Math.abs(this.u);
    const sgnU = this.u >= 0 ? 1 : -1;
    const roll =
      (Math.abs(this.u) > 0.3 ? 1 : 0) * sgnU * t.rollForce +
      (offRoad ? sgnU * (500 + 18 * Math.abs(this.u)) : 0);
    // ADR-012 cruise regime: the limiter holds the car at vCruise (80 km/h
    // class) — full gas is a constant cruise like the old arcade racers,
    // never an ever-climbing speed. vMax stays as physics headroom only.
    const limiter = 1 - smoothstep(t.vCruise * 0.93, t.vCruise, Math.abs(this.u));
    const drive =
      Math.min(t.launchForce, t.powerW / Math.max(Math.abs(this.u), 4)) *
      intent.throttle *
      limiter *
      this.powerScale;
    // brake force is a decelerating (negative) contribution, split per axle
    const brakeFwd = -t.brakeForce * intent.brake;
    const muF = t.muFront * gripScale * aero;
    const muR = t.muRear * gripScale * aero;
    let FxF = drive * t.driveSplitFront + brakeFwd * t.brakeSplitFront;
    let FxR = drive * (1 - t.driveSplitFront) + brakeFwd * (1 - t.brakeSplitFront);
    FxF = clamp(FxF, -muF * Fzf, muF * Fzf);
    FxR = clamp(FxR, -muR * Fzr, muR * Fzr);
    const Fx = FxF + FxR - drag - roll;

    // ---- lateral tire forces with slip angles + grip circle ----
    // F(α) = μ·Fz·sin(C·atan(B·α)) — the classic simplified Pacejka. B (inside)
    // sets stiffness/peak slip (~10°); C (outside) sets the post-peak falloff
    // (→ ~59% at extreme slip = progressive, catchable slides).
    const absU = Math.max(Math.abs(this.u), 0.8);
    const sinD = Math.sin(this.steer);
    const cosD = Math.cos(this.steer);
    const slipF = (this.w + t.a * this.omega) * cosD - this.u * sinD;
    const slipR = this.w - t.b * this.omega;
    const aF = Math.atan2(slipF, absU);
    const aR = Math.atan2(slipR, absU);
    let FyF = -muF * Fzf * Math.sin(t.stiffC * Math.atan(t.stiffB * aF));
    let FyR = -muR * Fzr * Math.sin(t.stiffC * Math.atan(t.stiffB * aR));
    const capF = Math.sqrt(Math.max(0, muF * muF * Fzf * Fzf - FxF * FxF));
    const capR = Math.sqrt(Math.max(0, muR * muR * Fzr * Fzr - FxR * FxR));
    FyF = clamp(FyF, -capF, capF);
    FyR = clamp(FyR, -capR, capR);
    this.rearSlip = capR > 1e-3 ? Math.min(1, Math.abs(FyR) / capR) : 0;

    // ---- body-frame integration (semi-implicit) ----
    const m = t.mass;
    const Ffwd = Fx - FyF * sinD;
    const Fright = FyF * cosD + FyR;
    const ax = Ffwd / m + this.w * this.omega;
    const aw = Fright / m - this.u * this.omega;
    this.u += ax * dt;
    // no reverse this milestone: braking stops at zero (reverse gear is out of scope)
    if (this.u < 0) this.u = 0;
    this.w += aw * dt;
    // EASY: stronger scrub/yaw damping — the car actively refuses to spin
    // (ESC-plus: kills slides fast, leaves normal cornering untouched)
    this.w *= Math.max(0, 1 - 0.5 * dt);
    this.omega += ((t.a * FyF * cosD - t.b * FyR) / t.iz) * dt;
    this.omega *= Math.max(0, 1 - (0.55 + 1.8 * this.rearSlip) * dt);
    this.heading += this.omega * dt;

    // world integration (forward = (sin h, −cos h), right = (cos h, sin h))
    this.x += (this.u * Math.sin(this.heading) + this.w * Math.cos(this.heading)) * dt;
    this.z -= (this.u * Math.cos(this.heading) - this.w * Math.sin(this.heading)) * dt;
    this.distance += Math.abs(this.u) * dt;

    // soft guardrail (real OBB collision lands in M3)
    const wall = t.roadHalfWidth + 0.9;
    if (this.guide) {
      if (latAbs > wall - 2) {
        // near/past the rail on a curve: re-project AFTER integration (the
        // start-of-step projection would reposition against a stale spine point)
        this.guide.project(this.x, this.z, CAR_PROJ);
        latSigned = CAR_PROJ.lat;
        latAbs = Math.abs(latSigned);
      }
    } else {
      latSigned = this.x; // fresh post-integration position
      latAbs = Math.abs(latSigned);
    }
    if (latAbs > wall) {
      if (this.guide) {
        // push back onto the corridor in the road frame (right = (cos h, sin h))
        this.guide.sample(CAR_PROJ.s, CAR_SPINE);
        const rx = Math.cos(CAR_SPINE.heading);
        const rz = Math.sin(CAR_SPINE.heading);
        const newLat = Math.sign(latSigned) * wall;
        this.x = CAR_SPINE.x + rx * newLat;
        this.z = CAR_SPINE.z + rz * newLat;
      } else {
        this.x = Math.sign(this.x) * wall;
      }
      this.w *= -0.12; // EASY: guardrail grazes scrub speed gently
      this.u *= 0.99;
      this.omega *= 0.45;
    }

    // derived state
    this.axLast = ax;
    this.ayLast = aw + this.u * this.omega;
    this.beta = this.u > 2 ? Math.atan2(this.w, Math.abs(this.u)) : 0;

    // drivetrain (HUD/audio): 7 gears spread across the CRUISE cap — 80 km/h
    // is top of 7th, so held gas sings at high rpm instead of idling mid-box
    const vf = clamp(Math.abs(this.u) / t.vCruise, 0, 0.9999);
    let g = 1;
    while (g < 7 && vf >= GEAR_FRACTIONS[g]) g++;
    this.gear = g;
    const lo = GEAR_FRACTIONS[g - 1];
    const hi = GEAR_FRACTIONS[g];
    this.rpmNorm = clamp(0.25 + 0.75 * ((vf - lo) / (hi - lo)), 0, 1);
  }

  /** Determinism probe (dev/test only — allocates). */
  hash(): string {
    const buf = new Float64Array(1);
    const view = new DataView(buf.buffer);
    let h = 0x811c9dc5;
    for (const v of [this.x, this.z, this.heading, this.u, this.w, this.omega, this.steer, this.distance]) {
      buf[0] = v;
      view.setFloat64(0, v);
      for (let i = 0; i < 8; i++) {
        h ^= view.getUint8(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    }
    return h.toString(16).padStart(8, '0');
  }
}
