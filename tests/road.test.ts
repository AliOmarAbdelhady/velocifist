// Road spine gates (PLAN §10.1, M4): determinism, drivable curvature,
// projection round-trip, zone tables (oncoming/construction), floating-origin
// rebase exactness, and the ≤2 ms chunk-build budget.

import { describe, expect, it } from 'vitest';
import { RoadSystem, CHUNK_LEN, SAMPLE_STEP } from '../src/sim/road';

function curved(theme: 'coastal' | 'neon' | 'desert' = 'desert', seed = 777): RoadSystem {
  return new RoadSystem({ seed, theme });
}

const wrapPi = (h: number): number => {
  let x = h;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
};

describe('determinism', () => {
  it('same seed ⇒ identical spine and features', () => {
    const a = curved(); a.ensureTo(4000);
    const b = curved(); b.ensureTo(4000);
    expect(a.hash()).toBe(b.hash());
    for (let i = 0; i < 16; i++) {
      expect(a.chunkFeature(i)).toEqual(b.chunkFeature(i));
    }
  });

  it('different seeds ⇒ different spines', () => {
    const a = curved('desert', 1); a.ensureTo(3000);
    const b = curved('desert', 2); b.ensureTo(3000);
    expect(a.hash()).not.toBe(b.hash());
  });
});

describe('spine geometry', () => {
  it('starts at the origin facing −z; z strictly decreases; samples are 4 m apart', () => {
    const r = curved('desert', 31); r.ensureTo(6000);
    const p = { x: 0, z: 0, heading: 0 };
    r.sample(0, p);
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.z).toBeCloseTo(0, 10);
    expect(p.heading).toBeCloseTo(0, 10);
    let prevZ = 0;
    let prevX = 0;
    for (let s = SAMPLE_STEP; s <= 6000; s += SAMPLE_STEP) {
      r.sample(s, p);
      expect(p.z).toBeLessThan(prevZ); // monotone travel direction
      const chord = Math.hypot(p.x - prevX, p.z - prevZ);
      expect(chord).toBeCloseTo(SAMPLE_STEP, 2); // arclength-parametrised
      prevZ = p.z;
      prevX = p.x;
    }
  });

  it('curvature stays drivable (peak ≥ ~690 m radius) and headings stay bounded', () => {
    const r = curved('desert', 31); r.ensureTo(8000);
    const p = { x: 0, z: 0, heading: 0 };
    let maxKappa = 0;
    let maxAbsH = 0;
    let prevH = 0;
    for (let s = SAMPLE_STEP; s <= 8000; s += SAMPLE_STEP) {
      r.sample(s, p);
      const dh = Math.abs(wrapPi(p.heading - prevH));
      maxKappa = Math.max(maxKappa, dh / SAMPLE_STEP);
      maxAbsH = Math.max(maxAbsH, Math.abs(p.heading));
      prevH = p.heading;
    }
    expect(maxKappa).toBeLessThanOrEqual(1 / 690);
    expect(maxAbsH).toBeLessThan(1.0); // self-centring keeps |heading| ≪ π/2
  });
});

describe('projection', () => {
  it('recovers s and lat from world points across the curve', () => {
    const r = curved('desert', 4242); r.ensureTo(2600);
    const sp = { x: 0, z: 0, heading: 0 };
    const pr = { s: 0, lat: 0 };
    for (let s = 0; s <= 2500; s += 137) {
      r.sample(s, sp);
      const rx = Math.cos(sp.heading);
      const rz = Math.sin(sp.heading);
      for (const off of [-12, -6, 0, 3.3, 9.9]) {
        r.project(sp.x + rx * off, sp.z + rz * off, pr);
        expect(Math.abs(pr.s - s)).toBeLessThan(0.1);
        expect(Math.abs(pr.lat - off)).toBeLessThan(0.05);
      }
    }
  });

  it('straight(): identity mapping (s = −z, lat = x)', () => {
    const r = RoadSystem.straight();
    const sp = { x: 0, z: 0, heading: 0 };
    const pr = { s: 0, lat: 0 };
    r.sample(100, sp);
    expect(sp.x).toBe(0);
    expect(sp.z).toBe(-100);
    expect(sp.heading).toBe(0);
    r.project(4.5, -100, pr);
    expect(pr.s).toBeCloseTo(100, 10);
    expect(pr.lat).toBeCloseTo(4.5, 10);
  });
});

describe('zone table', () => {
  it('neon: oncoming runs exist, are bounded, start late; construction never overlaps oncoming or itself', () => {
    const r = new RoadSystem({ seed: 99, theme: 'neon' }); r.ensureTo(CHUNK_LEN * 40);
    let runs = 0;
    let maxRun = 0;
    let cur = 0;
    let firstOnc = -1;
    for (let i = 0; i < 40; i++) {
      const f = r.chunkFeature(i);
      if (i < 4) expect(f.oncomingLanes).toBe(0); // clean launch
      if (f.construction) {
        expect(f.oncomingLanes).toBe(0);
        expect(r.chunkFeature(i - 1).construction).toBe(false); // never back-to-back
      }
      if (f.oncomingLanes > 0) {
        cur++;
        maxRun = Math.max(maxRun, cur);
        if (firstOnc < 0) firstOnc = i;
      } else {
        if (cur > 0) runs++;
        cur = 0;
      }
    }
    expect(runs).toBeGreaterThan(2);
    expect(maxRun).toBeLessThanOrEqual(14); // ≤ ~3.5 km
    expect(firstOnc).toBeGreaterThanOrEqual(4);
  });

  it('coastal/desert never produce oncoming zones', () => {
    for (const theme of ['coastal', 'desert'] as const) {
      const r = curved(theme, 5); r.ensureTo(4000);
      for (let s = 0; s < 4000; s += 100) expect(r.oncomingAt(s)).toBe(0);
    }
  });

  it('blocked lane is a same-direction edge lane', () => {
    const r = new RoadSystem({ seed: 12, theme: 'desert', policy: { oncomingP: 0, constructionP: 1, curveBias: 1 } });
    r.ensureTo(CHUNK_LEN * 8);
    for (let i = 4; i < 8; i++) {
      const f = r.chunkFeature(i);
      // p = 1 with the no-back-to-back rule ⇒ strictly alternating zones
      expect(f.construction).toBe(i % 2 === 0);
      if (!f.construction) continue;
      const b = r.blockedLaneOf(i);
      expect(b).toBeGreaterThanOrEqual(f.oncomingLanes);
      expect(b).toBeLessThan(4);
    }
  });
});

describe('chunk budget', () => {
  it('chunk build ≤ 2 ms after warmup (M4 gate)', () => {
    const r = curved('desert', 5);
    r.ensureTo(CHUNK_LEN * 2);
    r.maxBuildMs = 0; // exclude JIT warmup from the gate
    for (let i = 0; i < 12; i++) r.ensureTo((3 + i) * CHUNK_LEN);
    expect(r.maxBuildMs).toBeLessThanOrEqual(2);
  });
});

describe('floating origin', () => {
  it('rebase is an exact +z translation; s/lat invariant; no double rebase', () => {
    const r = curved('desert', 7); r.ensureTo(2000);
    const sp = { x: 0, z: 0, heading: 0 };
    const pr = { s: 0, lat: 0 };
    r.sample(1234.5, sp);
    r.project(sp.x + 5, sp.z, pr);
    const s0 = pr.s;
    const lat0 = pr.lat;

    expect(r.maybeRebase(-3000)).toBe(0); // above threshold
    const dz = r.maybeRebase(-5000);
    expect(dz).toBe(4096);

    const sp2 = { x: 0, z: 0, heading: 0 };
    r.sample(1234.5, sp2);
    expect(sp2.x).toBeCloseTo(sp.x, 6);
    expect(sp2.z).toBeCloseTo(sp.z + 4096, 5);

    r.project(sp2.x + 5, sp2.z, pr);
    expect(pr.s).toBeCloseTo(s0, 3);
    expect(pr.lat).toBeCloseTo(lat0, 3);

    expect(r.maybeRebase(-904)).toBe(0); // shifted player is safely above
  });
});
