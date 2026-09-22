// DamageSystem (PLAN §9, M5): impulse → health → PRISTINE → DAMAGED (65%) →
// CRITICAL (30%, −8% power) → WRECKED (0, run over). Same-window impacts
// (0.8 s) merge at 50% so multi-contact scrapes don't drain a run.
// FLOW regen (scoring system) heals up to 35% cap — EASY-first: the car
// recovers while you drive cleanly, it only dies to real mistakes.

export type HealthState = 'PRISTINE' | 'DAMAGED' | 'CRITICAL' | 'WRECKED';

export interface DamageEvent {
  kind: 'HIT' | 'STATE' | 'WRECK';
  health: number;
  state: HealthState;
  impulse: number;
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export class DamageSystem {
  readonly healthMax: number;
  health: number;
  state: HealthState = 'PRISTINE';
  private windowT = 0;
  private windowCharge = 0;
  private wreckFired = false;
  /** seconds since WRECKED — the flow uses this for the finale timeline */
  wreckTimer = -1;
  private readonly regenCapFrac: number;
  /** M7 "very easy": 30 m/s head-on ≈ 44% of a 110 hp car (was 51%) */
  private static readonly DMG_SCALE = 7.5;

  private readonly events: DamageEvent[] = Array.from({ length: 8 }, () => ({
    kind: 'HIT' as const, health: 0, state: 'PRISTINE' as HealthState, impulse: 0,
  }));
  private eventCount = 0;

  constructor(healthMax: number, regenCapFrac = 0.45) {
    this.healthMax = healthMax;
    this.health = healthMax;
    this.regenCapFrac = regenCapFrac;
  }

  /** One sim step. `impulses` = closing speeds from this tick's crash events. */
  update(dt: number, impulses: readonly number[], flowRegen: number): DamageEvent[] {
    this.eventCount = 0;

    if (this.state !== 'WRECKED') {
      // merge same-window impacts (0.8 s @ 50%)
      this.windowT = Math.max(0, this.windowT - dt);
      let incoming = 0;
      for (const j of impulses) incoming += this.rawDamage(j);
      if (incoming > 0) {
        if (this.windowT > 0) incoming *= 0.5;
        this.windowCharge = incoming;
        this.windowT = 0.8;
        this.health = Math.max(0, this.health - incoming);
        this.emit('HIT', incoming);
        this.refreshState();
      } else if (flowRegen > 0 && this.health > 0) {
        // FLOW regen — heals toward the cap fraction, never above it
        const cap = this.regenCapFrac * this.healthMax;
        if (this.health < cap) {
          this.health = Math.min(cap, this.health + flowRegen);
          this.refreshState();
        }
      }
      if (this.health <= 0 && !this.wreckFired) {
        this.wreckFired = true;
        this.state = 'WRECKED';
        this.wreckTimer = 0;
        this.emit('WRECK', 0);
      }
    } else {
      this.wreckTimer += dt;
    }

    return this.events.slice(0, this.eventCount);
  }

  /** dmg = k·(J/Jref)^1.4 (PLAN §9), k softened in M7 (very-easy directive). */
  private rawDamage(closing: number): number {
    if (closing <= 0.5) return 0;
    return DamageSystem.DMG_SCALE * Math.pow(closing / 8, 1.4);
  }

  private refreshState(): void {
    const frac = this.health / this.healthMax;
    const next: HealthState =
      frac > 0.65 ? 'PRISTINE' : frac > 0.3 ? 'DAMAGED' : frac > 0 ? 'CRITICAL' : this.state;
    if (next !== this.state) {
      this.state = next;
      this.emit('STATE', 0);
    }
  }

  private emit(kind: DamageEvent['kind'], impulse: number): void {
    if (this.eventCount >= this.events.length) return;
    this.events[this.eventCount++] = {
      kind, health: this.health, state: this.state, impulse,
    };
  }

  /** Engine power multiplier for the car (CRITICAL = −8%). */
  get powerScale(): number {
    return this.state === 'CRITICAL' ? 0.92 : 1;
  }

  get wrecked(): boolean {
    return this.state === 'WRECKED';
  }

  get healthFrac(): number {
    return clamp(this.health / this.healthMax, 0, 1);
  }
}
