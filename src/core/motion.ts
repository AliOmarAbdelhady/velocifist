// Motion-comfort policy (M9, PLAN §7/§15): one place decides whether the
// shake / speed-lines / FOV-swing effects may run. `prefers-reduced-motion`
// is respected by default ('auto') but the player can force it on or off —
// comfort toggles are AND-ed with the resolved reduction, never OR-ed.

export type ReducedMotionSetting = 'auto' | 'on' | 'off';

/** Effective comfort view handed to scene/rig/fx. */
export interface ComfortView {
  /** any motion amplification allowed at all? (reduced motion = no) */
  reduced: boolean;
  /** camera micro-shake allowed (user toggle ∧ ¬reduced) */
  shake: boolean;
  /** speed-line streaks allowed (user toggle ∧ ¬reduced) */
  speedLines: boolean;
}

export function resolveReducedMotion(
  setting: ReducedMotionSetting,
  mediaQueryMatches: boolean | null,
): boolean {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return mediaQueryMatches === true;
}

/** Pure derivation from raw settings — the options screen calls this live. */
export function deriveComfort(
  reduced: boolean,
  shakeSetting: boolean,
  speedLinesSetting: boolean,
): ComfortView {
  return {
    reduced,
    shake: shakeSetting && !reduced,
    speedLines: speedLinesSetting && !reduced,
  };
}

/** Live media-query probe (null where matchMedia is unavailable, e.g. tests). */
export function prefersReducedMotion(): boolean | null {
  if (typeof matchMedia !== 'function') return null;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return null;
  }
}
