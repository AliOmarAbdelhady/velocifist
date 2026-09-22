// M2 gesture-system gates (PLAN §5.9, scripted half — the live tester-diverse
// half runs on real hardware with the calibration wizard).

import { describe, expect, it } from 'vitest';
import {
  GestureSolver,
  computeGrip,
  type CalibrationData,
} from '../src/input/gestures';
import type { HandPair } from '../src/input/handTracks';
import { makeFist, makeOpen, makeHand } from './helpers/handFixture';

const A_L: [number, number] = [0.35, 0.6];
const A_R: [number, number] = [0.65, 0.6];

const CALIB: CalibrationData = {
  anchorLx: 0.35,
  anchorLy: 0.6,
  anchorRx: 0.65,
  anchorRy: 0.6,
  shoulderRef: 0.3,
};

function pair(l: ReturnType<typeof makeFist> | null, r: ReturnType<typeof makeFist> | null, conf = 0.9): HandPair {
  return {
    left: l ? { data: l.data, confidence: conf } : null,
    right: r ? { data: r.data, confidence: conf } : null,
    confidence: conf,
  };
}

/** Place a hand as if gripping the wheel at angle `deg` around the calibrated center. */
function fistAt(side: 'L' | 'R', deg: number): ReturnType<typeof makeFist> {
  const c = 0.5; // wheel center x (anchors at 0.35/0.65, y 0.6)
  const r = 0.15;
  const base = side === 'L' ? 180 : 0; // left hand at 9 o'clock, right at 3
  const a = ((base + deg) * Math.PI) / 180;
  return makeFist([c + r * Math.cos(a), 0.6 - r * Math.sin(a)], side === 'L' ? 0 : 1);
}

function solver(): GestureSolver {
  return new GestureSolver(
    {},
    { load: () => ({ ...CALIB }) },
  );
}

describe('grip metric', () => {
  it('open hand scores low, fist scores high (both hands)', () => {
    expect(computeGrip(makeOpen([0.4, 0.6], 0).data)).toBeLessThan(0.35);
    expect(computeGrip(makeFist([0.4, 0.6], 0).data)).toBeGreaterThan(0.72);
    expect(computeGrip(makeOpen([0.6, 0.6], 1).data)).toBeLessThan(0.35);
    expect(computeGrip(makeFist([0.6, 0.6], 1).data)).toBeGreaterThan(0.72);
  });

  it('is scale-invariant (hand size / camera distance)', () => {
    const near = computeGrip(makeFist([0.4, 0.6], 0, ).data);
    const far = computeGrip(makeHand({ wrist: [0.4, 0.6], curl: 0.95, thumbAcross: true, scale: 0.07 }).data);
    expect(Math.abs(near - far)).toBeLessThan(0.05);
  });

  it('half-curled hand sits between the hysteresis band', () => {
    const g = computeGrip(makeHand({ wrist: [0.4, 0.6], curl: 0.45 }).data);
    expect(g).toBeGreaterThan(0.25);
    expect(g).toBeLessThan(0.75);
  });
});

describe('virtual steering wheel', () => {
  it('neutral → zero steering', () => {
    const s = solver();
    for (let i = 0; i < 30; i++) s.update(pair(makeFist(A_L, 0), makeFist(A_R, 1)), i / 30);
    expect(Math.abs(s.intent.steer)).toBeLessThan(0.03);
  });

  it('SIGN RULE: right hand rising over the left ⇒ car steers LEFT (steer < 0)', () => {
    const s = solver();
    // rotate the wheel counter-clockwise ~70°: right hand moves up+left, left hand down+right
    for (let i = 0; i < 40; i++)
      s.update(pair(fistAt('L', 70), fistAt('R', 70)), i / 30);
    expect(s.state.wheelAngleDeg).toBeGreaterThan(40);
    expect(s.intent.steer).toBeLessThan(-0.15);
  });

  it('left hand rising over the right ⇒ car steers RIGHT (steer > 0)', () => {
    const s = solver();
    for (let i = 0; i < 40; i++) s.update(pair(fistAt('L', -70), fistAt('R', -70)), i / 30);
    expect(s.state.wheelAngleDeg).toBeLessThan(-40);
    expect(s.intent.steer).toBeGreaterThan(0.15);
  });

  it('dead zone: small displacements produce no steering', () => {
    const s = solver();
    // ±0.008 ≈ real post-One-Euro wrist jitter, well under the magnitude gate
    const wiggle = makeFist([0.358, 0.596], 0);
    for (let i = 0; i < 30; i++)
      s.update(pair(wiggle, makeFist([0.646, 0.606], 1)), i / 30);
    expect(Math.abs(s.intent.steer)).toBeLessThan(0.02);
  });

  it('full crossing clamps at wheel lock = full steering authority', () => {
    const s = solver();
    for (let i = 0; i < 60; i++) s.update(pair(fistAt('L', 150), fistAt('R', 150)), i / 30);
    expect(s.state.wheelAngleDeg).toBeGreaterThanOrEqual(99);
    expect(s.intent.steer).toBeLessThanOrEqual(-0.95);
  });

  it('response is monotonic in wheel angle', () => {
    const s = solver();
    const mags: number[] = [];
    for (const deg of [0, 20, 45, 70, 95, 120]) {
      const fresh = solver();
      for (let i = 0; i < 40; i++) fresh.update(pair(fistAt('L', -deg), fistAt('R', -deg)), i / 30);
      mags.push(Math.abs(fresh.intent.steer));
      void s;
    }
    for (let i = 1; i < mags.length; i++) {
      expect(mags[i]).toBeGreaterThanOrEqual(mags[i - 1] - 0.02);
    }
    expect(mags[mags.length - 1]).toBeGreaterThan(mags[0] + 0.2);
  });

  it('zone gating: hands dropped to the lap lose steering authority', () => {
    const s = solver();
    for (let i = 0; i < 40; i++)
      s.update(pair(makeFist([0.2, 0.95], 0), makeFist([0.8, 0.95], 1)), i / 30);
    expect(s.state.zoneAuthority).toBeLessThan(0.1);
    expect(Math.abs(s.intent.steer)).toBeLessThan(0.05);
  });
});

describe('pedal FSM (regrip-aware)', () => {
  it('both fists → throttle ramps to 1', () => {
    const s = solver();
    for (let i = 0; i < 90; i++) s.update(pair(makeFist(A_L, 0), makeFist(A_R, 1)), i / 30);
    expect(s.intent.throttle).toBeGreaterThan(0.95);
    expect(s.intent.brake).toBe(0);
  });

  it('regrip: opening ONE hand holds throttle without braking (false-brake gate)', () => {
    const s = solver();
    for (let i = 0; i < 90; i++) s.update(pair(makeFist(A_L, 0), makeFist(A_R, 1)), i / 30);
    const held = s.intent.throttle;
    // right hand releases mid-corner for 0.4 s — must NOT brake
    for (let i = 0; i < 12; i++)
      s.update(pair(makeFist(A_L, 0), makeOpen(A_R, 1)), 3 + i / 30);
    expect(s.intent.throttle).toBeGreaterThanOrEqual(held - 0.01);
    expect(s.intent.brake).toBeLessThan(0.05);
    // re-grip → back to drive
    for (let i = 0; i < 10; i++) s.update(pair(makeFist(A_L, 0), makeFist(A_R, 1)), 3.5 + i / 30);
    expect(s.intent.throttle).toBeGreaterThan(0.9);
  });

  it('sustained one-open past the regrip window coasts (throttle decays)', () => {
    const s = solver();
    for (let i = 0; i < 90; i++) s.update(pair(makeFist(A_L, 0), makeFist(A_R, 1)), i / 30);
    for (let i = 0; i < 70; i++) s.update(pair(makeFist(A_L, 0), makeOpen(A_R, 1)), 3 + i / 30);
    expect(s.intent.throttle).toBeLessThan(0.1);
    expect(s.intent.brake).toBeLessThan(0.05);
  });

  it('both palms open → brakes', () => {
    const s = solver();
    for (let i = 0; i < 90; i++) s.update(pair(makeFist(A_L, 0), makeFist(A_R, 1)), i / 30);
    for (let i = 0; i < 60; i++) s.update(pair(makeOpen(A_L, 0), makeOpen(A_R, 1)), 3 + i / 30);
    expect(s.intent.brake).toBeGreaterThan(0.9);
    expect(s.intent.throttle).toBe(0);
  });

  it('hands lost → AUTO-HOLD (gentle brake, status flag)', () => {
    const s = solver();
    for (let i = 0; i < 90; i++) s.update(pair(makeFist(A_L, 0), makeFist(A_R, 1)), i / 30);
    for (let i = 0; i < 60; i++) s.update(pair(null, null), 3 + i / 30);
    expect(s.state.status).toBe('HANDS_LOST');
    expect(s.intent.brake).toBeGreaterThan(0.25);
    expect(s.intent.brake).toBeLessThan(0.45);
    expect(s.intent.throttle).toBe(0);
  });

  it('false-braking metric: 20 alternating regrips never touch the brakes (<1%)', () => {
    const s = solver();
    let t = 0;
    let maxBrakeDuringRegrip = 0;
    for (let i = 0; i < 90; i++) s.update(pair(makeFist(A_L, 0), makeFist(A_R, 1)), (t += 1 / 30));
    for (let k = 0; k < 20; k++) {
      const openSide = k % 2 === 0 ? 'R' : 'L';
      for (let i = 0; i < 10; i++) {
        const l = openSide === 'L' ? makeOpen(A_L, 0) : makeFist(A_L, 0);
        const r = openSide === 'R' ? makeOpen(A_R, 1) : makeFist(A_R, 1);
        s.update(pair(l, r), (t += 1 / 30));
        maxBrakeDuringRegrip = Math.max(maxBrakeDuringRegrip, s.intent.brake);
      }
      for (let i = 0; i < 10; i++) s.update(pair(makeFist(A_L, 0), makeFist(A_R, 1)), (t += 1 / 30));
    }
    expect(maxBrakeDuringRegrip).toBeLessThan(0.05);
  });
});

describe('calibration', () => {
  it('collects frames, averages anchors, persists, then tracks', () => {
    let saved: CalibrationData | null = null;
    const s = new GestureSolver({}, { save: (c) => (saved = c) });
    s.beginCalibration();
    // hands slightly off the nominal anchors — calibration must average them in
    for (let i = 0; i < 75; i++)
      s.update(pair(makeFist([0.36, 0.61], 0), makeFist([0.64, 0.6], 1)), i / 30);
    expect(s.calibrated).toBe(true);
    expect(saved).not.toBeNull();
    expect(saved!.anchorLx).toBeGreaterThan(0.35);
    expect(saved!.anchorRx).toBeLessThan(0.65);
    expect(saved!.shoulderRef).toBeGreaterThan(0.2);
    // and it drives
    for (let i = 0; i < 90; i++) s.update(pair(makeFist([0.36, 0.61], 0), makeFist([0.64, 0.6], 1)), 3 + i / 30);
    expect(s.intent.throttle).toBeGreaterThan(0.9);
  });

  it('calibration pauses input (zero intent while calibrating)', () => {
    const s = new GestureSolver({}, { load: () => null });
    s.beginCalibration();
    for (let i = 0; i < 30; i++) s.update(pair(makeFist(A_L, 0), makeFist(A_R, 1)), i / 30);
    expect(s.intent.throttle).toBe(0);
    expect(s.intent.steer).toBe(0);
  });
});
