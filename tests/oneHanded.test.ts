// M9 one-handed mode + sensitivity gates (PLAN §5, §15): a single hand
// drives — fist = throttle, open palm = brake, wrist displacement steers the
// virtual wheel with the SAME sign rule as two-hand crossing. Calibration
// still needs both hands (the anchors define the wheel).

import { describe, expect, it } from 'vitest';
import { GestureSolver, type CalibrationData } from '../src/input/gestures';
import { gestureBanner } from '../src/render/pip';
import type { HandPair } from '../src/input/handTracks';
import type { SolverState } from '../src/input/gestures';
import { makeFist, makeOpen } from './helpers/handFixture';

const A_L: [number, number] = [0.35, 0.6];
const A_R: [number, number] = [0.65, 0.6];

const CALIB: CalibrationData = {
  anchorLx: 0.35,
  anchorLy: 0.6,
  anchorRx: 0.65,
  anchorRy: 0.6,
  shoulderRef: 0.3,
};

function pair(
  l: ReturnType<typeof makeFist> | null,
  r: ReturnType<typeof makeFist> | null,
  conf = 0.9,
): HandPair {
  return {
    left: l ? { data: l.data, confidence: conf } : null,
    right: r ? { data: r.data, confidence: conf } : null,
    confidence: conf,
  };
}

function solver(oneHanded = true): GestureSolver {
  const s = new GestureSolver({}, { load: () => ({ ...CALIB }) });
  s.setOneHanded(oneHanded);
  return s;
}

describe('one-handed driving', () => {
  it('a single fist drives: TRACKING (not PARTIAL) and full throttle', () => {
    const s = solver();
    for (let i = 0; i < 90; i++) s.update(pair(null, makeFist(A_R, 1)), i / 30);
    expect(s.state.status).toBe('TRACKING');
    expect(s.intent.throttle).toBeGreaterThan(0.9);
    expect(s.intent.brake).toBe(0);
  });

  it('the left hand alone works identically', () => {
    const s = solver();
    for (let i = 0; i < 90; i++) s.update(pair(makeFist(A_L, 0), null), i / 30);
    expect(s.state.status).toBe('TRACKING');
    expect(s.intent.throttle).toBeGreaterThan(0.9);
  });

  it('SIGN RULE: right hand rising ⇒ steers LEFT (steer < 0)', () => {
    const s = solver();
    for (let i = 0; i < 40; i++) s.update(pair(null, makeFist([0.65, 0.5], 1)), i / 30);
    expect(s.state.wheelAngleDeg).toBeGreaterThan(40);
    expect(s.intent.steer).toBeLessThan(-0.15);
  });

  it('SIGN RULE: left hand rising ⇒ steers RIGHT (steer > 0)', () => {
    const s = solver();
    for (let i = 0; i < 40; i++) s.update(pair(makeFist([0.35, 0.5], 0), null), i / 30);
    expect(s.state.wheelAngleDeg).toBeLessThan(-40);
    expect(s.intent.steer).toBeGreaterThan(0.15);
  });

  it('open palm brakes after the regrip window', () => {
    const s = solver();
    for (let i = 0; i < 90; i++) s.update(pair(null, makeFist(A_R, 1)), i / 30);
    for (let i = 0; i < 70; i++) s.update(pair(null, makeOpen(A_R, 1)), 3 + i / 30);
    expect(s.intent.brake).toBeGreaterThan(0.9);
    expect(s.intent.throttle).toBe(0);
  });

  it('opening the fist for a re-grip holds — no false brake', () => {
    const s = solver();
    for (let i = 0; i < 90; i++) s.update(pair(null, makeFist(A_R, 1)), i / 30);
    const held = s.intent.throttle;
    for (let i = 0; i < 15; i++) s.update(pair(null, makeOpen(A_R, 1)), 3 + i / 30);
    expect(s.intent.brake).toBeLessThan(0.05);
    expect(s.intent.throttle).toBeGreaterThanOrEqual(held - 0.01);
  });

  it('hand lost → AUTO-HOLD (gentle brake, hands-lost status)', () => {
    const s = solver();
    for (let i = 0; i < 90; i++) s.update(pair(null, makeFist(A_R, 1)), i / 30);
    for (let i = 0; i < 60; i++) s.update(pair(null, null), 3 + i / 30);
    expect(s.state.status).toBe('HANDS_LOST');
    expect(s.intent.brake).toBeGreaterThan(0.25);
    expect(s.intent.brake).toBeLessThan(0.45);
    expect(s.intent.throttle).toBe(0);
  });

  it('both hands visible still use the two-hand wheel (mode-free upgrade)', () => {
    const s = solver();
    const c = 0.5;
    const r = 0.15;
    // rotate both fists ~70° counter-clockwise around the wheel centre
    const at = (base: number): ReturnType<typeof makeFist> => {
      const a = ((base + 70) * Math.PI) / 180;
      return makeFist([c + r * Math.cos(a), 0.6 - r * Math.sin(a)], base === 180 ? 0 : 1);
    };
    for (let i = 0; i < 40; i++) s.update(pair(at(180), at(0)), i / 30);
    expect(s.intent.steer).toBeLessThan(-0.15);
  });
});

describe('steering sensitivity', () => {
  /** Symmetric vertical displacement d lands the wheel mid-range (~45°):
   *  the magnitude gate maps the narrow noise-free band onto 0–90°, so this
   *  is where the response curve — and therefore the gain — is visible. */
  function steerAt(gain: number, d = 0.021): number {
    const s = new GestureSolver({}, { load: () => ({ ...CALIB }) });
    s.setSensitivity(gain);
    const L = makeFist([0.35, 0.6 + d], 0);
    const R = makeFist([0.65, 0.6 - d], 1);
    for (let i = 0; i < 40; i++) s.update(pair(L, R), i / 30);
    return Math.abs(s.intent.steer);
  }

  it('higher gain reaches more authority at the same wheel angle', () => {
    const low = steerAt(1);
    const high = steerAt(1.5);
    expect(high).toBeGreaterThan(low + 0.08);
    expect(steerAt(0.5)).toBeLessThan(low - 0.05);
  });

  it('full lock still means full authority at every gain', () => {
    for (const gain of [0.5, 1, 1.5]) {
      const s = new GestureSolver({}, { load: () => ({ ...CALIB }) });
      s.setSensitivity(gain);
      const c = 0.5;
      const r = 0.15;
      const at = (base: number): ReturnType<typeof makeFist> => {
        const a = ((base + 150) * Math.PI) / 180;
        return makeFist([c + r * Math.cos(a), 0.6 - r * Math.sin(a)], base === 180 ? 0 : 1);
      };
      for (let i = 0; i < 60; i++) s.update(pair(at(180), at(0)), i / 30);
      expect(Math.abs(s.intent.steer)).toBeGreaterThan(0.95);
    }
  });

  it('setSensitivity clamps out-of-range values', () => {
    const s = new GestureSolver({}, { load: () => ({ ...CALIB }) });
    s.setSensitivity(9);
    // extreme gain still drives sanely (clamped to 2) — just check it runs
    for (let i = 0; i < 30; i++) s.update(pair(makeFist(A_L, 0), makeFist(A_R, 1)), i / 30);
    expect(Math.abs(s.intent.steer)).toBeLessThan(0.05); // neutral → no steer
  });
});

describe('gesture banner (one-handed)', () => {
  const base: SolverState = {
    status: 'TRACKING',
    wheelAngleDeg: 0,
    gripL: 0.9,
    gripR: 0.9,
    fistL: false,
    fistR: true,
    zoneAuthority: 1,
    confidence: 0.9,
    latencyHintMs: 0,
    handsAgeS: 0,
    oneHanded: true,
  };

  it('single fist at neutral reads FULL THROTTLE', () => {
    expect(gestureBanner(base, { steer: 0, throttle: 1, brake: 0 }, true)).toBe(
      'FIST — FULL THROTTLE',
    );
  });

  it('single open palm reads BRAKING', () => {
    const st = { ...base, fistL: false, fistR: false };
    expect(gestureBanner(st, { steer: 0, throttle: 0, brake: 1 }, true)).toBe(
      'OPEN PALM — BRAKING',
    );
  });

  it('turning reads direction + angle', () => {
    const st = { ...base, wheelAngleDeg: 55 };
    expect(gestureBanner(st, { steer: -0.5, throttle: 1, brake: 0 }, true)).toBe(
      'TURNING LEFT 55°',
    );
  });

  it('PARTIAL in one-handed mode asks for a hand', () => {
    const st = { ...base, status: 'PARTIAL' as const };
    expect(gestureBanner(st, { steer: 0, throttle: 0, brake: 0 }, true)).toBe('SHOW A HAND');
  });

  it('two-hand mode banner is unchanged (regression)', () => {
    const st = { ...base, fistL: true, fistR: true, wheelAngleDeg: 40, oneHanded: false };
    expect(gestureBanner(st, { steer: -0.4, throttle: 1, brake: 0 }, false)).toBe(
      'TURNING LEFT 40°',
    );
    const st2 = { ...base, status: 'PARTIAL' as const, oneHanded: false };
    expect(gestureBanner(st2, { steer: 0, throttle: 0, brake: 0 }, false)).toBe(
      'ONE HAND — HOLDING',
    );
  });
});
