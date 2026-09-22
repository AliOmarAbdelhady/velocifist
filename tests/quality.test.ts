// M6 quality system: preset invariants + autoscaler decisions (DOM-free).

import { describe, expect, it } from 'vitest';
import {
  Autoscaler,
  QUALITY_LEVELS,
  QUALITY_PRESETS,
  type QualityLevel,
} from '../src/core/quality';

describe('quality presets', () => {
  it('levels are ordered low → medium → high and presets exist for each', () => {
    expect(QUALITY_LEVELS).toEqual(['low', 'medium', 'high']);
    for (const l of QUALITY_LEVELS) expect(QUALITY_PRESETS[l]).toBeDefined();
  });

  it('presets are monotone: low does less than medium does less than high', () => {
    const [lo, md, hi] = QUALITY_LEVELS.map((l) => QUALITY_PRESETS[l]);
    expect(lo.dprCap).toBeLessThan(md.dprCap);
    expect(md.dprCap).toBeLessThanOrEqual(hi.dprCap);
    expect(lo.gradePass).toBe(false);
    expect(md.gradePass).toBe(true);
    expect(hi.gradePass).toBe(true);
    expect(lo.speedLines).toBe(false);
    expect(md.speedLines && hi.speedLines).toBe(true);
    expect(lo.sparkCap).toBeLessThan(md.sparkCap);
    expect(md.sparkCap).toBeLessThanOrEqual(hi.sparkCap);
    expect(lo.smokeCap).toBeLessThan(md.smokeCap);
    expect(lo.msaa).toBeLessThanOrEqual(md.msaa);
    expect(md.msaa).toBeLessThanOrEqual(hi.msaa);
  });

  it('dpr caps live inside the global clamp window [0.75, 1.5]', () => {
    for (const l of QUALITY_LEVELS) {
      const d = QUALITY_PRESETS[l].dprCap;
      expect(d).toBeGreaterThanOrEqual(0.75);
      expect(d).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('Autoscaler', () => {
  const feedN = (a: Autoscaler, ms: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const change = a.feed(ms);
      if (change) return change; // stop at the first transition
    }
    return null;
  };

  it('steps DOWN after sustained bad frames (hysteresis: no flicker on jitter)', () => {
    const a = new Autoscaler('high', 'high');
    // 100 ms of jitter (alternating good/bad) must NOT step down
    for (let i = 0; i < 200; i++) a.feed(i % 2 === 0 ? 30 : 5);
    expect(a.level).toBe('high');
    // sustained 30 ms frames step down after ~1.5 s
    const change = feedN(a, 30, 200) as { from: QualityLevel; to: QualityLevel } | null;
    expect(change).not.toBeNull();
    expect(change!.from).toBe('high');
    expect(change!.to).toBe('medium');
    expect(a.level).toBe('medium');
  });

  it('never steps below low', () => {
    const a = new Autoscaler('low', 'high');
    for (let i = 0; i < 2000; i++) a.feed(50);
    expect(a.level).toBe('low');
  });

  it('steps UP only after a long clean stretch, one level at a time', () => {
    const a = new Autoscaler('medium', 'high');
    // 10 s of clean frames — not enough (needs ~25 s)
    feedN(a, 10, 600);
    expect(a.level).toBe('medium');
    const change = feedN(a, 8, 1000) as { from: QualityLevel; to: QualityLevel } | null;
    expect(change).not.toBeNull();
    expect(change!.to).toBe('high');
    expect(a.level).toBe('high');
  });

  it('after a step down, stays put for a while even if frames recover', () => {
    const a = new Autoscaler('high', 'high');
    feedN(a, 30, 200); // → medium
    expect(a.level).toBe('medium');
    feedN(a, 5, 1200); // 20 s clean — still below the 40 s post-drop cooloff
    expect(a.level).toBe('medium');
  });

  it('respects the manual cap on step-up', () => {
    const a = new Autoscaler('medium', 'medium');
    for (let i = 0; i < 3000; i++) a.feed(5);
    expect(a.level).toBe('medium');
  });

  it('clamps absurd frame spikes so one hiccup cannot dominate the EMA', () => {
    const a = new Autoscaler('high', 'high');
    for (let i = 0; i < 300; i++) a.feed(16);
    a.feed(5000); // tab switch
    expect(a.emaMs).toBeLessThan(60);
  });
});
