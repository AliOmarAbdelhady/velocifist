// M6 audio: pure parameter math (the WebAudio graph itself is verified live).

import { describe, expect, it } from 'vitest';
import {
  ENGINE_PROFILES,
  crashGains,
  engineRpm,
  firingFrequency,
  profileFor,
  whooshParams,
} from '../src/audio/audio';

describe('engine math', () => {
  it('4-stroke firing frequency: V8 @ 6000 rpm = 400 Hz', () => {
    expect(firingFrequency(6000, 8)).toBeCloseTo(400, 5);
  });

  it('V10 fires higher than V8 at the same rpm', () => {
    expect(firingFrequency(6000, 10)).toBeGreaterThan(firingFrequency(6000, 8));
  });

  it('rpm maps norm into [idle, max] with clamping', () => {
    expect(engineRpm(0, 900, 7400)).toBe(900);
    expect(engineRpm(1, 900, 7400)).toBe(7400);
    expect(engineRpm(0.5, 900, 7400)).toBeCloseTo(4150, 5);
    expect(engineRpm(-3, 900, 7400)).toBe(900);
    expect(engineRpm(4, 900, 7400)).toBe(7400);
  });

  it('all three cars have profiles with sane rpm ranges', () => {
    for (const id of ['falcone-gt', 'vipera-rs', 'bruto-widebody']) {
      const p = profileFor(id);
      expect(p.cylinders).toBeGreaterThanOrEqual(6);
      expect(p.maxRpm).toBeGreaterThan(p.idleRpm);
      expect(ENGINE_PROFILES[id]).toBe(p);
    }
  });

  it('only the Vipera is turbocharged', () => {
    expect(ENGINE_PROFILES['vipera-rs'].turbo).toBe(true);
    expect(ENGINE_PROFILES['falcone-gt'].turbo).toBe(false);
    expect(ENGINE_PROFILES['bruto-widebody'].turbo).toBe(false);
  });
});

describe('one-shot parameter curves', () => {
  it('whoosh grows with closing speed and sweeps downward (doppler away)', () => {
    const slow = whooshParams(10);
    const fast = whooshParams(60);
    expect(fast.gain).toBeGreaterThan(slow.gain);
    expect(fast.dur).toBeGreaterThanOrEqual(slow.dur);
    expect(slow.f0).toBeGreaterThan(slow.f1);
    expect(fast.f0).toBeGreaterThan(fast.f1);
  });

  it('near misses below the floor are silent-ish but not negative', () => {
    const w = whooshParams(2);
    expect(w.gain).toBeGreaterThan(0);
    expect(whooshParams(400).gain).toBeLessThanOrEqual(0.48 + 1e-9);
  });

  it('crash gains are monotone in impulse and saturate', () => {
    const soft = crashGains(4);
    const hard = crashGains(20);
    const max = crashGains(60);
    expect(hard.thump).toBeGreaterThan(soft.thump);
    expect(hard.crunch).toBeGreaterThan(soft.crunch);
    expect(hard.ring).toBeGreaterThan(soft.ring);
    expect(max.thump).toBeLessThanOrEqual(1);
    expect(max.crunch).toBe(1);
    expect(max.ring).toBeCloseTo(0.45, 5);
  });
});
