// DifficultyDirector gates (M4 framework): deterministic policy bounds,
// density ramp per PLAN §11.2, mercy rule.

import { describe, expect, it } from 'vitest';
import { DifficultyDirector, densityAt, eventPeriodSec } from '../src/sim/director';

describe('relaxed formulas (ADR-008 easy-first)', () => {
  it('density warms up over 3 min, then KEEPS RISING +1/45s (ADR-016), capped', () => {
    expect(densityAt(0)).toBeCloseTo(8, 6);
    expect(densityAt(180)).toBeCloseTo(11, 6);
    expect(densityAt(585)).toBeCloseTo(20, 6); // +1 per 45 s after warm-up (ADR-016)
    expect(densityAt(60 * 60)).toBeCloseTo(26, 6); // ceiling (agent pool)
    expect(densityAt(120)).toBeGreaterThan(densityAt(60));
  });

  it('event period tightens 40 s → 24 s', () => {
    expect(eventPeriodSec(0)).toBeCloseTo(40, 6);
    expect(eventPeriodSec(240)).toBeCloseTo(24, 6);
  });
});

describe('DifficultyDirector', () => {
  it('featurePolicy is deterministic and bounded for every theme/time', () => {
    const mk = (t: number) => {
      const d = new DifficultyDirector(1);
      d.tick(t);
      return d;
    };
    for (const theme of ['coastal', 'neon', 'desert'] as const) {
      for (const t of [0, 30, 45, 120, 240, 600]) {
        const a = mk(t).featurePolicy(theme);
        const b = mk(t).featurePolicy(theme);
        expect(a).toEqual(b);
        expect(a.oncomingP).toBeGreaterThanOrEqual(0);
        expect(a.oncomingP).toBeLessThanOrEqual(0.5);
        expect(a.constructionP).toBeGreaterThanOrEqual(0.04);
        expect(a.constructionP).toBeLessThanOrEqual(0.12);
        expect(a.curveBias).toBeGreaterThanOrEqual(0.8);
        expect(a.curveBias).toBeLessThanOrEqual(1.7);
      }
    }
  });

  it('oncoming zones stay locked for the first 45 s (runs open calm)', () => {
    const d = new DifficultyDirector(1);
    d.tick(10);
    expect(d.featurePolicy('neon').oncomingP).toBe(0);
    d.tick(40); // t = 50
    expect(d.featurePolicy('neon').oncomingP).toBeGreaterThan(0);
  });

  it('mercy rule: two early crashes freeze the density ramp for 30 s', () => {
    const d = new DifficultyDirector(1);
    d.tick(60);
    d.registerCrash();
    d.registerCrash();
    expect(d.state.mercyUntil).toBe(90);
    d.tick(10); // inside the mercy window
    expect(d.densityScale).toBe(1);
    d.tick(25); // past it
    expect(d.densityScale).toBeGreaterThan(1);
    // a third early crash does not re-arm
    const before = d.state.mercyUntil;
    d.registerCrash();
    expect(d.state.mercyUntil).toBe(before);
  });

  it('crashes after 90 s never arm mercy', () => {
    const d = new DifficultyDirector(1);
    d.tick(120);
    d.registerCrash();
    d.registerCrash();
    expect(d.state.mercyUntil).toBe(-1);
  });
});
