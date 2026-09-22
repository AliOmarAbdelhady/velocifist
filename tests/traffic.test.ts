// Traffic gates (PLAN §8, M3+M4): IDM following stability, spawner fairness
// (60-min straight soak + 10-min curved soak with the escape invariant),
// near-miss tiering, oncoming lanes (×2 zones), relative-sweep collision at
// 365 km/h closing, crashes/knocked chains, determinism.

import { describe, expect, it } from 'vitest';
import { Car } from '../src/sim/car';
import { CAR_TUNES } from '../src/sim/carTunes';
import { TrafficSystem } from '../src/sim/traffic';
import { FAMILIES } from '../src/sim/trafficTypes';
import { RoadSystem, CHUNK_LEN } from '../src/sim/road';
import type { DriverIntent } from '../src/sim/intent';

const DT = 1 / 60;

function makeTraffic(over: Record<string, unknown> = {}, road?: RoadSystem): TrafficSystem {
  return new TrafficSystem({ seed: 4242, ...over }, road);
}

/** Closed-loop "escape driver" (ROAD frame, M4): steers toward the freest
 *  reachable lane, holds ~120 km/h, brakes on short time-gaps. Works on
 *  straight and curved roads — targets lane lat, follows road heading. */
function driveIntoGaps(car: Car, traffic: TrafficSystem, road: RoadSystem): DriverIntent {
  const laneCount = 4;
  const plat = traffic.playerLat;
  const best = { lat: traffic.laneCenter(traffic.playerLane(plat)), gap: -Infinity };
  for (let l = 0; l < laneCount; l++) {
    const lx = traffic.laneCenter(l);
    if (Math.abs(lx - plat) > 10.5) continue;
    let gap = 400;
    for (const a of traffic.agents) {
      if (!a.active || a.dir < 0) continue; // oncoming: never a target lane
      if (Math.abs(a.lat - lx) > 3) continue;
      const ds = a.s - traffic.playerS;
      if (ds > -2 && ds < gap) gap = ds;
    }
    gap -= Math.abs(lx - plat) * 6; // prefer nearer lanes slightly
    if (gap > best.gap) {
      best.gap = gap;
      best.lat = lx;
    }
  }
  // road heading at the player's s (feed-forward through bends)
  const sp = { x: 0, z: 0, heading: 0 };
  road.sample(traffic.playerS + 18, sp); // look-ahead point heading
  const vx = car.u * Math.sin(car.heading) + car.w * Math.cos(car.heading);
  let psiDes = Math.atan2(0.9 * (best.lat - plat) + 0.6 * (0 - vx), Math.max(car.u, 8));
  psiDes = Math.max(-0.25, Math.min(0.25, psiDes)) + sp.heading;
  let steer = 2.2 * (psiDes - car.heading) - 0.6 * car.omega;
  steer = Math.max(-0.45, Math.min(0.45, steer));
  let throttle = Math.max(0, Math.min(1, (33.3 - car.u) * 0.2));
  let brake = 0;
  if (car.u > 36) brake = 0.3;
  // brake if the nearest same-lane agent ahead has a short time-gap
  for (const a of traffic.agents) {
    if (!a.active || a.state === 'KNOCKED' || a.dir < 0) continue;
    if (Math.abs(a.lat - plat) > 3) continue;
    const ds = a.s - traffic.playerS;
    if (ds > 0 && ds / Math.max(1, car.u - a.speed) < 1.9) {
      throttle = 0;
      brake = 0.8;
    }
  }
  return { steer, throttle, brake };
}

describe('IDM car following', () => {
  it('follower settles behind a slower leader without overlapping (60 s)', () => {
    const t = makeTraffic({ densityPerKmPerLane: 0 });
    const car = new Car(CAR_TUNES[0]);
    car.u = 33;
    // lane 0: sedan leader AHEAD (larger s), truck follower BEHIND it.
    // Truck: low eagerness AND we zero it for the measurement window so the
    // follower provably stays in-lane while we watch it settle.
    const saved: Array<[number, number]> = [[1, FAMILIES[1].laneChangeEagerness], [6, FAMILIES[6].laneChangeEagerness]];
    FAMILIES[1].laneChangeEagerness = 0;
    FAMILIES[6].laneChangeEagerness = 0;
    try {
      t.agents[0] = Object.assign(t.agents[0], {
        active: true, id: 1, family: 1, lane: 0, s: 60, lat: t.laneCenter(0), dir: 1,
        speed: 22, desiredSpeed: 22, state: 'CRUISE',
      });
      t.agents[1] = Object.assign(t.agents[1], {
        active: true, id: 2, family: 6, lane: 0, s: 30, lat: t.laneCenter(0), dir: 1,
        speed: 27, desiredSpeed: 27, state: 'CRUISE',
      });
      const lenSum = FAMILIES[6].halfL + FAMILIES[1].halfL;
      let minGap = Infinity;
      for (let i = 0; i < 60 * 60; i++) {
        const px = car.x;
        const pz = car.z;
        t.update(DT, car, px, pz);
        const gap = t.agents[0].s - t.agents[1].s - lenSum;
        minGap = Math.min(minGap, gap);
      }
      expect(minGap).toBeGreaterThan(0.2); // never overlaps the leader
      const settleGap = t.agents[0].s - t.agents[1].s - lenSum;
      // truck equilibrium gap: s0 + v·T (+ slack) — long headway by design
      expect(settleGap).toBeGreaterThan(FAMILIES[6].s0 - 0.5);
      expect(settleGap).toBeLessThan(FAMILIES[6].s0 + 22 * FAMILIES[6].headwayT + 12);
      expect(Math.abs(t.agents[1].speed - t.agents[0].speed)).toBeLessThan(1.5);
    } finally {
      for (const [f, e] of saved) FAMILIES[f].laneChangeEagerness = e;
    }
  });
});

describe('spawner + fairness soak (60 sim-minutes, straight)', () => {
  it('escape invariant holds every probe; no NaN; caps respected', () => {
    const road = RoadSystem.straight();
    const t = makeTraffic({ densityPerKmPerLane: 10 });
    const car = new Car(CAR_TUNES[0]);
    car.u = 30;
    const pHalfW = car.tune.bodyDims[0] / 2;
    const pHalfL = car.tune.bodyDims[2] / 2;
    let crashes = 0;
    let probes = 0;
    let violations = 0;
    let maxActive = 0;
    for (let i = 0; i < 60 * 60 * 60; i++) {
      const px = car.x;
      const pz = car.z;
      car.step(DT, driveIntoGaps(car, t, road));
      t.update(DT, car, px, pz);
      crashes += t.takeCrashes().length;
      t.takeNearMisses();
      if (i % 30 === 0) {
        probes++;
        maxActive = Math.max(
          maxActive,
          t.agents.reduce((s, a) => s + (a.active ? 1 : 0), 0),
        );
        if (!t.hasEscape(t.playerS, t.playerLat, car.u, pHalfW, pHalfL)) violations++;
        for (const a of t.agents) {
          if (a.active && !Number.isFinite(a.s + a.lat + a.speed)) {
            throw new Error('NaN in traffic state');
          }
        }
        if (!Number.isFinite(car.x + car.z + car.u)) throw new Error('NaN in car state');
      }
    }
    expect(violations).toBe(0); // FAIRNESS INVARIANT
    expect(maxActive).toBeLessThanOrEqual(48);
    expect(probes).toBeGreaterThan(100);
    // the driver is decent but not perfect — crashes allowed, chaos not
    expect(crashes).toBeLessThan(60 * 60); // no per-frame collision storm
  }, 120000);
});

describe('spawner + fairness soak (10 sim-minutes, curved desert road)', () => {
  it('escape invariant holds on bends; car stays in the corridor (guide wall)', () => {
    const road = new RoadSystem({ seed: 31337, theme: 'desert' });
    const t = makeTraffic({ densityPerKmPerLane: 10 }, road);
    const car = new Car(CAR_TUNES[0]);
    car.guide = road;
    car.u = 30;
    const pHalfW = car.tune.bodyDims[0] / 2;
    const pHalfL = car.tune.bodyDims[2] / 2;
    let violations = 0;
    let maxLat = 0;
    for (let i = 0; i < 60 * 60 * 10; i++) {
      const px = car.x;
      const pz = car.z;
      car.step(DT, driveIntoGaps(car, t, road));
      t.update(DT, car, px, pz);
      t.takeCrashes();
      t.takeNearMisses();
      if (i % 30 === 0) {
        if (!t.hasEscape(t.playerS, t.playerLat, car.u, pHalfW, pHalfL)) violations++;
        maxLat = Math.max(maxLat, Math.abs(t.playerLat));
        for (const a of t.agents) {
          if (a.active && !Number.isFinite(a.s + a.lat + a.speed)) {
            throw new Error('NaN in traffic state on curve');
          }
        }
      }
    }
    expect(violations).toBe(0); // FAIRNESS INVARIANT, curved world
    expect(maxLat).toBeLessThan(14.5); // soft wall held the corridor
  }, 60000);
});

describe('oncoming zones (neon)', () => {
  // oncoming everywhere past the launch pad; curveBias ~0 keeps the spine
  // near-straight so fixtures can place things by plain world x/z
  function neonRoad(): RoadSystem {
    return new RoadSystem({
      seed: 818, theme: 'neon',
      policy: { oncomingP: 1, constructionP: 0, curveBias: 0.001 },
    });
  }

  it('spawner places agents on the correct side of the divider', () => {
    const road = neonRoad();
    const t = makeTraffic({ densityPerKmPerLane: 8 }, road);
    const car = new Car(CAR_TUNES[0]);
    car.guide = road;
    car.u = 30;
    for (let i = 0; i < 60 * 20; i++) {
      const px = car.x;
      const pz = car.z;
      car.step(DT, driveIntoGaps(car, t, road));
      t.update(DT, car, px, pz);
      t.takeCrashes();
      t.takeNearMisses();
    }
    expect(t.agents.some((a) => a.active && a.dir < 0)).toBe(true);
    for (const a of t.agents) {
      if (!a.active) continue;
      const onc = road.oncomingAt(a.s);
      if (onc === 0) continue; // launch-pad chunks have no divider yet
      if (a.dir < 0) {
        expect(a.lane).toBeLessThan(onc);
        expect(a.lat).toBeLessThan(0);
      } else {
        expect(a.lane).toBeGreaterThanOrEqual(onc);
        expect(a.lat).toBeGreaterThan(0);
      }
    }
  });

  it('near-miss vs oncoming fires with oncoming flag and sum closing', () => {
    const road = neonRoad();
    const t = makeTraffic({ densityPerKmPerLane: 0 }, road);
    const car = new Car(CAR_TUNES[0]);
    car.u = 30;
    car.x = -5.9; // straddling the divider: pass clearance ≈ 1.15 m (NEAR tier)
    car.z = -1024; // inside the oncoming zone (chunk 4+)
    const a = t.agents[0];
    Object.assign(a, {
      active: true, id: 5, family: 1, lane: 0, s: 1204, lat: t.laneCenter(0), dir: -1,
      speed: 20, desiredSpeed: 20, state: 'CRUISE',
    });
    let event: { oncoming: boolean; closingSpeed: number; tier: string } | null = null;
    for (let i = 0; i < 60 * 20 && !event; i++) {
      const px = car.x;
      const pz = car.z;
      car.step(DT, { steer: 0, throttle: 0.4, brake: 0 });
      t.update(DT, car, px, pz);
      for (const ev of t.takeNearMisses()) {
        event = { oncoming: ev.oncoming, closingSpeed: ev.closingSpeed, tier: ev.tier };
      }
    }
    expect(event).not.toBeNull();
    expect(event!.oncoming).toBe(true);
    expect(event!.closingSpeed).toBeGreaterThan(45); // ~30 + 20 m/s
  });

  it('head-on at 365 km/h combined closing cannot tunnel (relative sweep)', () => {
    const road = neonRoad();
    const t = makeTraffic({ densityPerKmPerLane: 0 }, road);
    const car = new Car(CAR_TUNES[0]);
    car.u = 61; // ~220 km/h
    car.x = t.laneCenter(0); // player wrongly in the oncoming half
    car.z = -1024;
    const a = t.agents[0];
    Object.assign(a, {
      active: true, id: 6, family: 1, lane: 0, s: 1074, lat: t.laneCenter(0), dir: -1,
      speed: 20, desiredSpeed: 20, state: 'CRUISE',
    });
    let crashed = false;
    let headOn = false;
    for (let i = 0; i < 90 && !crashed; i++) {
      const px = car.x;
      const pz = car.z;
      car.step(DT, { steer: 0, throttle: 0.6, brake: 0 });
      t.update(DT, car, px, pz);
      for (const c of t.takeCrashes()) {
        crashed = true;
        headOn = c.headOn;
      }
    }
    expect(crashed).toBe(true); // ~101 m/s combined — sweep must catch it
    expect(headOn).toBe(true);
  });
});

describe('near-miss tiering', () => {
  function passAt(lateralOffset: number, closing: number): { tier: string; clearance: number } | null {
    const t = makeTraffic({ densityPerKmPerLane: 0 });
    const car = new Car(CAR_TUNES[0]);
    car.u = 30; // set BEFORE deriving the agent speed
    const agentSpeed = Math.max(0, car.u - closing); // fixed closing (agent holds speed)
    const savedEagerness = FAMILIES[1].laneChangeEagerness;
    FAMILIES[1].laneChangeEagerness = 0; // keep the fixture in its lane
    const a = t.agents[0];
    Object.assign(a, {
      active: true, id: 7, family: 1, lane: 1, s: 220, lat: lateralOffset, dir: 1,
      speed: agentSpeed, desiredSpeed: Math.max(agentSpeed, 1), state: 'CRUISE',
    });
    car.z = 0;
    const px = car.x;
    let pz = car.z;
    for (let i = 0; i < 60 * 20; i++) {
      pz = car.z;
      car.step(DT, { steer: 0, throttle: 0, brake: 0 });
      t.update(DT, car, px, pz);
      const evs = t.takeNearMisses();
      if (evs.length > 0) {
        FAMILIES[1].laneChangeEagerness = savedEagerness;
        return { tier: evs[0].tier, clearance: evs[0].clearance };
      }
    }
    FAMILIES[1].laneChangeEagerness = savedEagerness;
    return null;
  }

  it('fires INCHES / VERY_CLOSE / NEAR at the right clearances', () => {
    // offsets are from the player (lat=0); sedan halfW 0.92 + player halfW 1.0 = 1.92
    const inches = passAt(-2.3, 30); // clearance 0.38
    expect(inches).not.toBeNull();
    expect(inches!.tier).toBe('INCHES');
    const very = passAt(-2.45, 30); // clearance 0.53
    expect(very).not.toBeNull();
    expect(very!.tier).toBe('VERY_CLOSE');
    const near = passAt(-2.85, 30); // clearance 0.93
    expect(near).not.toBeNull();
    expect(near!.tier).toBe('NEAR');
    const far = passAt(-3.6, 30); // clearance 1.68
    expect(far).toBeNull();
  });

  it('no event below 40 km/h closing', () => {
    expect(passAt(0.3, 5)).toBeNull();
  });
});

describe('construction zones', () => {
  it('agents signal out of a blocked lane before entering the zone', () => {
    const road = new RoadSystem({
      seed: 3, theme: 'coastal',
      policy: { oncomingP: 0, constructionP: 1, curveBias: 0.001 },
    });
    const t = makeTraffic({ densityPerKmPerLane: 0 }, road);
    const car = new Car(CAR_TUNES[0]);
    car.guide = road;
    car.u = 25;
    car.z = -(4 * CHUNK_LEN - 200);
    // agent cruising in what will become the blocked lane, 200 m before the zone
    const zoneStart = 4 * CHUNK_LEN;
    const a = t.agents[0];
    const blocked = road.blockedLaneOf(4);
    const startLane = blocked === 3 ? 3 : 0;
    Object.assign(a, {
      active: true, id: 8, family: 1, lane: startLane, s: zoneStart - 200, lat: t.laneCenter(startLane), dir: 1,
      speed: 25, desiredSpeed: 25, state: 'CRUISE',
    });
    const watchedLane = startLane;
    let leftLane = false;
    for (let i = 0; i < 60 * 12; i++) {
      const px = car.x;
      const pz = car.z;
      car.step(DT, { steer: 0, throttle: 0.2, brake: 0 });
      t.update(DT, car, px, pz);
      t.takeCrashes();
      t.takeNearMisses();
      if (a.s > zoneStart && (a.lane !== watchedLane || !a.active)) leftLane = true;
    }
    expect(leftLane).toBe(true); // dodged or despawned, never drove the cones
  });
});

describe('crashes + knocked', () => {
  it('rear-ending an agent produces a crash event, knocks it, and slows the player', () => {
    const t = makeTraffic({ densityPerKmPerLane: 0 });
    const car = new Car(CAR_TUNES[0]);
    car.u = 35;
    Object.assign(t.agents[0], {
      active: true, id: 9, family: 1, lane: t.playerLane(car.x), s: 30, lat: 0, dir: 1,
      speed: 10, desiredSpeed: 10, state: 'CRUISE',
    });
    let crashed = false;
    let knocked = false;
    let minU = 35;
    for (let i = 0; i < 60 * 15; i++) {
      const px = car.x;
      const pz = car.z;
      car.step(DT, { steer: 0, throttle: 0.6, brake: 0 });
      t.update(DT, car, px, pz);
      if (t.takeCrashes().length > 0) crashed = true;
      if (t.agents[0].state === 'KNOCKED') knocked = true;
      if (crashed) minU = Math.min(minU, car.u); // speed dip right after impact
    }
    expect(crashed).toBe(true);
    expect(knocked).toBe(true);
    expect(minU).toBeLessThan(30);
  });
});

describe('determinism', () => {
  it('same seed + scripted input ⇒ identical traffic hash (straight)', () => {
    const run = (): { hash: string; carHash: string } => {
      const t = makeTraffic({ seed: 999, densityPerKmPerLane: 8 });
      const car = new Car(CAR_TUNES[0]);
      car.u = 30;
      for (let i = 0; i < 60 * 180; i++) {
        const px = car.x;
        const pz = car.z;
        const s = 0.1 * Math.sin(i * 0.013);
        car.step(DT, { steer: s, throttle: 0.5, brake: 0 });
        t.update(DT, car, px, pz);
        t.takeNearMisses();
        t.takeCrashes();
      }
      return { hash: t.hash(), carHash: car.hash() };
    };
    const a = run();
    const b = run();
    expect(a.hash).toBe(b.hash);
    expect(a.carHash).toBe(b.carHash);
  });

  it('same seed + scripted input ⇒ identical hash on a curved road', () => {
    const run = (): string => {
      const road = new RoadSystem({ seed: 606, theme: 'desert' });
      const t = makeTraffic({ seed: 999, densityPerKmPerLane: 8 }, road);
      const car = new Car(CAR_TUNES[0]);
      car.guide = road;
      car.u = 30;
      for (let i = 0; i < 60 * 120; i++) {
        const px = car.x;
        const pz = car.z;
        const s = 0.1 * Math.sin(i * 0.011);
        car.step(DT, { steer: s, throttle: 0.5, brake: 0 });
        t.update(DT, car, px, pz);
        t.takeNearMisses();
        t.takeCrashes();
      }
      return t.hash() + car.hash();
    };
    expect(run()).toBe(run());
  });
});
