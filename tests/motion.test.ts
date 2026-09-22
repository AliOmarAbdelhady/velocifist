// Motion-comfort policy gates (M9): reduced-motion resolution + comfort
// derivation — toggles are AND-ed with reduction, never OR-ed around it.

import { describe, expect, it } from 'vitest';
import { resolveReducedMotion, deriveComfort } from '../src/core/motion';

describe('resolveReducedMotion', () => {
  it("'auto' follows the OS query", () => {
    expect(resolveReducedMotion('auto', true)).toBe(true);
    expect(resolveReducedMotion('auto', false)).toBe(false);
  });

  it("'auto' with no matchMedia available is unreduced (null probe)", () => {
    expect(resolveReducedMotion('auto', null)).toBe(false);
  });

  it("explicit settings override the query in both directions", () => {
    expect(resolveReducedMotion('on', false)).toBe(true);
    expect(resolveReducedMotion('off', true)).toBe(false);
  });
});

describe('deriveComfort', () => {
  it('reduced motion always wins over the user toggles', () => {
    const c = deriveComfort(true, true, true);
    expect(c.reduced).toBe(true);
    expect(c.shake).toBe(false);
    expect(c.speedLines).toBe(false);
  });

  it('unreduced: the toggles decide each effect independently', () => {
    expect(deriveComfort(false, false, true)).toEqual({
      reduced: false,
      shake: false,
      speedLines: true,
    });
    expect(deriveComfort(false, true, false)).toEqual({
      reduced: false,
      shake: true,
      speedLines: false,
    });
  });
});
