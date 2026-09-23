// DifficultyDirector (PLAN §11.2, M4 framework / M7 brain): owns the knobs
// that pace a run — traffic density ramp, feature probabilities, event rate.
// M4 ships the deterministic policy layer (road features consume it); the
// injector events (ROADBLOCK, CUTTER, …) and telemetry feedback land in M7.
//
// All formulas are the PLAN hypotheses — telemetry (M8) retunes them.

import { type FeaturePolicy, type ThemeId, THEME_POLICIES } from './road';

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * ESCALATING density (ADR-015/016, user directive): base 8 veh/km/lane with a
 * 3-minute warm-up (+3), then the road keeps FILLING — +1 per 45 s, capped
 * at 26 (the agent-pool ceiling for the spawn window). The longer you
 * drive, the denser the weave.
 */
export function densityAt(tSec: number, base = 8): number {
  const warm = base + 3 * Math.pow(Math.min(tSec / 180, 1), 1.25);
  return Math.min(26, warm + Math.max(0, (tSec - 180) / 45));
}

/** Event period — 40 s early → 24 s late (M7 injectors consume it). */
export function eventPeriodSec(tSec: number): number {
  return 40 - 16 * Math.min(tSec / 240, 1);
}

export interface DirectorState {
  runTime: number;
  earlyCrashes: number; // crashes within the first 90 s
  mercyUntil: number; // mercy window end (s)
}

export class DifficultyDirector {
  readonly seed: number;
  private st: DirectorState = { runTime: 0, earlyCrashes: 0, mercyUntil: -1 };

  constructor(seed: number) {
    this.seed = seed;
  }

  get state(): Readonly<DirectorState> {
    return this.st;
  }

  /** Called by the game loop with the run clock. */
  tick(dt: number): void {
    this.st.runTime += dt;
  }

  /** Called on player crash; two early crashes arm the mercy rule. */
  registerCrash(): void {
    if (this.st.runTime < 90) {
      this.st.earlyCrashes++;
      if (this.st.earlyCrashes === 2) {
        // 30 s density pause, unannounced (PLAN mercy rule)
        this.st.mercyUntil = this.st.runTime + 30;
      }
    }
  }

  /** Density multiplier vs. the session base — mercy freezes the ramp at 1. */
  get densityScale(): number {
    if (this.st.runTime < this.st.mercyUntil) return 1;
    return densityAt(this.st.runTime) / densityAt(0);
  }

  get eventRatePerSec(): number {
    return 1 / eventPeriodSec(this.st.runTime);
  }

  /**
   * Theme policy modulated by the relaxed profile: curvature rises a touch
   * over 4 minutes (variety), oncoming zones unlock after 45 s, construction
   * stays sparse. Deterministic in (theme, runTime).
   */
  featurePolicy(theme: ThemeId): FeaturePolicy {
    const base = THEME_POLICIES[theme];
    const ramp = Math.min(this.st.runTime / 240, 1);
    const onc =
      this.st.runTime < 45 ? 0 : clamp(base.oncomingP * (0.7 + 0.3 * ramp), 0, 0.5);
    return {
      oncomingP: onc,
      constructionP: clamp(base.constructionP * (0.8 + 0.3 * ramp), 0.04, 0.12),
      curveBias: clamp(base.curveBias * (0.9 + 0.25 * ramp), 0.8, 1.7),
    };
  }
}
