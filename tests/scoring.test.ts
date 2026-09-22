// Scoring gates (PLAN §11.1, M5): tier points, oncoming ×2, combo build/decay
// + cap, clean-pass bonuses, streaks, FLOW regen, anti-exploit basics,
// determinism.

import { describe, expect, it } from 'vitest';
import { Car } from '../src/sim/car';
import { CAR_TUNES } from '../src/sim/carTunes';
import { ScoringSystem } from '../src/sim/scoring';
import type { NearMissEvent, PassEvent, NearMissTier } from '../src/sim/trafficTypes';

const DT = 1 / 60;

function carAt(u: number): Car {
  const c = new Car(CAR_TUNES[0]);
  c.u = u;
  return c;
}

function nm(tier: NearMissTier, oncoming = false, closing = 30): NearMissEvent {
  return { agentId: 1, tier, clearance: 0.3, closingSpeed: closing, oncoming };
}

function pass(closing: number, oncoming = false): PassEvent {
  return { agentId: 2, closingSpeed: closing, oncoming };
}

describe('near-miss scoring', () => {
  it('tier points: 500 / 250 / 100 (combo applies from the first event)', () => {
    const s = new ScoringSystem();
    s.onNearMisses([nm('NEAR')]);
    expect(s.score).toBe(100 * 1.25); // combo 1
    s.onNearMisses([nm('VERY_CLOSE')]);
    expect(s.score).toBe(100 * 1.25 + 250 * 1.5); // combo 2
    const fresh = new ScoringSystem();
    fresh.onNearMisses([nm('INCHES')]);
    expect(fresh.score).toBe(500 * 1.25);
  });

  it('oncoming doubles the tier points', () => {
    const a = new ScoringSystem();
    a.onNearMisses([nm('INCHES')]);
    const b = new ScoringSystem();
    b.onNearMisses([nm('INCHES', true)]);
    expect(b.score).toBe(a.score * 2);
  });

  it('combo multiplier = 1 + 0.25·combo, capped at 10', () => {
    const s = new ScoringSystem();
    for (let i = 0; i < 20; i++) s.onNearMisses([nm('NEAR')]);
    expect(s.combo).toBe(10);
    expect(s.comboMultiplier).toBeCloseTo(1 + 0.25 * 10, 6);
    expect(s.topCombo).toBe(10);
  });

  it('combo resets after the 4 s window', () => {
    const s = new ScoringSystem();
    const c = carAt(0);
    s.onNearMisses([nm('NEAR')]);
    expect(s.combo).toBe(1);
    s.update(4.5, c);
    expect(s.combo).toBe(0);
  });

  it('a crash kills the combo instantly', () => {
    const s = new ScoringSystem();
    s.onNearMisses([nm('NEAR'), nm('NEAR'), nm('NEAR')]);
    expect(s.combo).toBe(3);
    s.onCrashes(1);
    expect(s.combo).toBe(0);
    expect(s.counts.crashes).toBe(1);
  });
});

describe('passive + clean passes + streaks', () => {
  it('passive score only above 80 km/h, ×1.5 in FLOW', () => {
    const s = new ScoringSystem();
    const slow = carAt(15);
    s.update(10, slow);
    expect(s.score).toBe(0); // below the floor
    const fast = carAt(CAR_TUNES[0].vMax);
    s.update(1, fast);
    expect(s.score).toBeGreaterThan(55);
    expect(s.score).toBeLessThan(62);
    s.onNearMisses([nm('NEAR'), nm('NEAR'), nm('NEAR'), nm('NEAR'), nm('NEAR')]);
    expect(s.flow).toBe(true);
    s.update(1, fast);
    expect(s.score).toBeGreaterThan(55 + 60 * 1.5 * 0.5 + 75); // FLOW active part-step
  });

  it('clean pass: +50, +100 more above 120 km/h closing', () => {
    const s = new ScoringSystem();
    s.onPasses([pass(20)]);
    expect(s.score).toBe(50);
    s.onPasses([pass(40)]);
    expect(s.score).toBe(50 + 150);
    expect(s.counts.cleanPassFast).toBe(1);
  });

  it('clean streak: +1000 per 30 s clean DRIVING', () => {
    const s = new ScoringSystem();
    const c = carAt(30);
    for (let i = 0; i < 60 * 31; i++) s.update(DT, c);
    expect(s.counts.streaks).toBe(1);
    expect(s.score).toBeGreaterThanOrEqual(1000);
    s.onCrashes(1); // streak dies with contact
    const streaks = s.counts.streaks;
    for (let i = 0; i < 60 * 5; i++) s.update(DT, c);
    expect(s.counts.streaks).toBe(streaks); // no new streak in the next 5 s
  });
});

describe('FLOW regen', () => {
  it('regens 0.5 HP/s up to 35% of healthMax, only while combo ≥ 5', () => {
    const s = new ScoringSystem();
    const max = 100;
    expect(s.flowRegenClamped(DT, 10, max)).toBe(0); // no flow yet
    for (let i = 0; i < 5; i++) s.onNearMisses([nm('NEAR')]);
    expect(s.flow).toBe(true);
    expect(s.flowRegenClamped(DT, 10, max)).toBeCloseTo(0.5 * DT, 6);
    expect(s.flowRegenClamped(DT, 34.9, max)).toBeCloseTo(0.5 * DT, 6);
    expect(s.flowRegenClamped(DT, 35, max)).toBe(0); // at cap
    expect(s.flowRegenClamped(DT, 80, max)).toBe(0);
  });
});

describe('anti-exploit', () => {
  it('parking scores nothing', () => {
    const s = new ScoringSystem();
    const parked = carAt(0);
    for (let i = 0; i < 60 * 30; i++) s.update(DT, parked);
    expect(s.score).toBe(0); // no passive, no streak, no bonuses
  });

  it('popup ring drains and is bounded', () => {
    const s = new ScoringSystem();
    for (let i = 0; i < 40; i++) s.onNearMisses([nm('NEAR')]);
    const first = s.takePopups();
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(24);
    expect(s.takePopups().length).toBe(0);
  });

  it('determinism: same event script ⇒ same hash', () => {
    const run = (): string => {
      const s = new ScoringSystem();
      const c = carAt(40);
      for (let i = 0; i < 60 * 60; i++) {
        s.update(DT, c);
        if (i % 90 === 0) s.onNearMisses([nm(i % 270 === 0 ? 'INCHES' : 'NEAR', i % 540 === 0)]);
        if (i % 45 === 0) s.onPasses([pass(25)]);
        if (i % 1700 === 0) s.onCrashes(1);
      }
      return s.hash();
    };
    expect(run()).toBe(run());
  });
});
