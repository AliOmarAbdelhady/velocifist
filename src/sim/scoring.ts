// ScoringSystem (PLAN §11.1, M5): passive speed stream + tiered near-miss
// bonuses (oncoming ×2) + clean passes + combo multiplier + clean streaks +
// FLOW state. Pure sim, deterministic, zero-alloc in the hot path (popup
// events go into a preallocated ring the HUD drains).
//
// EASY-FIRST note (ADR-008): the score model is unchanged — risk stays
// OPT-IN. The game never escalates to kill you; scoring is how you choose
// to make it thrilling.

import type { Car } from './car';
import type { NearMissEvent, PassEvent, NearMissTier } from './trafficTypes';

export interface ScoringConfig {
  /** passive points per second at vMax above the speed floor, PLAN: 60 */
  passiveRate: number;
  /** speed floor for passive score, m/s (ADR-012: 35 km/h — cruising always scores) */
  speedFloor: number;
  nearMissPoints: Record<NearMissTier, number>;
  oncomingMultiplier: number;
  comboWindowSec: number;
  comboStep: number; // ×(1 + 0.25·combo), PLAN
  comboCap: number;
  cleanPassBase: number;
  cleanPassFastBonus: number; // extra when closing > fastThreshold
  fastThreshold: number; // m/s (PLAN: 120 km/h)
  cleanStreakSec: number;
  cleanStreakBonus: number;
  flowComboThreshold: number;
  flowRegenPerSec: number; // HP/s — the damage system applies it
  flowRegenCap: number; // fraction of healthMax
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  passiveRate: 60,
  speedFloor: 35 / 3.6,
  nearMissPoints: { INCHES: 500, VERY_CLOSE: 250, NEAR: 100 },
  oncomingMultiplier: 2,
  comboWindowSec: 4,
  comboStep: 0.25,
  comboCap: 10,
  cleanPassBase: 50,
  cleanPassFastBonus: 100,
  fastThreshold: 6, // m/s closing — fast-pass bonus in the 80 km/h regime
  cleanStreakSec: 30,
  cleanStreakBonus: 1000,
  flowComboThreshold: 5,
  flowRegenPerSec: 0.5,
  flowRegenCap: 0.35,
};

export type PopupKind = 'NEAR_MISS' | 'CLEAN_PASS' | 'STREAK' | 'FLOW' | 'WRECK';

export interface ScorePopup {
  kind: PopupKind;
  tier: NearMissTier | null;
  points: number;
  combo: number;
  oncoming: boolean;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export class ScoringSystem {
  readonly cfg: ScoringConfig;
  score = 0;
  combo = 0;
  topCombo = 0;
  comboTimer = 0;
  flow = false;
  contactFreeSec = 0;
  topSpeed = 0;
  // breakdown for the results screen / anti-exploit audits
  counts = {
    inches: 0,
    veryClose: 0,
    near: 0,
    oncomingNearMiss: 0,
    cleanPass: 0,
    cleanPassFast: 0,
    streaks: 0,
    crashes: 0,
  };
  passiveScored = 0;
  bonusScored = 0;

  private readonly popups: ScorePopup[] = Array.from({ length: 24 }, () => ({
    kind: 'NEAR_MISS' as PopupKind, tier: null, points: 0, combo: 0, oncoming: false,
  }));
  private popupCount = 0;
  private streakAnnounced = 0;

  constructor(cfg: Partial<ScoringConfig> = {}) {
    this.cfg = { ...DEFAULT_SCORING_CONFIG, ...cfg };
  }

  /** One sim step: passive stream + timers (events are fed by the owner). */
  update(dt: number, car: Car): void {
    // ---- passive stream (×1.5 in FLOW) ----
    const v = Math.abs(car.u);
    if (v > this.topSpeed) this.topSpeed = v;
    if (v > this.cfg.speedFloor) {
      const frac = Math.min(1, v / car.tune.vCruise);
      const pts =
        this.cfg.passiveRate * frac * frac * dt * (this.flow ? 1.5 : 1);
      this.score += pts;
      this.passiveScored += pts;
      this.contactFreeSec += dt; // streaks are for DRIVING clean, not parking
    }
    this.tickTimers(dt);
  }

  /** Near-miss events from this tick: tier points × oncoming × combo. */
  onNearMisses(events: readonly NearMissEvent[]): void {
    for (const ev of events) {
      let pts = this.cfg.nearMissPoints[ev.tier];
      if (ev.oncoming) {
        pts *= this.cfg.oncomingMultiplier;
        this.counts.oncomingNearMiss++;
      }
      this.combo = Math.min(this.cfg.comboCap, this.combo + 1);
      this.comboTimer = this.cfg.comboWindowSec;
      if (this.combo > this.topCombo) this.topCombo = this.combo;
      const mult = this.comboMultiplier;
      const total = Math.round(pts * mult);
      this.score += total;
      this.bonusScored += total;
      if (ev.tier === 'INCHES') this.counts.inches++;
      else if (ev.tier === 'VERY_CLOSE') this.counts.veryClose++;
      else this.counts.near++;
      this.popup('NEAR_MISS', ev.tier, total, ev.oncoming);
      if (!this.flow && this.combo >= this.cfg.flowComboThreshold) {
        this.flow = true;
        this.popup('FLOW', null, 0, false);
      }
    }
  }

  /** Clean-pass events from this tick. */
  onPasses(events: readonly PassEvent[]): void {
    for (const ev of events) {
      let pts = this.cfg.cleanPassBase;
      if (ev.closingSpeed > this.cfg.fastThreshold) {
        pts += this.cfg.cleanPassFastBonus;
        this.counts.cleanPassFast++;
      }
      this.counts.cleanPass++;
      this.score += pts;
      this.bonusScored += pts;
      this.popup('CLEAN_PASS', null, pts, ev.oncoming);
    }
  }

  /** Crash count from this tick: combo dies, streak dies. */
  onCrashes(count: number): void {
    for (let i = 0; i < count; i++) {
      this.counts.crashes++;
      this.combo = 0;
      this.comboTimer = 0;
      this.flow = false;
      this.contactFreeSec = 0;
    }
  }

  private tickTimers(dt: number): void {
    if (dt <= 0) return;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
    if (this.combo < this.cfg.flowComboThreshold) this.flow = false;

    if (
      this.contactFreeSec >= this.cfg.cleanStreakSec * (this.streakAnnounced + 1) &&
      this.streakAnnounced < 100
    ) {
      this.streakAnnounced++;
      this.counts.streaks++;
      this.score += this.cfg.cleanStreakBonus;
      this.bonusScored += this.cfg.cleanStreakBonus;
      this.popup('STREAK', null, this.cfg.cleanStreakBonus, false);
    }
  }

  get comboMultiplier(): number {
    return 1 + this.cfg.comboStep * this.combo;
  }

  /** FLOW health regen for this step, clamped by the cap fraction (damage applies). */
  flowRegenClamped(dt: number, health: number, healthMax: number): number {
    if (!this.flow) return 0;
    const cap = this.cfg.flowRegenCap * healthMax;
    if (health >= cap) return 0;
    return Math.min(this.cfg.flowRegenPerSec * dt, cap - health);
  }

  private popup(kind: PopupKind, tier: NearMissTier | null, points: number, oncoming: boolean): void {
    if (this.popupCount >= this.popups.length) return; // ring full: drop oldest is fine at 24
    this.popups[this.popupCount++] = { kind, tier, points, combo: this.combo, oncoming };
  }

  /** Drain popup events for the HUD. */
  takePopups(): ScorePopup[] {
    if (this.popupCount === 0) return [];
    const out = this.popups.slice(0, this.popupCount);
    this.popupCount = 0;
    return out;
  }

  /** Determinism probe. */
  hash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      h ^= Math.floor(v * 256);
      h = Math.imul(h, 0x01000193) >>> 0;
    };
    mix(this.score);
    mix(this.combo);
    mix(this.topCombo);
    mix(this.contactFreeSec);
    mix(this.counts.crashes);
    return h.toString(16).padStart(8, '0');
  }
}

export { clamp };
