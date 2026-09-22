import { describe, expect, it } from 'vitest';
import {
  PlaceholderVehicle,
  MULE_TUNE,
  type DriverIntent,
} from '../src/sim/vehicle';

const FULL: DriverIntent = { steer: 0, throttle: 1, brake: 0 };
const IDLE: DriverIntent = { steer: 0, throttle: 0, brake: 0 };

function run(v: PlaceholderVehicle, input: (t: number) => DriverIntent, seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) v.step(1 / 60, input(i / 60));
}

describe('PlaceholderVehicle (M0 mule)', () => {
  it('accelerates to its hard speed limit and never exceeds it', () => {
    const v = new PlaceholderVehicle();
    run(v, () => FULL, 120);
    expect(v.speed).toBeLessThanOrEqual(MULE_TUNE.vMax + 1e-9);
    expect(v.speed).toBeGreaterThan(MULE_TUNE.vMax * 0.9);
  });

  it('coasts to a stop from speed with no input', () => {
    const v = new PlaceholderVehicle();
    run(v, () => FULL, 8);
    run(v, () => IDLE, 400);
    expect(v.speed).toBe(0);
  });

  it('brakes hard to a full stop', () => {
    const v = new PlaceholderVehicle();
    run(v, () => FULL, 10);
    expect(v.speed).toBeGreaterThan(40); // genuinely moving first
    run(v, () => ({ steer: 0, throttle: 0, brake: 1 }), 30);
    expect(v.speed).toBe(0);
  });

  it('stays within the placeholder road bounds', () => {
    const v = new PlaceholderVehicle();
    run(v, () => ({ steer: 1, throttle: 1, brake: 0 }), 120);
    expect(Math.abs(v.x)).toBeLessThanOrEqual(MULE_TUNE.roadHalfWidth + 1e-9);
  });

  it('is bit-deterministic: identical scripted input ⇒ identical state hash', () => {
    const script = (t: number): DriverIntent => ({
      steer: Math.sin(t * 1.7),
      throttle: 0.5 + 0.5 * Math.cos(t * 0.6),
      brake: Math.max(0, Math.sin(t * 2.3)),
    });
    const a = new PlaceholderVehicle();
    const b = new PlaceholderVehicle();
    run(a, script, 60);
    run(b, script, 60);
    expect(a.hash()).toBe(b.hash());
    expect(a.distance).toBeGreaterThan(500); // the run actually drove somewhere
  });

  it('diverges under different input (hash is sensitive)', () => {
    const a = new PlaceholderVehicle();
    const b = new PlaceholderVehicle();
    run(a, () => ({ steer: 0.1, throttle: 1, brake: 0 }), 30);
    run(b, () => ({ steer: -0.1, throttle: 1, brake: 0 }), 30);
    expect(a.hash()).not.toBe(b.hash());
  });
});
