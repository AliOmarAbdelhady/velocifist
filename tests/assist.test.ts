// M7 forward-collision assist gates: TTC ramp, lateral window, steer relief,
// player-brake priority, speed floor.

import { describe, expect, it } from 'vitest';
import { Car } from '../src/sim/car';
import { CAR_TUNES } from '../src/sim/carTunes';
import { DEFAULT_ASSIST, applyAssist, forwardAssist, type AssistView } from '../src/sim/assist';

const view = (): AssistView => ({ brake: 0, ttc: Infinity });
import type { TrafficAgent } from '../src/sim/trafficTypes';

const DT = 1 / 60;

function carAt(u: number): Car {
  const c = new Car(CAR_TUNES[0]);
  c.u = u;
  return c;
}

function agent(over: Partial<TrafficAgent>): TrafficAgent {
  return {
    active: true, id: 1, family: 1, lane: 1, s: 100, lat: 0, dir: 1,
    speed: 20, desiredSpeed: 20, state: 'CRUISE',
    x: 0, z: -100, heading: 0, mdx: 0, mdz: 0,
    signal: 0, signalT: 0, laneTo: -1, knockedTimer: 0,
    paint: 0, passCounted: false, hadContact: false,
    nmTracked: false, nmWasAhead: false, nmMinClearance: 99,
    ...over,
  } as TrafficAgent;
}

describe('forward collision assist', () => {
  it('brakes harder as time-to-collision shrinks', () => {
    const car = carAt(40);
    const far = forwardAssist(car, NEUTRAL, [agent({ s: 120, speed: 20 })], 0, 0, DEFAULT_ASSIST, view());
    const near = forwardAssist(car, NEUTRAL, [agent({ s: 20, speed: 20 })], 0, 0, DEFAULT_ASSIST, view());
    expect(far.brake).toBe(0); // TTC 6 s — clear
    expect(near.brake).toBeGreaterThan(0.2); // TTC 1 s
    const imminent = forwardAssist(car, NEUTRAL, [agent({ s: 10, speed: 20 })], 0, 0, DEFAULT_ASSIST, view());
    expect(imminent.brake).toBeGreaterThan(near.brake);
  });

  it('oncoming traffic closes fast and triggers at long range', () => {
    const car = carAt(40);
    const a = forwardAssist(car, NEUTRAL, [agent({ s: 60, speed: 20, dir: -1 })], 0, 0, DEFAULT_ASSIST, view());
    expect(a.brake).toBeGreaterThan(0.5); // closing 60 m/s, TTC 1 s
  });

  it('agents in other lanes are ignored (lateral window)', () => {
    const car = carAt(40);
    const a = forwardAssist(car, NEUTRAL, [agent({ s: 45, speed: 20, lat: 4.5 })], 0, 0, DEFAULT_ASSIST, view());
    expect(a.brake).toBe(0);
  });

  it('steering away from the threat relieves the assist (weaving stays fun)', () => {
    const car = carAt(40);
    const threat = [agent({ s: 20, speed: 20, lat: 0 })];
    const straight = forwardAssist(car, NEUTRAL, threat, 0, 0);
    const dodging = forwardAssist(car, { steer: 0.6, throttle: 1, brake: 0 }, threat, 0, 0);
    expect(dodging.brake).toBeLessThan(straight.brake);
    expect(dodging.brake).toBeGreaterThan(0); // relief, not blindness
  });

  it('caps at maxBrake — the assist coaxes, never slams', () => {
    const car = carAt(60);
    const a = forwardAssist(car, NEUTRAL, [agent({ s: 15, speed: 0, dir: -1 })], 0, 0, DEFAULT_ASSIST, view());
    expect(a.brake).toBeCloseTo(DEFAULT_ASSIST.maxBrake, 5);
  });

  it('is off below the speed floor (parking / creep)', () => {
    const car = carAt(5);
    const a = forwardAssist(car, NEUTRAL, [agent({ s: 10, speed: 0 })], 0, 0, DEFAULT_ASSIST, view());
    expect(a.brake).toBe(0);
  });

  it('agents behind or pulling away do not trigger', () => {
    const car = carAt(40);
    const behind = forwardAssist(car, NEUTRAL, [agent({ s: -20, speed: 20 })], 0, 0, DEFAULT_ASSIST, view());
    const faster = forwardAssist(car, NEUTRAL, [agent({ s: 60, speed: 50 })], 0, 0, DEFAULT_ASSIST, view());
    expect(behind.brake).toBe(0);
    expect(faster.brake).toBe(0);
  });
});

describe('intent blending', () => {
  it('raises brake but never lowers the player’s own harder braking', () => {
    const i = applyAssist({ steer: 0, throttle: 1, brake: 0.9 }, { brake: 0.4, ttc: 1 });
    expect(i.brake).toBe(0.9);
  });

  it('eases off the gas when the assist is strong', () => {
    const i = applyAssist({ steer: 0, throttle: 1, brake: 0 }, { brake: 0.7, ttc: 0.5 });
    expect(i.brake).toBe(0.7);
    expect(i.throttle).toBeCloseTo(0.3, 5);
  });

  it('is a no-op for a whisper of assist', () => {
    const i = applyAssist({ steer: 0, throttle: 1, brake: 0 }, { brake: 0.01, ttc: 1.8 });
    expect(i.throttle).toBe(1);
    expect(i.brake).toBe(0);
  });
});

const NEUTRAL = { steer: 0, throttle: 1, brake: 0 };
void DT;
