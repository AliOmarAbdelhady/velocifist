// M6 art pass: damage presentation mapping, car profiles, grade look data.
// (Meshes themselves are live-verified in the browser — see PROGRESS.)

import { describe, expect, it } from 'vitest';
import { damageVisual, profileFor, smokeRate } from '../src/render/carView';
import { GRADE_PRESETS, chromaAmount } from '../src/render/grade';
import type { ThemeId } from '../src/sim/road';

const STATES = ['PRISTINE', 'DAMAGED', 'CRITICAL', 'WRECKED'] as const;

describe('damage visuals', () => {
  it('degrades monotonically: paint darkens, roughens, bumper loosens, lights die', () => {
    const vs = STATES.map(damageVisual);
    for (let i = 1; i < vs.length; i++) {
      expect(vs[i].paintMul).toBeLessThan(vs[i - 1].paintMul);
      expect(vs[i].rough).toBeGreaterThan(vs[i - 1].rough);
      expect(vs[i].bumperTilt).toBeGreaterThanOrEqual(vs[i - 1].bumperTilt);
      expect(vs[i].lightFrac).toBeLessThanOrEqual(vs[i - 1].lightFrac);
    }
    expect(vs[0].bumperTilt).toBe(0);
    expect(vs[3].lightFrac).toBe(0);
  });

  it('smoke rate escalates with damage and maxes at wreck', () => {
    const rates = STATES.map(smokeRate);
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1]);
    }
    expect(rates[0]).toBe(0);
    expect(rates[3]).toBeGreaterThanOrEqual(20);
  });
});

describe('car silhouettes', () => {
  it('all three archetypes have closed, bounded profiles', () => {
    for (const id of ['falcone-gt', 'vipera-rs', 'bruto-widebody']) {
      const pts = profileFor(id);
      expect(pts.length).toBeGreaterThanOrEqual(12);
      for (const [fx, fy] of pts) {
        expect(Math.abs(fx)).toBeLessThanOrEqual(0.55);
        expect(fy).toBeGreaterThan(0);
        expect(fy).toBeLessThanOrEqual(1.05);
        expect(Number.isFinite(fx)).toBe(true);
        expect(Number.isFinite(fy)).toBe(true);
      }
    }
  });

  it('unknown ids fall back to the GT profile', () => {
    expect(profileFor('does-not-exist')).toBe(profileFor('falcone-gt'));
  });

  it('the hyper car sits lower than the muscle box', () => {
    const noseY = (id: string) =>
      Math.min(...profileFor(id).filter(([fx]) => fx > 0.44).map(([, fy]) => fy));
    expect(noseY('vipera-rs')).toBeLessThan(noseY('bruto-widebody'));
  });
});

describe('grade look', () => {
  const themes: ThemeId[] = ['coastal', 'neon', 'desert'];

  it('every theme has a preset in sane ranges', () => {
    for (const t of themes) {
      const p = GRADE_PRESETS[t];
      expect(p.saturation).toBeGreaterThan(0.9);
      expect(p.saturation).toBeLessThan(1.4);
      expect(p.vignette).toBeGreaterThan(0);
      expect(p.vignette).toBeLessThan(0.6);
      for (const c of [...p.tintShadow, ...p.tintHigh]) {
        expect(c).toBeGreaterThan(0.8);
        expect(c).toBeLessThan(1.2);
      }
    }
  });

  it('neon is the most graded / darkest-vignetted theme', () => {
    expect(GRADE_PRESETS.neon.saturation).toBeGreaterThanOrEqual(GRADE_PRESETS.coastal.saturation);
    expect(GRADE_PRESETS.neon.vignette).toBeGreaterThan(GRADE_PRESETS.desert.vignette);
  });

  it('chromatic aberration is ~zero parked and grows with speed²', () => {
    expect(chromaAmount(0)).toBeLessThan(0.001);
    expect(chromaAmount(0.5)).toBeGreaterThan(chromaAmount(0.25));
    expect(chromaAmount(1)).toBeGreaterThan(chromaAmount(0.5) * 2);
    expect(chromaAmount(2)).toBe(chromaAmount(1)); // clamped
  });
});
