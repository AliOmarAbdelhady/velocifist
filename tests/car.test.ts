// M1 validation protocol (PLAN §6.3) as automated gates. These numbers define
// "physically plausible + fun" for each car; they are tuned in the car JSONs and
// enforced here on every build. The human half of the gate (fun panel ≥ 4/5)
// runs on the user's machine.

import { describe, expect, it } from 'vitest';
import { Car, type CarTune } from '../src/sim/car';
import { CAR_TUNES } from '../src/sim/carTunes';
import type { DriverIntent } from '../src/sim/intent';

const DT = 1 / 60;
const THR: DriverIntent = { steer: 0, throttle: 1, brake: 0 };
const IDLE: DriverIntent = { steer: 0, throttle: 0, brake: 0 };
const BRAKE: DriverIntent = { steer: 0, throttle: 0, brake: 1 };

function steps(seconds: number): number {
  return Math.round(seconds * 60);
}

function run(c: Car, input: (t: number) => DriverIntent, seconds: number, observe?: (c: Car, t: number) => void): void {
  for (let i = 0; i < steps(seconds); i++) {
    const t = i * DT;
    c.step(DT, input(t));
    if (observe) observe(c, t);
  }
}

function accelTo(c: Car, targetU: number, maxSeconds = 60): boolean {
  for (let i = 0; i < steps(maxSeconds); i++) {
    c.step(DT, THR);
    if (c.u >= targetU) return true;
  }
  return c.u >= targetU;
}

// Dynamics-inspection tests run on a virtual wide pad: any gripping turn at
// speed drifts tens of metres within seconds — the real road would pin the car
// against the guardrail and corrupt the measurement. (Tune is data; clone it.)
function wideRoad(tune: CarTune): CarTune {
  return { ...tune, roadHalfWidth: 5000 };
}

describe.each(CAR_TUNES.map((t) => [t.name, t] as const))('validation: %s', (_name, tune) => {
  it('reaches 100 km/h within ±12% of its target', () => {
    const c = new Car(tune);
    let t100 = -1;
    run(c, () => THR, 15, (cc, t) => {
      if (t100 < 0 && cc.u * 3.6 >= 100) t100 = t;
    });
    expect(t100).toBeGreaterThan(0);
    expect(Math.abs(t100 - tune.target0100)).toBeLessThanOrEqual(tune.target0100 * 0.12);
  });

  it('brakes 100→0 within ±15% of its target distance', () => {
    const c = new Car(tune);
    expect(accelTo(c, 29)).toBe(true);
    let zStart = 0;
    let started = false;
    let stopped = -1;
    run(
      c,
      () => BRAKE,
      15,
      (cc, t) => {
        if (!started && cc.u <= 27.78) {
          started = true;
          zStart = cc.z;
        }
        if (started && stopped < 0 && cc.u <= 0.05) stopped = t;
      },
    );
    expect(started).toBe(true);
    expect(stopped).toBeGreaterThan(0);
    const dist = zStart - c.z; // car travels toward −z
    expect(Math.abs(dist - tune.targetBrake)).toBeLessThanOrEqual(tune.targetBrake * 0.15);
  });

  it('holds a steady corner above 1.0 g lateral (wide pad, coasting)', () => {
    const c = new Car(wideRoad(tune));
    expect(accelTo(c, 28)).toBe(true);
    run(c, () => IDLE, 0.5);
    let maxG = 0;
    run(c, () => ({ steer: 0.5, throttle: 0, brake: 0 }), 1.5, (cc) => {
      maxG = Math.max(maxG, cc.ayLast / 9.81);
    });
    expect(maxG).toBeGreaterThanOrEqual(1.0);
    expect(maxG).toBeLessThanOrEqual(1.8); // and not glue-tires either
  });

  it('step-steer yaw response settles without twitch (wide pad, overshoot < 1.4)', () => {
    const c = new Car(wideRoad(tune));
    expect(accelTo(c, 27.8)).toBe(true);
    run(c, () => IDLE, 1); // settle
    let peak = 0;
    const tail: number[] = [];
    run(
      c,
      () => ({ steer: 0.25, throttle: 0.4, brake: 0 }),
      4,
      (cc, t) => {
        peak = Math.max(peak, Math.abs(cc.omega));
        if (t > 3.5) tail.push(Math.abs(cc.omega));
      },
    );
    const steady = tail.reduce((s, v) => s + v, 0) / tail.length;
    expect(steady).toBeGreaterThan(0.05);
    expect(peak / steady).toBeLessThan(1.4);
  });

  it('slaloms at ~120 km/h staying on the road and stable', () => {
    const c = new Car(tune);
    expect(accelTo(c, 33.3)).toBe(true);
    // Closed-loop driver (a sine steer alone random-walks off any road).
    // Cascade, like a real lane-keep: aim at a moving preview point → desired
    // heading; heading loop with yaw damping; bounded ±0.4 authority so the
    // driver itself can never spin the car. Weave target ±1.5 m @ 0.5 Hz ≈ 1.2 g.
    const A = 1.5;
    const F = 0.5;
    let maxBeta = 0;
    let minU = Infinity;
    run(
      c,
      (t) => {
        const xT = A * Math.sin(2 * Math.PI * F * t);
        const vxT = A * 2 * Math.PI * F * Math.cos(2 * Math.PI * F * t);
        let psiDes = Math.atan2(0.8 * (xT - c.x) + 0.5 * (vxT - (c.u * Math.sin(c.heading) + c.w * Math.cos(c.heading))), Math.max(c.u, 8));
        psiDes = Math.max(-0.25, Math.min(0.25, psiDes));
        let steer = 2.0 * (psiDes - c.heading) - 0.5 * c.omega;
        steer = Math.max(-0.4, Math.min(0.4, steer));
        const throttle = Math.max(0, Math.min(1, (36 - c.u) * 0.2));
        const brake = c.u > 38.5 ? 0.25 : 0;
        return { steer, throttle, brake };
      },
      8,
      (cc) => {
        maxBeta = Math.max(maxBeta, Math.abs(cc.beta));
        minU = Math.min(minU, cc.u);
        expect(Math.abs(cc.x)).toBeLessThanOrEqual(tune.roadHalfWidth + 0.91);
        expect(Number.isFinite(cc.x + cc.z + cc.heading + cc.u + cc.w + cc.omega)).toBe(true);
      },
    );
    expect(maxBeta).toBeLessThan(0.5); // ~29° — slides allowed, spins not
    expect(minU).toBeGreaterThan(12);
  });

  it('asymptotes to its top speed and never exceeds it', () => {
    const c = new Car(tune);
    run(c, () => THR, 250);
    expect(c.u).toBeLessThanOrEqual(tune.vMax + 0.05);
    expect(c.u).toBeGreaterThanOrEqual(tune.vMax * 0.93);
  });

  it('is bit-deterministic over 60 s of scripted input (wide pad)', () => {
    const script = (t: number): DriverIntent => ({
      steer: 0.4 * Math.sin(t * 0.9) * Math.sin(t * 0.13 + 2),
      throttle: 0.5 + 0.5 * Math.sin(t * 0.21),
      brake: Math.sin(t * 1.43 + 1) > 0.8 ? 1 : 0,
    });
    const a = new Car(wideRoad(tune));
    const b = new Car(wideRoad(tune));
    run(a, script, 60);
    run(b, script, 60);
    expect(a.hash()).toBe(b.hash());
    expect(a.distance).toBeGreaterThan(500);
  });

  it('survives 10 minutes of abuse input without NaN or leaving the world', () => {
    const c = new Car(tune);
    const script = (t: number): DriverIntent => ({
      steer: Math.sin(t * 0.9) * Math.sin(t * 0.13 + 2),
      throttle: 0.5 + 0.5 * Math.sin(t * 0.21),
      brake: Math.max(0, Math.sin(t * 1.43 + 1)) > 0.8 ? 1 : 0,
    });
    run(c, script, 600, (cc) => {
      expect(Number.isFinite(cc.x + cc.z + cc.heading + cc.u + cc.w + cc.omega + cc.steer)).toBe(true);
    });
    expect(Math.abs(c.x)).toBeLessThanOrEqual(tune.roadHalfWidth + 1.0);
  });
});

// keep tune objects referenced for type-checking the import shape
export const _tunes: readonly CarTune[] = CAR_TUNES;
