// M7 arbiter gates: confidence EMA + hysteresis means a flickery frame must
// NOT hard-cut the hand intent — the solver's graceful degradation drives.

import { describe, expect, it } from 'vitest';
import { InputArbiter } from '../src/input/arbiter';
import type { DriverIntent } from '../src/sim/intent';

const HANDS: DriverIntent = { steer: -0.3, throttle: 1, brake: 0 };
const KEYS: DriverIntent = { steer: 0, throttle: 0, brake: 0 };
const NONE: DriverIntent = { steer: 0, throttle: 0, brake: 0 };

describe('InputArbiter (M7 robustness)', () => {
  it('confident hands drive', () => {
    const a = new InputArbiter();
    for (let i = 0; i < 10; i++) a.update(HANDS, 0.8, KEYS, i / 30);
    expect(a.source).toBe('HANDS');
    expect(a.intent.throttle).toBe(1);
  });

  it('a single flickery frame does not cut the hands out (EMA + hysteresis)', () => {
    const a = new InputArbiter();
    for (let i = 0; i < 10; i++) a.update(HANDS, 0.8, KEYS, i / 30);
    const t = 10 / 30;
    a.update(HANDS, 0.0, KEYS, t); // one dropped frame
    expect(a.source).toBe('HANDS');
  });

  it('sustained loss falls through to NONE only after the hold grace', () => {
    const a = new InputArbiter({ holdGraceSec: 0.8 });
    for (let i = 0; i < 10; i++) a.update(HANDS, 0.8, KEYS, i / 30);
    let t = 10 / 30;
    for (let i = 0; i < 12; i++) a.update(HANDS, 0.0, KEYS, (t += 1 / 30)); // 0.4 s
    expect(a.source).toBe('HANDS'); // still holding
    for (let i = 0; i < 20; i++) a.update(HANDS, 0.0, KEYS, (t += 1 / 30)); // > 0.8 s
    expect(a.source).toBe('NONE');
    expect(a.handsGoodAgeSec).toBeGreaterThan(0.8);
  });

  it('confidence recovering inside the band keeps hands (hysteresis, no flapping)', () => {
    const a = new InputArbiter();
    for (let i = 0; i < 10; i++) a.update(HANDS, 0.8, KEYS, i / 30);
    let t = 10 / 30;
    for (let i = 0; i < 30; i++) {
      const conf = i % 2 === 0 ? 0.05 : 0.35; // flapping around the band
      a.update(HANDS, conf, KEYS, (t += 1 / 30));
    }
    expect(a.source).toBe('HANDS');
  });

  it('re-entry needs the enter threshold, not just leaving the drop floor', () => {
    const a = new InputArbiter();
    let t = 0;
    for (; t < 1; t += 1 / 30) a.update(HANDS, 0.0, KEYS, t);
    expect(a.source).toBe('NONE');
    for (let i = 0; i < 5; i++) a.update(HANDS, 0.3, KEYS, (t += 1 / 30)); // band, not enter
    expect(a.source).toBe('NONE');
    for (let i = 0; i < 8; i++) a.update(HANDS, 0.6, KEYS, (t += 1 / 30));
    expect(a.source).toBe('HANDS');
  });

  it('keyboard wins whenever it is actively used', () => {
    const a = new InputArbiter();
    for (let i = 0; i < 10; i++) a.update(HANDS, 0.8, KEYS, i / 30);
    const kb: DriverIntent = { steer: 0.5, throttle: 0, brake: 1 };
    a.update(HANDS, 0.8, kb, 0.5);
    expect(a.source).toBe('KEYS');
    expect(a.intent.brake).toBe(1);
  });
});
