// Event injectors (M8, PLAN §11.2): readable, SURVIVABLE set-pieces the
// variety director drops into the traffic pool — convoys to thread, rolling
// roadblocks with a guaranteed gap, a blinker-signalling cutter, a drifting
// weaver, road trains, rubberneckers. Every injection is checked against the
// traffic fairness invariant (`hasEscape`) and rolled back if it would wall
// the player. Deterministic per seed. Injected agents are ordinary agents:
// IDM, signals, collisions, near-miss scoring all apply.

import { mulberry32, type Rng } from './rng';
import type { RoadSystem } from './road';
import type { TrafficSystem } from './traffic';
import type { TrafficAgent } from './trafficTypes';
import { eventPeriodSec } from './director';

export type EventKind =
  | 'CONVOY'
  | 'ROADBLOCK'
  | 'CUTTER'
  | 'WEAVER'
  | 'ROAD_TRAIN'
  | 'RUBBERNECK';

const ALL_KINDS: readonly EventKind[] = [
  'CONVOY', 'ROADBLOCK', 'CUTTER', 'WEAVER', 'ROAD_TRAIN', 'RUBBERNECK',
];

/** HUD toast copy — names the threat AND the read (PLAN readability rule). */
export const EVENT_LABEL: Record<EventKind, string> = {
  CONVOY: 'CONVOY — thread the line',
  ROADBLOCK: 'ROLLING ROADBLOCK — find the gap',
  CUTTER: 'CUTTER — watch the blinker',
  WEAVER: 'WEAVER — keep your distance',
  ROAD_TRAIN: 'ROAD TRAIN — go around',
  RUBBERNECK: 'RUBBERNECKERS — slow traffic left',
};

export interface EventPlayer {
  s: number;
  lat: number;
  u: number;
  halfW: number;
  halfL: number;
}

interface WeaverHandle {
  agent: TrafficAgent;
  id: number;
  timer: number;
}

export class EventDirector {
  private readonly rng: Rng;
  private runTime = 0;
  private nextAt: number;
  private lastKind: EventKind | null = null;
  private readonly weavers: WeaverHandle[] = [];
  /** injected kinds in order (dev HUD / tests) */
  readonly history: EventKind[] = [];

  constructor(seed: number) {
    this.rng = mulberry32((seed ^ 0x51e7e7) >>> 0);
    this.nextAt = 18;
  }

  /**
   * One sim step. Injects a set-piece when due; `paused` (mercy rule)
   * pushes the schedule out. Returns the injected kind for the HUD toast.
   */
  tick(
    dt: number,
    traffic: TrafficSystem,
    road: RoadSystem,
    player: EventPlayer,
    paused = false,
  ): EventKind | null {
    this.runTime += dt;
    this.script(dt, traffic, road);
    if (paused) {
      this.nextAt = Math.max(this.nextAt, this.runTime + 8);
      return null;
    }
    if (this.runTime < this.nextAt) return null;
    const kind = this.pickKind();
    const injected = this.inject(kind, traffic, road, player);
    this.nextAt = this.runTime + eventPeriodSec(this.runTime) * (0.8 + 0.4 * this.rng());
    return injected ? kind : null;
  }

  /** Deterministic kind choice — never the same kind twice in a row. */
  private pickKind(): EventKind {
    const pool = ALL_KINDS.filter((k) => k !== this.lastKind);
    const kind = pool[Math.floor(this.rng() * pool.length)];
    this.lastKind = kind;
    this.history.push(kind);
    return kind;
  }

  /** Same-direction lanes valid at s (outside oncoming zones). */
  private sameDirLanes(road: RoadSystem, s: number, laneCount: number): number[] {
    const onc = road.oncomingAt(s);
    const lanes: number[] = [];
    for (let l = onc; l < laneCount; l++) lanes.push(l);
    return lanes;
  }

  private inject(
    kind: EventKind,
    traffic: TrafficSystem,
    road: RoadSystem,
    player: EventPlayer,
  ): boolean {
    const laneCount = traffic.laneCount;
    // find a spawn s with a usable same-direction half (≥ 2 lanes)
    let s0 = player.s + 330 + this.rng() * 100;
    let lanes = this.sameDirLanes(road, s0, laneCount);
    if (lanes.length < 2) {
      s0 += 90;
      lanes = this.sameDirLanes(road, s0, laneCount);
      if (lanes.length < 2) return false;
    }
    const playerLane = traffic.playerLane(player.lat);
    switch (kind) {
      case 'ROADBLOCK': return this.injectRoadblock(traffic, road, player, lanes, s0, playerLane);
      case 'CONVOY': return this.injectConvoy(traffic, road, player, lanes, s0, playerLane);
      case 'ROAD_TRAIN': return this.injectRoadTrain(traffic, road, player, lanes, s0, playerLane);
      case 'RUBBERNECK': return this.injectRubberneck(traffic, road, player, lanes, s0, playerLane);
      case 'CUTTER': return this.injectCutter(traffic, road, player, lanes, s0, playerLane);
      case 'WEAVER': return this.injectWeaver(traffic, road, player, lanes, s0, playerLane);
    }
  }

  /** Place a batch; roll EVERYTHING back if the player loses the escape. */
  private placeBatch(
    traffic: TrafficSystem,
    player: EventPlayer,
    specs: Array<{ lane: number; s: number; family: number; speed: number; signal?: -1 | 1; laneTo?: number }>,
  ): TrafficAgent[] {
    const placed: TrafficAgent[] = [];
    for (const sp of specs) {
      const a = traffic.spawnEventAgent(sp);
      if (!a) {
        for (const p of placed) p.active = false;
        return [];
      }
      placed.push(a);
    }
    if (!traffic.hasEscape(player.s, player.lat, player.u, player.halfW, player.halfL)) {
      for (const p of placed) p.active = false;
      return [];
    }
    return placed;
  }

  private injectRoadblock(
    traffic: TrafficSystem, road: RoadSystem, player: EventPlayer,
    lanes: number[], s0: number, playerLane: number,
  ): boolean {
    // free-lane candidates: the player's lane first (pure read), then the
    // nearest other lane (forces a small lane change) — fairness decides
    const candidates = [playerLane, ...lanes.filter((l) => l !== playerLane).sort(
      (a, b) => Math.abs(a - playerLane) - Math.abs(b - playerLane),
    )];
    for (const free of candidates) {
      if (!lanes.includes(free)) continue;
      const specs = lanes
        .filter((l) => l !== free)
        .map((l) => ({ lane: l, s: s0, family: 1, speed: 21 }));
      if (this.placeBatch(traffic, player, specs).length > 0) return true;
    }
    return false;
  }

  private injectConvoy(
    traffic: TrafficSystem, road: RoadSystem, player: EventPlayer,
    lanes: number[], s0: number, playerLane: number,
  ): boolean {
    const options = lanes.filter((l) => l !== playerLane);
    if (options.length === 0) return false;
    const lane = options[Math.floor(this.rng() * options.length)];
    const n = 3 + Math.floor(this.rng() * 2);
    const families = [1, 3, 1, 2];
    const specs = [];
    for (let i = 0; i < n; i++) {
      specs.push({ lane, s: s0 - i * 30, family: families[i % families.length], speed: 25 });
    }
    return this.placeBatch(traffic, player, specs).length > 0;
  }

  private injectRoadTrain(
    traffic: TrafficSystem, road: RoadSystem, player: EventPlayer,
    lanes: number[], s0: number, playerLane: number,
  ): boolean {
    const options = lanes.filter((l) => l !== playerLane);
    if (options.length === 0) return false;
    const lane = options[Math.floor(this.rng() * options.length)];
    return (
      this.placeBatch(traffic, player, [
        { lane, s: s0, family: 6, speed: 20 },
        { lane, s: s0 - 36, family: 6, speed: 20 },
      ]).length > 0
    );
  }

  private injectRubberneck(
    traffic: TrafficSystem, road: RoadSystem, player: EventPlayer,
    lanes: number[], s0: number, playerLane: number,
  ): boolean {
    // two ADJACENT lanes crawl; prefer a pair that leaves the player's lane
    // free — the fun is swinging around crawling traffic
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i + 1 < lanes.length; i++) pairs.push([lanes[i], lanes[i + 1]]);
    pairs.sort((a, b) => {
      const aFree = a.includes(playerLane) ? 1 : 0;
      const bFree = b.includes(playerLane) ? 1 : 0;
      return aFree - bFree;
    });
    for (const [l1, l2] of pairs) {
      const specs = [
        { lane: l1, s: s0, family: 1, speed: 12 },
        { lane: l2, s: s0, family: 4, speed: 12 },
      ];
      if (this.placeBatch(traffic, player, specs).length > 0) return true;
    }
    return false;
  }

  private injectCutter(
    traffic: TrafficSystem, road: RoadSystem, player: EventPlayer,
    lanes: number[], s0: number, playerLane: number,
  ): boolean {
    // a car one lane over signals into the player's lane well ahead —
    // the blinker is the readable cue, the geometry is always beatable
    if (!lanes.includes(playerLane)) return false;
    const side = lanes.includes(playerLane - 1) ? playerLane - 1 : playerLane + 1;
    if (!lanes.includes(side)) return false;
    return (
      this.placeBatch(traffic, player, [
        { lane: side, s: s0, family: 2, speed: 27, signal: (playerLane - side) as -1 | 1, laneTo: playerLane },
      ]).length > 0
    );
  }

  private injectWeaver(
    traffic: TrafficSystem, road: RoadSystem, player: EventPlayer,
    lanes: number[], s0: number, playerLane: number,
  ): boolean {
    // an interior lane (room to weave both ways), never the player's
    const interior = lanes.filter((l) => l !== playerLane && l > Math.min(...lanes) && l < Math.max(...lanes));
    const pool = interior.length > 0 ? interior : lanes.filter((l) => l !== playerLane);
    if (pool.length === 0) return false;
    const lane = pool[Math.floor(this.rng() * pool.length)];
    const placed = this.placeBatch(traffic, player, [{ lane, s: s0, family: 1, speed: 24 }]);
    if (placed.length === 0) return false;
    const a = placed[0];
    this.weavers.push({ agent: a, id: a.id, timer: 1.5 });
    return true;
  }

  /** Scripted per-tick upkeep: weavers drift between lanes on their blinkers. */
  private script(dt: number, traffic: TrafficSystem, road: RoadSystem): void {
    const laneCount = traffic.laneCount;
    for (let i = this.weavers.length - 1; i >= 0; i--) {
      const w = this.weavers[i];
      const a = w.agent;
      if (!a.active || a.id !== w.id || a.state === 'KNOCKED') {
        this.weavers.splice(i, 1);
        continue;
      }
      if (a.state !== 'CRUISE' || a.signal !== 0) continue;
      w.timer -= dt;
      if (w.timer > 0) continue;
      const onc = road.oncomingAt(a.s);
      const opts: number[] = [];
      if (a.lane - 1 >= onc) opts.push(a.lane - 1);
      if (a.lane + 1 < laneCount) opts.push(a.lane + 1);
      if (opts.length === 0) continue;
      const to = opts[Math.floor(this.rng() * opts.length)];
      a.signal = (to - a.lane) as -1 | 1;
      a.signalTimer = 0;
      a.laneTo = to;
      w.timer = 3.2 + this.rng() * 1.6;
    }
  }
}
