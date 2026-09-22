// M8 event-injector gates: determinism, survivability (the fairness
// invariant must hold after EVERY injection), structure per set-piece, and
// rollback when the player would be walled.

import { describe, expect, it } from 'vitest';
import { EventDirector, EVENT_LABEL, type EventKind } from '../src/sim/events';
import { TrafficSystem } from '../src/sim/traffic';
import { RoadSystem } from '../src/sim/road';
import { Car } from '../src/sim/car';
import { CAR_TUNES } from '../src/sim/carTunes';
import { FAMILIES } from '../src/sim/trafficTypes';

const DT = 1 / 60;

function straightRoad(): RoadSystem {
  return RoadSystem.straight(4, 6);
}

function makeTraffic(road: RoadSystem): TrafficSystem {
  return new TrafficSystem({ seed: 7, laneCount: 4, laneWidth: 6, densityPerKmPerLane: 0 }, road);
}

function player(car = new Car(CAR_TUNES[0])) {
  return {
    car,
    ev: {
      s: 500,
      lat: 3, // dead-centre lane 2 of 0..3 (laneWidth 6)
      u: 30,
      halfW: car.tune.bodyDims[0] / 2,
      halfL: car.tune.bodyDims[2] / 2,
    },
  };
}

/** Drive the director until `kind` injects (or attempts run out). */
function injectKind(d: EventDirector, kind: EventKind, traffic: TrafficSystem, road: RoadSystem): boolean {
  const p = player();
  for (let i = 0; i < 4000; i++) {
    const fired = d.tick(DT, traffic, road, p.ev);
    if (fired === kind) return true;
    if (fired && d.history[d.history.length - 1] !== kind && d.history.includes(kind)) return true;
  }
  return d.history.includes(kind);
}

describe('scheduling', () => {
  it('is deterministic per seed (same kinds, same order)', () => {
    const run = (): EventKind[] => {
      const d = new EventDirector(42);
      const road = straightRoad();
      const t = makeTraffic(road);
      const p = player().ev;
      const out: EventKind[] = [];
      for (let i = 0; i < 60 * 200; i++) {
        const k = d.tick(DT, t, road, p);
        if (k) out.push(k);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('first event lands in the opening half-minute, then spaces out', () => {
    const d = new EventDirector(1);
    const road = straightRoad();
    const t = makeTraffic(road);
    const p = player().ev;
    let first = -1;
    for (let i = 0; i < 60 * 120; i++) {
      if (d.tick(DT, t, road, p)) {
        first = i / 60;
        break;
      }
    }
    expect(first).toBeGreaterThanOrEqual(15);
    expect(first).toBeLessThan(30);
    expect(d.history.length).toBe(1);
  });

  it('never repeats a kind back-to-back', () => {
    const d = new EventDirector(99);
    const road = straightRoad();
    const t = makeTraffic(road);
    const p = player().ev;
    for (let i = 0; i < 60 * 400; i++) d.tick(DT, t, road, p);
    for (let i = 1; i < d.history.length; i++) {
      expect(d.history[i]).not.toBe(d.history[i - 1]);
    }
    expect(d.history.length).toBeGreaterThan(4);
  });

  it('paused (mercy) pushes the schedule out', () => {
    const d = new EventDirector(5);
    const road = straightRoad();
    const t = makeTraffic(road);
    const p = player().ev;
    for (let i = 0; i < 60 * 30; i++) d.tick(DT, t, road, p, true);
    expect(d.history.length).toBe(0);
  });

  it('every kind has readable toast copy', () => {
    for (const k of Object.keys(EVENT_LABEL) as EventKind[]) {
      expect(EVENT_LABEL[k].length).toBeGreaterThan(6);
    }
  });
});

describe('survivability + structure', () => {
  it('after EVERY injection the player still has an escape (live traffic loop)', () => {
    const d = new EventDirector(3);
    const road = straightRoad();
    const t = makeTraffic(road);
    const p = player();
    let injected = 0;
    for (let i = 0; i < 60 * 300; i++) {
      // drive the whole loop like the game does — agents must MOVE between
      // injections or successive batches land on the same spot and reject
      const k = d.tick(DT, t, road, p.ev);
      if (k) injected++;
      t.update(DT, p.car, p.car.x, p.car.z);
      expect(t.hasEscape(t.playerS, t.playerLat, 30, p.ev.halfW, p.ev.halfL)).toBe(true);
    }
    expect(injected).toBeGreaterThanOrEqual(4);
  });

  it('ROADBLOCK leaves a whole lane free at the block s', () => {
    const d = new EventDirector(11);
    const road = straightRoad();
    const t = makeTraffic(road);
    const p = player();
    // force roadblocks until one injects
    let ok = false;
    for (let attempt = 0; attempt < 40 && !ok; attempt++) {
      const dd = new EventDirector(100 + attempt);
      ok = (dd as unknown as { inject: (k: EventKind, tr: TrafficSystem, r: RoadSystem, pl: typeof p.ev) => boolean })
        .inject('ROADBLOCK', t, road, p.ev);
      if (ok) {
        const cars = t.agents.filter((a) => a.active);
        // 3 blocked lanes of 4 → one lane with no agent
        const blockedLanes = new Set(cars.map((a) => a.lane));
        expect(blockedLanes.size).toBeLessThanOrEqual(3);
        ok = blockedLanes.size <= 3;
      }
    }
    expect(ok).toBe(true);
  });

  it('CONVOY spawns a same-lane chain ahead, none in the player lane', () => {
    const road = straightRoad();
    const t = makeTraffic(road);
    const p = player();
    const d = new EventDirector(21) as unknown as {
      inject: (k: EventKind, tr: TrafficSystem, r: RoadSystem, pl: typeof p.ev) => boolean;
    };
    expect(d.inject('CONVOY', t, road, p.ev)).toBe(true);
    const cars = t.agents.filter((a) => a.active);
    expect(cars.length).toBeGreaterThanOrEqual(3);
    const lanes = new Set(cars.map((a) => a.lane));
    expect(lanes.size).toBe(1);
    expect(cars.every((a) => a.lane !== 2)).toBe(true); // player lane 2 untouched
    expect(cars.every((a) => a.s > p.ev.s)).toBe(true);
  });

  it('ROAD_TRAIN is two big trucks back to back in one lane', () => {
    const road = straightRoad();
    const t = makeTraffic(road);
    const p = player();
    const d = new EventDirector(31) as unknown as {
      inject: (k: EventKind, tr: TrafficSystem, r: RoadSystem, pl: typeof p.ev) => boolean;
    };
    expect(d.inject('ROAD_TRAIN', t, road, p.ev)).toBe(true);
    const trucks = t.agents.filter((a) => a.active);
    expect(trucks.length).toBe(2);
    expect(trucks.every((a) => FAMILIES[a.family].id === 'truck')).toBe(true);
    expect(Math.abs(trucks[0].s - trucks[1].s)).toBeLessThan(40); // ≥29.4 lane-gap rule
  });

  it('CUTTER signals toward the player lane (readable blinker)', () => {
    const road = straightRoad();
    const t = makeTraffic(road);
    const p = player();
    const d = new EventDirector(41) as unknown as {
      inject: (k: EventKind, tr: TrafficSystem, r: RoadSystem, pl: typeof p.ev) => boolean;
    };
    expect(d.inject('CUTTER', t, road, p.ev)).toBe(true);
    const cutter = t.agents.find((a) => a.active)!;
    expect(cutter.signal).not.toBe(0);
    expect(cutter.laneTo).toBe(2); // the player's lane
  });

  it('WEAVER drifts lanes over time and stays inside the road', () => {
    const d = new EventDirector(51);
    const road = straightRoad();
    const t = makeTraffic(road);
    const p = player();
    const dd = d as unknown as {
      inject: (k: EventKind, tr: TrafficSystem, r: RoadSystem, pl: typeof p.ev) => boolean;
      script: (dt: number, tr: TrafficSystem, r: RoadSystem) => void;
    };
    expect(dd.inject('WEAVER', t, road, p.ev)).toBe(true);
    const weaver = t.agents.find((a) => a.active)!;
    const seen = new Set<number>([weaver.lane]);
    for (let i = 0; i < 60 * 40; i++) {
      dd.script(DT, t, road);
      t.update(DT, p.car, p.car.x, p.car.z);
      seen.add(weaver.lane);
      expect(weaver.lane).toBeGreaterThanOrEqual(0);
      expect(weaver.lane).toBeLessThan(4);
      expect(Math.abs(weaver.lat)).toBeLessThan(15);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2); // actually wove
  });

  it('rolls the whole batch back when the player would be walled', () => {
    const road = straightRoad();
    const t = makeTraffic(road);
    // pre-wall: fill every lane just ahead of the player with slow traffic
    for (let lane = 0; lane < 4; lane++) {
      const a = t.spawnEventAgent({ lane, s: 510 + lane, family: 1, speed: 10 });
      expect(a).not.toBeNull();
    }
    const activeBefore = t.agents.filter((a) => a.active).length;
    const p = player();
    const d = new EventDirector(61) as unknown as {
      inject: (k: EventKind, tr: TrafficSystem, r: RoadSystem, pl: typeof p.ev) => boolean;
    };
    // roadblock onto the remaining structure must fail cleanly — the
    // hand-made wall already violates fairness, so the injector's job is to
    // detect that and leak NOTHING
    const ok = d.inject('ROADBLOCK', t, road, p.ev);
    const activeAfter = t.agents.filter((a) => a.active).length;
    if (!ok) {
      expect(activeAfter).toBe(activeBefore); // nothing leaked
    } else {
      // if something placed, the fairness check must still have passed
      expect(t.hasEscape(p.ev.s, p.ev.lat, p.ev.u, p.ev.halfW, p.ev.halfL)).toBe(true);
    }
  });
});
