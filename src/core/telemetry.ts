// Run telemetry (M8, PLAN §1 perf/telemetry): a 1 Hz sample of the run's
// vital signs (speed, health, score, combo, assist) plus the final audit
// block, exportable as JSON from the results screen. Tuning data for the
// PLAN §11 score hypotheses — and a per-run record of how the game FEELS.

import type { Car } from '../sim/car';
import type { ScoringSystem } from '../sim/scoring';
import type { DamageSystem } from '../sim/damage';

export interface TelemetrySample {
  /** run time, s */
  t: number;
  /** speed, km/h */
  v: number;
  /** health fraction 0..1 */
  hp: number;
  /** cumulative score */
  score: number;
  /** combo depth */
  combo: number;
  /** auto-brake assist level 0..1 */
  assist: number;
}

export interface RunTelemetry {
  version: 1;
  car: string;
  env: string;
  seed: number;
  startedAt: string;
  durationSec: number;
  topSpeedKmh: number;
  endState: string;
  score: number;
  counts: Record<string, number>;
  samples: TelemetrySample[];
}

const MAX_SAMPLES = 900; // 15 minutes at 1 Hz

export class TelemetryRecorder {
  private readonly samples: TelemetrySample[] = [];
  private acc = 0;
  private tAcc = 0;
  private topSpeed = 0;

  constructor(
    private readonly car: Car,
    private readonly env: string,
    private readonly seed: number,
    private readonly startedAt = new Date().toISOString(),
  ) {}

  /** Call per sim step; samples internally at 1 Hz. */
  sample(dt: number, scoring: ScoringSystem, damage: DamageSystem, assistBrake: number): void {
    const v = Math.abs(this.car.u) * 3.6;
    if (v > this.topSpeed) this.topSpeed = v;
    this.tAcc += dt;
    this.acc += dt;
    if (this.acc < 1 || this.samples.length >= MAX_SAMPLES) return;
    this.acc = 0;
    this.samples.push({
      t: Math.round(this.tAcc),
      v: Math.round(v),
      hp: Math.round(damage.healthFrac * 100) / 100,
      score: Math.round(scoring.score),
      combo: scoring.combo,
      assist: Math.round(assistBrake * 100) / 100,
    });
  }

  finish(durationSec: number, scoring: ScoringSystem, damage: DamageSystem): RunTelemetry {
    return {
      version: 1,
      car: this.car.tune.id,
      env: this.env,
      seed: this.seed,
      startedAt: this.startedAt,
      durationSec: Math.round(durationSec * 10) / 10,
      topSpeedKmh: Math.round(this.topSpeed),
      endState: damage.state,
      score: Math.round(scoring.score),
      counts: { ...scoring.counts } as Record<string, number>,
      samples: this.samples,
    };
  }

  /** Browser download; returns false outside the DOM (tests). */
  static download(data: RunTelemetry): boolean {
    if (typeof document === 'undefined') return false;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `velocifist-run-${data.startedAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  }
}
