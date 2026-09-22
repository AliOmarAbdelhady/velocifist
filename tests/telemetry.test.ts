// M8 telemetry gates: 1 Hz sampling, cap, audit shape, download guard.

import { describe, expect, it } from 'vitest';
import { TelemetryRecorder } from '../src/core/telemetry';
import { Car } from '../src/sim/car';
import { CAR_TUNES } from '../src/sim/carTunes';
import { ScoringSystem } from '../src/sim/scoring';
import { DamageSystem } from '../src/sim/damage';

const DT = 1 / 60;

/** The recorder samples ITS car reference — drive that same instance. */
function drive(recorder: TelemetryRecorder, car: Car, seconds: number, speedMs = 40): void {
  car.u = speedMs;
  const scoring = new ScoringSystem();
  const damage = new DamageSystem(110);
  for (let i = 0; i < seconds * 60; i++) {
    recorder.sample(DT, scoring, damage, i % 120 < 60 ? 0.5 : 0);
  }
}

const mkRec = (env = 'coastal', seed = 123): { rec: TelemetryRecorder; car: Car } => {
  const car = new Car(CAR_TUNES[0]);
  return { rec: new TelemetryRecorder(car, env, seed), car };
};

describe('TelemetryRecorder', () => {
  it('samples at ~1 Hz (60 s drive → ~60 samples)', () => {
    const { rec, car } = mkRec();
    drive(rec, car, 60);
    const data = rec.finish(60, new ScoringSystem(), new DamageSystem(110));
    expect(data.samples.length).toBeGreaterThanOrEqual(58);
    expect(data.samples.length).toBeLessThanOrEqual(62);
  });

  it('sample timestamps are 1 s apart and carry the vitals', () => {
    const { rec, car } = mkRec('neon', 5);
    drive(rec, car, 10, 50);
    const data = rec.finish(10, new ScoringSystem(), new DamageSystem(110));
    for (let i = 1; i < data.samples.length; i++) {
      expect(data.samples[i].t - data.samples[i - 1].t).toBe(1);
    }
    expect(data.samples[0].v).toBe(180); // 50 m/s
    expect(data.topSpeedKmh).toBe(180);
    expect(data.samples.every((s) => s.hp >= 0 && s.hp <= 1)).toBe(true);
    expect(data.samples.some((s) => s.assist > 0)).toBe(true);
  });

  it('caps the buffer (15 min hard ceiling)', () => {
    const { rec, car } = mkRec('desert', 1);
    drive(rec, car, 60 * 16);
    const data = rec.finish(960, new ScoringSystem(), new DamageSystem(110));
    expect(data.samples.length).toBeLessThanOrEqual(900);
  });

  it('finish() emits the full audit block', () => {
    const car = new Car(CAR_TUNES[1]);
    const rec = new TelemetryRecorder(car, 'coastal', 77, '2026-09-23T10:00:00Z');
    drive(rec, car, 5);
    const scoring = new ScoringSystem();
    scoring.onNearMisses([{ agentId: 1, tier: 'NEAR', clearance: 1, closingSpeed: 20, oncoming: false, side: 2 }]);
    const damage = new DamageSystem(85);
    const data = rec.finish(5.4, scoring, damage);
    expect(data.version).toBe(1);
    expect(data.car).toBe('vipera-rs');
    expect(data.env).toBe('coastal');
    expect(data.seed).toBe(77);
    expect(data.startedAt).toBe('2026-09-23T10:00:00Z');
    expect(data.durationSec).toBeCloseTo(5.4, 5);
    expect(data.endState).toBe('PRISTINE');
    expect(data.counts.near).toBe(1);
    expect(data.samples.length).toBeGreaterThanOrEqual(4);
  });

  it('download() is a no-op outside the DOM (tests: false, no throw)', () => {
    expect(
      TelemetryRecorder.download({
        version: 1, car: 'x', env: 'x', seed: 0, startedAt: '', durationSec: 0,
        topSpeedKmh: 0, endState: 'PRISTINE', score: 0, counts: {}, samples: [],
      }),
    ).toBe(false);
  });
});
