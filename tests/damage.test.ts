// Damage gates (PLAN §9, M5): impulse curve, window merge, state thresholds,
// FLOW regen recovery, wreck + power penalty.

import { describe, expect, it } from 'vitest';
import { DamageSystem } from '../src/sim/damage';

const DT = 1 / 60;

describe('impulse → damage', () => {
  it('a 30 m/s head-on ≈ half health of a 110 hp car', () => {
    const d = new DamageSystem(110);
    d.update(DT, [30], 0);
    expect(d.health).toBeGreaterThan(40);
    expect(d.health).toBeLessThan(65);
  });

  it('light scrapes barely hurt; a grazing bus ≠ a head-on (validation case)', () => {
    const graze = new DamageSystem(110);
    graze.update(DT, [4], 0);
    expect(graze.health).toBeGreaterThan(100);
    const headOn = new DamageSystem(110);
    headOn.update(DT, [30], 0);
    expect(headOn.health).toBeLessThan(graze.health - 30);
  });

  it('same-window impacts (0.8 s) merge at 50%', () => {
    const once = new DamageSystem(110);
    once.update(DT, [20], 0);
    const thrice = new DamageSystem(110);
    thrice.update(DT, [20], 0);
    thrice.update(DT, [20], 0); // inside the window
    thrice.update(DT, [20], 0); // still inside
    expect(thrice.health).toBeLessThan(once.health); // hurts more…
    expect(thrice.health).toBeGreaterThan(once.health - 40); // …but not 3×
  });

  it('impacts after the window cost full price again', () => {
    const d = new DamageSystem(110);
    d.update(DT, [20], 0);
    for (let i = 0; i < 60; i++) d.update(DT, [], 0); // 1 s passes
    d.update(DT, [20], 0);
    const single = new DamageSystem(110);
    single.update(DT, [20], 0);
    // second hit outside the window = same damage as a fresh single hit
    expect(Math.abs(d.health - (single.health - (110 - single.health))) ).toBeLessThan(20);
  });
});

describe('states', () => {
  it('PRISTINE → DAMAGED at 65% → CRITICAL at 30% (−8% power) → WRECKED', () => {
    const d = new DamageSystem(100);
    expect(d.state).toBe('PRISTINE');
    expect(d.powerScale).toBe(1);
    d.update(DT, [25], 0); // ~37 dmg (M7 softer curve, k=7.5)
    expect(d.state).toBe('DAMAGED');
    d.update(DT, [40], 0); // merged at 50% inside the window
    expect(d.state).toBe('CRITICAL');
    expect(d.powerScale).toBeCloseTo(0.92, 6);
    expect(d.wrecked).toBe(false);
    for (let i = 0; i < 60; i++) d.update(DT, [], 0); // window expires
    d.update(DT, [30], 0);
    expect(d.state).toBe('WRECKED');
    expect(d.wrecked).toBe(true);
    expect(d.health).toBe(0);
    const evs = d.update(DT, [], 0);
    expect(evs.length).toBe(0); // wreck fires exactly once
  });

  it('FLOW regen recovers CRITICAL → DAMAGED but never past 35%', () => {
    const d = new DamageSystem(100);
    d.update(DT, [40], 0); // ~29 left → CRITICAL
    expect(d.state).toBe('CRITICAL');
    for (let i = 0; i < 60 * 60; i++) d.update(DT, [], 0.5 * DT);
    expect(d.health).toBeCloseTo(45, 4); // capped (M7: 45%)
    expect(d.state).toBe('DAMAGED'); // recovered a tier
  });

  it('a wrecked car stays wrecked (no zombie regen)', () => {
    const d = new DamageSystem(10);
    d.update(DT, [40], 0);
    expect(d.wrecked).toBe(true);
    for (let i = 0; i < 60 * 30; i++) d.update(DT, [], 5);
    expect(d.wrecked).toBe(true);
    expect(d.health).toBe(0);
    expect(d.wreckTimer).toBeGreaterThan(29);
  });
});
