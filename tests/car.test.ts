// M1 validation protocol (PLAN §6.3) as automated gates. These numbers define
// "physically plausible + fun" for each car; they are tuned in the car JSONs and
// enforced here on every build. The human half of the gate (fun panel ≥ 4/5)
// runs on the user's machine.

import { describe, expect, it } from 'vitest';
import { Car, type CarTune } from '../src/sim/car';
import { CAR_TUNES } from '../src/sim/carTunes';
import { RoadSystem, CHUNK_LEN } from '../src/sim/road';
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
  it('reaches 75 km/h within ±12% of its target (cruise regime)', () => {
    const c = new Car(tune);
    // 75 km/h for the 80 km/h cars; car-relative so the 75 km/h Bruto works
    const gate = Math.min(75 / 3.6, tune.vCruise * 0.965);
    let t75 = -1;
    run(c, () => THR, 15, (cc, t) => {
      if (t75 < 0 && cc.u >= gate) t75 = t;
    });
    expect(t75).toBeGreaterThan(0);
    expect(Math.abs(t75 - tune.targetCruise)).toBeLessThanOrEqual(tune.targetCruise * 0.12);
  });

  it('brakes from cruise to 0 within ±15% of its target distance', () => {
    const c = new Car(tune);
    expect(accelTo(c, tune.vCruise - 1.8)).toBe(true); // outside the limiter's dead band (gap ~2% at the 200 cap, PILL 107)
    const from = tune.vCruise - 1.8;
    let zStart = 0;
    let started = false;
    let dist = -1;
    run(
      c,
      () => BRAKE,
      15,
      (cc) => {
        if (!started && cc.u <= from) {
          started = true;
          zStart = cc.z;
        }
        // capture at the stop INSTANT — reverse gear (ADR-013) keeps driving
        // the car backward afterwards and would corrupt a final-position read
        if (started && dist < 0 && cc.u <= 0.05) dist = zStart - cc.z;
      },
    );
    expect(started).toBe(true);
    expect(dist).toBeGreaterThan(0);
    expect(Math.abs(dist - tune.targetBrake)).toBeLessThanOrEqual(tune.targetBrake * 0.15);
  });

  it('corners on rails at ~2 g (ADR-013 grip governor, full lock, wide pad)', () => {
    const c = new Car(wideRoad(tune));
    expect(accelTo(c, tune.vCruise - 1.8)).toBe(true);
    run(c, () => IDLE, 0.5);
    let maxG = 0;
    run(c, () => ({ steer: 1, throttle: 0, brake: 0 }), 1.5, (cc) => {
      maxG = Math.max(maxG, Math.abs(cc.ayLast) / 9.81);
    });
    // supercar glue: well past road-car grip, and CAPPED by the governor
    expect(maxG).toBeGreaterThanOrEqual(1.5);
    expect(maxG).toBeLessThanOrEqual(2.6); // ADR-016: downforce cars peak higher at the 200 cap (Bruto 0.35 → ~2.5 g transient)
  });

  it('step-steer yaw response settles without twitch (wide pad, overshoot < 1.4)', () => {
    const c = new Car(wideRoad(tune));
    expect(accelTo(c, tune.vCruise - 1.2)).toBe(true);
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

  it('slaloms near cruise speed staying on the road and stable', () => {
    const c = new Car(tune);
    expect(accelTo(c, tune.vCruise - 3)).toBe(true);
    // Closed-loop driver (a sine steer alone random-walks off any road).
    // Cascade, like a real lane-keep: aim at a moving preview point → desired
    // heading; heading loop with yaw damping; bounded ±0.4 authority so the
    // driver itself can never spin the car. Weave ±1.5 m @ 0.4 Hz ≈ 0.97 g —
    // trackable inside the cruise regime's grip envelope.
    const A = 1.5;
    const F = 0.4;
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
        // full gas everywhere — the cruise limiter holds the speed (ADR-012)
        return { steer, throttle: 1, brake: 0 };
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

  it('plateaus at the cruise cap under full gas and never exceeds it', () => {
    const c = new Car(tune);
    run(c, () => THR, 250);
    expect(c.u).toBeLessThanOrEqual(tune.vCruise + 0.05);
    expect(c.u).toBeGreaterThanOrEqual(tune.vCruise * 0.93);
    expect(c.u).toBeLessThan(tune.vMax); // headroom exists but is never used
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

describe('road guide (M4 curved world)', () => {
  it('a road-following driver holds the lane through bends; the wall caps excursions', () => {
    // find a bending chunk on a fixed-seed desert spine and drop the car on it
    const road = new RoadSystem({ seed: 606, theme: 'desert' });
    road.ensureTo(CHUNK_LEN * 12);
    let s0 = 0;
    const sp = { x: 0, z: 0, heading: 0 };
    for (let i = 3; i < 12; i++) {
      if (road.chunkFeature(i).dTheta !== 0) {
        s0 = i * CHUNK_LEN;
        break;
      }
    }
    road.sample(s0, sp);
    const car = new Car(CAR_TUNES[0]);
    car.guide = road;
    car.x = sp.x;
    car.z = sp.z;
    car.heading = sp.heading;
    car.u = 28;
    const pr = { s: 0, lat: 0 };
    let maxLat = 0;
    let minU = 99;
    for (let i = 0; i < 60 * 40; i++) {
      // cascade driver in the ROAD frame: hold heading ≈ spine heading, lat ≈ 0
      road.project(car.x, car.z, pr);
      road.sample(pr.s + 16, sp); // look-ahead spine point
      const targetHeading = sp.heading - 0.05 * pr.lat;
      let steer = 2.4 * (targetHeading - car.heading) - 0.7 * car.omega;
      steer = Math.max(-0.5, Math.min(0.5, steer));
      car.step(DT, { steer, throttle: 0.6, brake: 0 });
      road.project(car.x, car.z, pr);
      maxLat = Math.max(maxLat, Math.abs(pr.lat));
      minU = Math.min(minU, car.u);
    }
    // on the asphalt through the bends, and the wall never lets |lat| run away
    const wall = CAR_TUNES[0].roadHalfWidth + 0.9;
    expect(maxLat).toBeLessThanOrEqual(wall + 0.05);
    expect(minU).toBeGreaterThan(20); // driving, not beached
    expect(Number.isFinite(car.x + car.z + car.u)).toBe(true);
  });

  it('guide changes nothing on a straight road with assists off (lat == x)', () => {
    const road = RoadSystem.straight();
    const car = new Car(CAR_TUNES[0]);
    car.guide = road;
    car.laneAssist = false;
    car.u = 30;
    const ref = new Car(CAR_TUNES[0]);
    ref.u = 30;
    for (let i = 0; i < 60 * 10; i++) {
      const intent = { steer: 0.05 * Math.sin(i * 0.02), throttle: 0.5, brake: 0 };
      car.step(DT, intent);
      ref.step(DT, intent);
    }
    expect(car.hash()).toBe(ref.hash()); // identical physics, straight guide
  });

  it('ADR-014: NO auto-recentering — an offset car keeps its lateral position (heading assist only)', () => {
    const road = RoadSystem.straight();
    const car = new Car(CAR_TUNES[0]);
    car.guide = road;
    car.u = 25;
    car.x = -5.5; // deliberate off-centre placement, hands OFF the wheel
    const pr = { s: 0, lat: 0 };
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (let i = 0; i < 60 * 20; i++) {
      car.step(DT, { steer: 0, throttle: 1, brake: 0 });
      road.project(car.x, car.z, pr);
      minLat = Math.min(minLat, pr.lat);
      maxLat = Math.max(maxLat, pr.lat);
    }
    // the old centre pull would have dragged lat → 0; freedom means it stays
    expect(Math.abs((minLat + maxLat) / 2 + 5.5)).toBeLessThan(2.5); // still ~where placed
    expect(maxLat - minLat).toBeLessThan(4.5); // and not drifting away either
  });
});
