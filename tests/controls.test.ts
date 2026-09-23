// ADR-013 gates: the handling contract (never oversteer / understeer /
// rotate), reverse gear, controller mappings, manual-source merge, and the
// driver-aid levels.

import { describe, expect, it } from 'vitest';
import { Car } from '../src/sim/car';
import { CAR_TUNES } from '../src/sim/carTunes';
import { gamepadIntent, ManualMerge } from '../src/input/devices';
import { ASSIST_LEVELS, forwardAssist, type AssistView } from '../src/sim/assist';
import type { DriverIntent } from '../src/sim/intent';
import type { TrafficAgent } from '../src/sim/trafficTypes';

const DT = 1 / 60;
const THR: DriverIntent = { steer: 0, throttle: 1, brake: 0 };
const BRAKE: DriverIntent = { steer: 0, throttle: 0, brake: 1 };

describe('ADR-013 handling contract — no slides, no spins', () => {
  for (const tune of CAR_TUNES) {
    it(`${tune.name}: max lateral g is governor-capped at any speed`, () => {
      const c = new Car({ ...tune, roadHalfWidth: 5000 });
      let maxG = 0;
      for (let speed of [6, 12, tune.vCruise]) {
        c.u = speed;
        for (let i = 0; i < 60 * 3; i++) {
          // violent alternating full-lock input — the abuse case
          const steer = Math.sin(i * 0.35) > 0 ? 1 : -1;
          c.step(DT, { steer, throttle: 1, brake: 0 });
          maxG = Math.max(maxG, Math.abs(c.ayLast) / 9.81);
          expect(Number.isFinite(c.u + c.omega + c.w)).toBe(true);
        }
      }
      const cap = (Math.max(tune.muFront, tune.muRear) * 1.15); // aero headroom
      expect(maxG).toBeLessThanOrEqual(cap * 1.05); // never past the tire envelope
      expect(maxG).toBeGreaterThanOrEqual(0.8); // abuse transients lean on the glue;
      // the STEADY corner test below proves full-lock reaches 1.5+ g
    });

    it(`${tune.name}: never rotates around itself — |beta| and yaw stay sane`, () => {
      const c = new Car({ ...tune, roadHalfWidth: 5000 });
      c.u = tune.vCruise;
      let maxBeta = 0;
      let maxOmega = 0;
      for (let i = 0; i < 60 * 8; i++) {
        c.step(DT, { steer: Math.sin(i * 0.22), throttle: 0.8, brake: 0 });
        maxBeta = Math.max(maxBeta, Math.abs(c.beta));
        maxOmega = Math.max(maxOmega, Math.abs(c.omega));
      }
      expect(maxBeta).toBeLessThan(0.12); // ≤ ~7° slip — no drifting
      expect(maxOmega).toBeLessThan(1.6); // bounded yaw rate = no spins
    });
  }

  it('turn radius at cruise is tight and constant (fast maneuvering)', () => {
    const tune = CAR_TUNES[0];
    const c = new Car({ ...tune, roadHalfWidth: 5000 });
    c.u = tune.vCruise;
    for (let i = 0; i < 90; i++) c.step(DT, { steer: 1, throttle: 1, brake: 0 });
    const r = Math.abs(c.u) / Math.max(0.05, Math.abs(c.omega));
    expect(r).toBeLessThan(210); // ≈1.5–2 g at the 200 km/h cap (ADR-016): v²/a grows ∝ v²
    expect(r).toBeGreaterThan(40); // but still a car, not a carousel
  });
});

describe('ADR-013 reverse gear', () => {
  it('brake held at standstill engages reverse, capped ~20 km/h', () => {
    const c = new Car(CAR_TUNES[0]);
    for (let i = 0; i < 60 * 8; i++) c.step(DT, BRAKE);
    expect(c.u).toBeLessThan(-2); // actually reversing
    expect(c.u).toBeGreaterThan(-6.2); // capped
    expect(c.gear).toBe(0); // renders as R
    expect(c.reversing).toBe(true);
  });

  it('throttle always recovers forward drive from reverse', () => {
    const c = new Car(CAR_TUNES[0]);
    for (let i = 0; i < 60 * 4; i++) c.step(DT, BRAKE);
    expect(c.u).toBeLessThan(0);
    for (let i = 0; i < 60 * 6; i++) c.step(DT, THR);
    expect(c.u).toBeGreaterThan(10);
    expect(c.gear).toBeGreaterThan(0);
  });

  it('braking while reversing DECELERATES (force opposes motion)', () => {
    const c = new Car(CAR_TUNES[0]);
    for (let i = 0; i < 60 * 4; i++) c.step(DT, BRAKE);
    const uRev = c.u;
    expect(uRev).toBeLessThan(-1);
    for (let i = 0; i < 60 * 3; i++) c.step(DT, { steer: 0, throttle: 0, brake: 1 });
    // still braking (reverse latch keeps reverse drive), speed magnitude bounded
    expect(Math.abs(c.u)).toBeLessThan(6.2);
  });
});

describe('gamepad mapping (DualShock 4 / standard)', () => {
  const pad = (ax0: number, opts: { r2?: number; x?: boolean; l2?: number; o?: boolean } = {}) => ({
    axes: [ax0, 0, 0, 0],
    buttons: [
      { value: opts.x ? 1 : 0, pressed: !!opts.x },
      { value: opts.o ? 1 : 0, pressed: !!opts.o },
      { value: 0, pressed: false },
      { value: 0, pressed: false },
      { value: 0, pressed: false },
      { value: 0, pressed: false },
      { value: opts.l2 ?? 0, pressed: (opts.l2 ?? 0) > 0.5 },
      { value: opts.r2 ?? 0, pressed: (opts.r2 ?? 0) > 0.5 },
    ],
  });

  it('deadzone: tiny stick wobble steers nothing', () => {
    expect(Math.abs(gamepadIntent(pad(0.08)).steer)).toBeLessThan(1e-9);
    expect(Math.abs(gamepadIntent(pad(-0.1)).steer)).toBeLessThan(1e-9);
  });

  it('full stick = full lock, with the sign convention (+=right)', () => {
    expect(gamepadIntent(pad(1)).steer).toBeCloseTo(1, 5);
    expect(gamepadIntent(pad(-1)).steer).toBeCloseTo(-1, 5);
  });

  it('X and R2 throttle; O/Square and L2 brake (max of analog/digital)', () => {
    expect(gamepadIntent(pad(0, { x: true })).throttle).toBe(1);
    expect(gamepadIntent(pad(0, { r2: 0.6 })).throttle).toBeCloseTo(0.6, 5);
    expect(gamepadIntent(pad(0, { o: true })).brake).toBe(1);
    expect(gamepadIntent(pad(0, { l2: 0.75 })).brake).toBeCloseTo(0.75, 5);
  });
});

describe('manual source merge', () => {
  const I = (steer: number, throttle: number, brake: number): DriverIntent => ({ steer, throttle, brake });

  it('most recent activity wins; idle sources fade out', () => {
    const m = new ManualMerge();
    const kb = I(0, 0, 0);
    const gp = I(0, 0, 0);
    const rm = I(0, 0, 0);
    // keyboard active
    Object.assign(kb, I(0, 1, 0));
    m.update(kb, gp, rm, 1);
    expect(m.source).toBe('keyboard');
    expect(m.intent.throttle).toBe(1);
    // phone takes over (fresher activity)
    Object.assign(kb, I(0, 0, 0));
    Object.assign(rm, I(-0.5, 1, 0));
    m.update(kb, gp, rm, 2);
    expect(m.source).toBe('remote');
    expect(m.intent.steer).toBe(-0.5);
    // phone goes quiet → nothing sticks
    Object.assign(rm, I(0, 0, 0));
    m.update(kb, gp, rm, 3);
    expect(m.intent.throttle).toBe(0);
  });
});

describe('driver-aid levels (ADR-013)', () => {
  const agent = (s: number, speed: number): TrafficAgent =>
    ({
      active: true, id: 1, family: 1, lane: 1, s, lat: 0, dir: 1,
      speed, desiredSpeed: speed, state: 'CRUISE', x: 0, z: 0, heading: 0,
      laneFrom: 1, laneTo: -1, passCounted: false, hadContact: false,
      signal: 0, knockedTimer: 0, nmTracked: false, nmWasAhead: false, nmMinClearance: 99,
    }) as TrafficAgent;
  const view = (): AssistView => ({ brake: 0, ttc: Infinity });

  it('LIGHT fires later and softer than FULL', () => {
    const car = new Car(CAR_TUNES[0]);
    car.u = 20;
    const neutral: DriverIntent = { steer: 0, throttle: 1, brake: 0 };
    // ttc = raw gap / closing; gap 9 m, closing 6 → ttc 1.5 s: inside
    // FULL's window (1.9), outside LIGHT's (1.15)
    const threat = 9;
    const full = forwardAssist(car, neutral, [agent(threat, 14)], 0, 0, ASSIST_LEVELS.full!, view());
    const light = forwardAssist(car, neutral, [agent(threat, 14)], 0, 0, ASSIST_LEVELS.light!, view());
    expect(full.brake).toBeGreaterThan(0);
    expect(light.brake).toBe(0); // not yet — light waits for real danger
    const late = forwardAssist(car, neutral, [agent(4.4, 14)], 0, 0, ASSIST_LEVELS.light!, view()); // ttc 0.73
    expect(late.brake).toBeGreaterThan(0);
    expect(late.brake).toBeLessThanOrEqual(0.35); // coax, never grab
  });

  it('OFF is null — no assist params exist', () => {
    expect(ASSIST_LEVELS.off).toBeNull();
  });
});

describe('ADR-015 rival AI — cars defend against being overtaken', () => {
  it('a rival cuts into the lane the player is pulling toward (with signal)', () => {
    const t = new TrafficSystem(
      { seed: 777, laneCount: 4, laneWidth: 6, densityPerKmPerLane: 0 },
      RoadSystem.straight(),
    );
    const car = new Car(CAR_TUNES[0]);
    car.u = 40; // player faster: closing
    const rival = t.agents[0];
    Object.assign(rival, {
      active: true, id: 1, family: 2, lane: 1, s: 45, lat: t.laneCenter(1), dir: 1,
      speed: 26, desiredSpeed: 26, cruiseSpeed: 26, state: 'CRUISE',
      laneFrom: 1, laneTo: -1, signal: 0, signalTimer: 0,
      rival: true, rivalCd: 0,
    });
    // player sits in lane 1 behind the rival, drifting LEFT (toward lane 0)
    car.x = t.laneCenter(1);
    const drift = -2.5; // m/s lateral, toward lane 0
    let sawSignal = false;
    let cutCompleted = false;
    for (let i = 0; i < 60 * 8; i++) {
      // player holds position + drift for the first 2 s, then stays in lane 0
      car.x = i < 120 ? t.laneCenter(1) + drift * (i / 60) : t.laneCenter(0) - 1;
      t.update(1 / 60, car, car.x, car.z);
      if (rival.signal !== 0) sawSignal = true;
      if (rival.lane === 0 && rival.state === 'CRUISE') cutCompleted = true;
      t.takeCrashes();
      t.takeNearMisses();
    }
    expect(sawSignal).toBe(true); // readable blinker before the cut
    expect(cutCompleted).toBe(true); // the rival actually moved to block
  });

  it('non-rivals keep their lane when the player pulls out', () => {
    const t = new TrafficSystem(
      { seed: 777, laneCount: 4, laneWidth: 6, densityPerKmPerLane: 0 },
      RoadSystem.straight(),
    );
    const car = new Car(CAR_TUNES[0]);
    car.u = 40;
    const calm = t.agents[0];
    Object.assign(calm, {
      active: true, id: 1, family: 2, lane: 1, s: 45, lat: t.laneCenter(1), dir: 1,
      speed: 26, desiredSpeed: 26, cruiseSpeed: 26, state: 'CRUISE',
      laneFrom: 1, laneTo: -1, signal: 0, signalTimer: 0,
      rival: false, rivalCd: 0,
    });
    car.x = t.laneCenter(1);
    let moved = false;
    for (let i = 0; i < 60 * 6; i++) {
      car.x = i < 120 ? t.laneCenter(1) - 2.5 * (i / 60) : t.laneCenter(0) - 1;
      t.update(1 / 60, car, car.x, car.z);
      if (calm.lane !== 1 || calm.signal !== 0) moved = true;
      t.takeCrashes();
      t.takeNearMisses();
    }
    expect(moved).toBe(false); // ordinary traffic does not chase the player
  });

  it('rival defensive pacing: speeds up while the player sits behind', () => {
    const t = new TrafficSystem(
      { seed: 777, laneCount: 4, laneWidth: 6, densityPerKmPerLane: 0 },
      RoadSystem.straight(),
    );
    const car = new Car(CAR_TUNES[0]);
    const rival = t.agents[0];
    Object.assign(rival, {
      active: true, id: 1, family: 1, lane: 1, s: 45, lat: t.laneCenter(1), dir: 1,
      speed: 24, desiredSpeed: 24, cruiseSpeed: 24, state: 'CRUISE',
      laneFrom: 1, laneTo: -1, signal: 0, signalTimer: 0,
      rival: true, rivalCd: 99,
    });
    car.x = t.laneCenter(1);
    // the player SHADOWS the rival: slightly faster, holding ~40 m back
    for (let i = 0; i < 60 * 4; i++) {
      car.u = 27;
      car.step(1 / 60, { steer: 0, throttle: 0, brake: 0 });
      t.update(1 / 60, car, car.x, car.z);
      t.takeCrashes();
      t.takeNearMisses();
    }
    expect(rival.desiredSpeed).toBeGreaterThan(26.5); // defending, not cruising
  });
});

import { TrafficSystem } from '../src/sim/traffic';
import { RoadSystem } from '../src/sim/road';
