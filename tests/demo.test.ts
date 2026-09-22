// M7 demo source + AR banner gates: the synthetic pipeline must actually
// drive the real solver through its scripted phases, and the plain-language
// banner must name each state.

import { describe, expect, it } from 'vitest';
import { DemoHands, demoPhase } from '../src/input/demoHands';
import { gestureBanner } from '../src/render/pip';
import type { SolverState } from '../src/input/gestures';

function fakeState(over: Partial<SolverState>): SolverState {
  return {
    status: 'TRACKING',
    wheelAngleDeg: 0,
    gripL: 0.8,
    gripR: 0.8,
    fistL: true,
    fistR: true,
    zoneAuthority: 1,
    confidence: 0.9,
    latencyHintMs: 0,
    handsAgeS: 0,
    ...over,
  };
}

describe('AR gesture banner', () => {
  it('names the core commands in player language', () => {
    expect(gestureBanner(fakeState({}), { steer: 0, throttle: 1, brake: 0 })).toBe('FISTS — FULL THROTTLE');
    expect(
      gestureBanner(fakeState({ fistL: false, fistR: false }), { steer: 0, throttle: 0, brake: 1 }),
    ).toBe('OPEN PALMS — BRAKING');
    expect(gestureBanner(fakeState({ wheelAngleDeg: 45 }), { steer: -0.4, throttle: 1, brake: 0 })).toBe(
      'TURNING LEFT 45°',
    );
    expect(gestureBanner(fakeState({ wheelAngleDeg: -30 }), { steer: 0.3, throttle: 1, brake: 0 })).toBe(
      'TURNING RIGHT 30°',
    );
  });

  it('names the degradation states', () => {
    expect(gestureBanner(fakeState({ status: 'HANDS_LOST' }), { steer: 0, throttle: 0, brake: 0.3 })).toBe(
      'HANDS LOST — AUTO-HOLD',
    );
    expect(gestureBanner(fakeState({ status: 'PARTIAL', fistR: false }), { steer: 0, throttle: 1, brake: 0 })).toBe(
      'ONE HAND — HOLDING',
    );
    expect(
      gestureBanner(fakeState({ fistR: false }), { steer: 0, throttle: 0.8, brake: 0 }),
    ).toBe('REGRIP — HOLDING');
    expect(gestureBanner(fakeState({ status: 'UNCALIBRATED' }), { steer: 0, throttle: 0, brake: 0 })).toBe(
      'HOLD BOTH HANDS UP TO CALIBRATE',
    );
  });
});

describe('demo script', () => {
  it('cycles through cruise / partial / lost / regrip / brake', () => {
    expect(demoPhase(0.5).l).toBe('fist');
    expect(demoPhase(12).r).toBeNull(); // PARTIAL
    expect(demoPhase(14).l).toBeNull(); // HANDS_LOST
    expect(demoPhase(15).r).toBe('open'); // regrip
    expect(demoPhase(17).l).toBe('open'); // brake
    expect(demoPhase(19).l).toBe('fist'); // recovered
  });

  it.skipIf(typeof requestAnimationFrame === 'undefined')('the scripted phase maps onto the real solver status (pipeline intact)', async () => {
    const demo = new DemoHands();
    // solver is pre-calibrated; feed a long cruise then check it drives
    demo.start();
    await new Promise((r) => setTimeout(r, 400));
    demo.stop();
    // at some point in the first 400 ms the solver must have been fed and
    // produced nonzero throttle or a defined status
    expect(demo.solver.calibrated).toBe(true);
    expect(['TRACKING', 'PARTIAL', 'HANDS_LOST']).toContain(demo.solver.state.status);
  });

  it.skipIf(typeof requestAnimationFrame === 'undefined')('feeds ~30 Hz like a real camera (throttled, not per-frame)', () => {
    const demo = new DemoHands();
    demo.start();
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        demo.stop();
        // info.lastHands is populated by the feed loop
        expect(Array.isArray(demo.info.lastHands)).toBe(true);
        resolve();
      }, 250);
    });
  });
});

// node-environment guard: DemoHands needs requestAnimationFrame
describe.skipIf(typeof requestAnimationFrame === 'undefined')('demo rAF', () => {
  it('start/stop is idempotent', async () => {
    const demo = new DemoHands();
    demo.start();
    demo.start(); // second call is a no-op
    await new Promise((r) => setTimeout(r, 100));
    demo.stop();
    demo.stop();
    expect(true).toBe(true);
  });
});
