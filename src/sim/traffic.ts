// TrafficSystem (PLAN §8): kinematic lane agents with an IDM/MOBIL-inspired
// FSM, a fairness-guaranteeing spawner, knocked ballistics with capped chain
// reactions, and swept near-miss detection. Pure sim: no DOM/Three.
//
// M4: agents live in ROAD space — (s, lat, dir) — and are mapped onto the
// curved spine for world-space collision/rendering each tick. "Ahead" means
// larger s (smaller world z). Oncoming agents (dir −1) close at
// pu + speed; every s-space rule (following, gaps, near-miss, fairness) uses
// the dir-aware closing speed, which makes oncoming lanes naturally lethal
// and never a fair "escape".
//
// FAIRNESS INVARIANT (tested in the soak): at every moment the player must
// have ≥1 reachable lane whose nearest same-direction agent leaves a
// survivable time-gap (reaction distance v×1.6 s, PLAN). The spawner checks
// it before accepting any placement; the soak verifies it continuously.

import type { Car } from './car';
import { mulberry32, type Rng } from './rng';
import { RoadSystem, type Projection, type SpinePoint } from './road';
import {
  FAMILIES,
  DEFAULT_TRAFFIC_CONFIG,
  type TrafficAgent,
  type TrafficConfig,
  type NearMissEvent,
  type CrashEvent,
  type PassEvent,
  type NearMissTier,
} from './trafficTypes';
import { sweptPlayerSAT, resolveHit, type Contact, type OBB } from './collision';

const FAMILY_WEIGHTS = [5, 5, 3, 3, 2, 1, 1];
const TOTAL_WEIGHT = FAMILY_WEIGHTS.reduce((s, v) => s + v, 0);

const REACTION_T = 1.6; // s (PLAN fairness)
const LATERAL_SPEED = 6; // m/s assumed player lateral reach
const PASS_CLOSING = 40 / 3.6; // m/s minimum closing for a near miss
const TIER_INCHES = 0.4;
const TIER_VERY_CLOSE = 0.8;
const TIER_NEAR = 1.2;

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export class TrafficSystem {
  readonly agents: TrafficAgent[] = [];
  readonly nearMisses: NearMissEvent[] = Array.from({ length: 64 }, () => ({
    agentId: 0, tier: 'NEAR' as const, clearance: 0, closingSpeed: 0, oncoming: false, side: 0,
  }));
  nearMissCount = 0;
  readonly crashes: CrashEvent[] = Array.from({ length: 16 }, () => ({
    agentId: 0, impulse: 0, headOn: false, x: 0, z: 0,
  }));
  crashCount = 0;
  readonly passes: PassEvent[] = Array.from({ length: 64 }, () => ({
    agentId: 0, closingSpeed: 0, oncoming: false,
  }));
  passCount = 0;

  /** player road-frame pose, refreshed each update() (tests + HUD read these) */
  playerS = 0;
  playerLat = 0;

  private cfg: TrafficConfig;
  private readonly road: RoadSystem;
  private rng: Rng;
  private nextId = 1;
  private spawnTimer = 0;
  private simTime = 0;
  private readonly contact: Contact = { nx: 0, nz: 0, depth: 0 };
  private readonly agentObb: OBB = { x: 0, z: 0, hw: 0, hl: 0, h: 0 };
  private readonly proj: Projection = { s: 0, lat: 0 };
  private readonly spine: SpinePoint = { x: 0, z: 0, heading: 0 };

  constructor(cfg: Partial<TrafficConfig> = {}, road?: RoadSystem) {
    this.cfg = { ...DEFAULT_TRAFFIC_CONFIG, ...cfg };
    this.road = road ?? RoadSystem.straight(this.cfg.laneCount, this.cfg.laneWidth);
    this.rng = mulberry32(this.cfg.seed);
    for (let i = 0; i < this.cfg.maxAgents; i++) {
      this.agents.push(this.blank());
    }
  }

  laneCenter(lane: number): number {
    return this.road.laneLat(lane);
  }

  get laneCount(): number {
    return this.cfg.laneCount;
  }

  get laneWidth(): number {
    return this.cfg.laneWidth;
  }

  /**
   * Event-injector placement (M8): arm a slot with an explicit spec —
   * same-direction lanes only, construction-aware, lane-gap-checked.
   * Returns null (no allocation) when the spot is invalid; the caller owns
   * fairness (placeBatch rolls back on a hasEscape violation).
   */
  spawnEventAgent(spec: {
    lane: number;
    s: number;
    family: number;
    speed: number;
    desiredSpeed?: number;
    signal?: -1 | 0 | 1;
    laneTo?: number;
  }): TrafficAgent | null {
    const onc = this.road.oncomingAt(spec.s);
    if (spec.lane < onc || spec.lane >= this.cfg.laneCount) return null;
    if (this.road.laneBlocked(spec.s, spec.lane)) return null;
    const slot = this.agents.find((a) => !a.active);
    if (!slot) return null;
    for (const a of this.agents) {
      if (!a.active || a.dir !== 1) continue;
      if (this.laneCenter(a.lane) !== this.laneCenter(spec.lane)) continue;
      if (Math.abs(a.s - spec.s) < 24 + FAMILIES[a.family].halfL) return null;
    }
    this.arm(slot, spec.lane, spec.s, 1);
    // arm() randomised family/speed — the event owns those
    slot.family = spec.family;
    slot.speed = spec.speed;
    slot.desiredSpeed = spec.desiredSpeed ?? spec.speed;
    slot.signal = 0;
    slot.signalTimer = 0;
    slot.laneTo = -1;
    if (spec.signal) {
      slot.signal = spec.signal;
      if (spec.laneTo !== undefined && spec.laneTo >= 0) slot.laneTo = spec.laneTo;
    }
    this.mapToWorld(slot);
    return slot;
  }

  playerLane(lat: number): number {
    const l = Math.round(lat / this.cfg.laneWidth + (this.cfg.laneCount - 1) / 2);
    return clamp(l, 0, this.cfg.laneCount - 1);
  }

  /**
   * FAIRNESS INVARIANT: does the player have a reachable, survivable lane?
   * Road-frame: oncoming agents close at pu + speed so their lanes never
   * count as escapes while occupied. Pure — evaluates the CURRENT snapshot.
   */
  hasEscape(ps: number, plat: number, pu: number, pHalfW: number, pHalfL: number): boolean {
    const reach = REACTION_T * LATERAL_SPEED + pHalfW;
    for (let lane = 0; lane < this.cfg.laneCount; lane++) {
      const lx = this.laneCenter(lane);
      if (Math.abs(lx - plat) > reach) continue; // not reachable in time
      let blocked = false;
      for (const a of this.agents) {
        if (!a.active) continue;
        const alx = this.laneCenter(a.laneTo >= 0 && a.state === 'CHANGE_LANE' ? a.laneTo : a.lane);
        if (alx !== lx) continue;
        const ds = a.s - ps; // >0: agent ahead of the player
        if (Math.abs(ds) < FAMILIES[a.family].halfL + pHalfL + 1.0) {
          // beside/overlapping the entry. ADR-012: a neighbour barely slower
          // than us (≤1.5 m/s) is MATCHABLE within a second — not a wall —
          // and an agent BEHIND that we outrun can never block the entry.
          // Only a genuinely closing occupant (either direction) blocks.
          const relClose = pu - a.dir * a.speed; // + = we pull ahead of them
          if (ds < 0 ? -relClose > 1.5 : relClose > 1.5) {
            blocked = true;
            break;
          }
          continue;
        }
        if (ds > 0) {
          const gap = ds - (FAMILIES[a.family].halfL + pHalfL);
          const closing = Math.max(0.5, pu - a.dir * a.speed);
          // brake distance to MATCH the leader at supercar braking (0.8 g) —
          // the player survives by matching speed, not by stopping short
          const brakeDist = (closing * closing) / 16 + 2;
          if (gap / closing < REACTION_T && gap < brakeDist) {
            blocked = true;
            break;
          }
        }
      }
      if (!blocked) return true;
    }
    return false;
  }

  /** One sim step. prevX/prevZ = player position before this step (swept). */
  update(dt: number, car: Car, prevX: number, prevZ: number): void {
    this.simTime += dt;
    const pHalfW = car.tune.bodyDims[0] / 2;
    const pHalfL = car.tune.bodyDims[2] / 2;

    this.road.project(car.x, car.z, this.proj);
    this.playerS = this.proj.s;
    this.playerLat = this.proj.lat;
    this.puCache = car.u;

    this.spawn(dt, pHalfW, pHalfL);

    for (const a of this.agents) {
      if (!a.active) continue;
      if (a.state === 'KNOCKED') {
        this.stepKnocked(a, dt, car);
        continue;
      }
      this.stepAgent(a, dt, car);
    }

    this.collidePlayer(car, prevX, prevZ, pHalfW, pHalfL);
    this.detectNearMiss(car, pHalfW, pHalfL);
    this.despawn(car);
  }

  /** Floating-origin shift (pure +z translation) for knocked remnants. */
  shiftWorld(dz: number): void {
    for (const a of this.agents) {
      if (a.active && a.state === 'KNOCKED') a.z += dz;
    }
  }

  // ------------------------------------------------------------------ spawn

  /**
   * ADR-012: fill the corridor around the player at run start — the road is
   * alive from the first frame instead of populating only as the (now slow)
   * spawner window drifts in. Uses the normal spawn rules (zones, lane gaps,
   * fairness rollback) with a nearer minimum so cars are immediately visible.
   */
  warmup(pHalfW: number, pHalfL: number): void {
    const windowM = this.cfg.spawnAheadMax + this.cfg.despawnBehind;
    const target = Math.min(
      this.cfg.maxAgents,
      Math.round(this.cfg.densityPerKmPerLane * this.cfg.laneCount * (windowM / 1000)),
    );
    for (let i = 0; i < 400; i++) {
      let active = 0;
      for (const a of this.agents) if (a.active) active++;
      if (active >= target) return;
      this.spawnTimer = 0;
      this.spawn(0, pHalfW, pHalfL, 40);
    }
  }

  private spawn(dt: number, pHalfW: number, pHalfL: number, aheadMin = 0): void {
    const windowM = this.cfg.spawnAheadMax + this.cfg.despawnBehind;
    const target = Math.min(
      this.cfg.maxAgents,
      Math.round(this.cfg.densityPerKmPerLane * this.cfg.laneCount * (windowM / 1000)),
    );
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawnTimer = 0.2;

    let active = 0;
    for (const a of this.agents) if (a.active) active++;
    if (active >= target) return;

    const slot = this.agents.find((a) => !a.active);
    if (!slot) return;

    const near = aheadMin || this.cfg.spawnAheadMin;
    const s = this.playerS + (near + this.rng() * (this.cfg.spawnAheadMax - near));
    const onc = this.road.oncomingAt(s);

    // pick a direction + lane valid for the zone layout at s
    let lane: number;
    let dir: 1 | -1;
    if (onc > 0 && this.rng() < 0.38) {
      lane = Math.floor(this.rng() * onc);
      dir = -1;
    } else {
      lane = onc + Math.floor(this.rng() * (this.cfg.laneCount - onc));
      dir = 1;
    }
    if (this.road.laneBlocked(s, lane)) return;
    // never spawn into the player's current lane (same-direction half)
    if (dir > 0 && lane === this.playerLane(this.playerLat)) return;
    // lane gap (same lane AND same direction — the halves never interact)
    for (const a of this.agents) {
      if (!a.active || a.dir !== dir) continue;
      if (this.laneCenter(a.lane) !== this.laneCenter(lane)) continue;
      if (Math.abs(a.s - s) < 30 + FAMILIES[a.family].halfL) return;
    }

    // place provisionally, then check the fairness invariant
    this.arm(slot, lane, s, dir);
    if (!this.hasEscape(this.playerS, this.playerLat, this.puCache, pHalfW, pHalfL)) {
      slot.active = false; // reject — would wall the player
    }
  }

  private puCache = 0;

  private arm(slot: TrafficAgent, lane: number, s: number, dir: 1 | -1): void {
    const f = this.pickFamily();
    const fam = FAMILIES[f];
    slot.active = true;
    slot.id = this.nextId++;
    slot.family = f;
    slot.paint = Math.floor(this.rng() * 6);
    slot.lane = lane;
    slot.laneFrom = lane;
    slot.laneTo = -1;
    slot.lanePhase = 0;
    slot.s = s;
    slot.lat = this.laneCenter(lane);
    slot.dir = dir;
    slot.speed = fam.vMin + this.rng() * (fam.vMax - fam.vMin);
    slot.desiredSpeed = slot.speed;
    slot.state = 'CRUISE';
    slot.signal = 0;
    slot.signalTimer = 0;
    slot.changeTimer = 0;
    slot.kvx = 0;
    slot.kvz = 0;
    slot.kspin = 0;
    slot.knockedTimer = 0;
    slot.chainDepth = 0;
    slot.nmTracked = false;
    slot.nmMinClearance = 99;
    slot.nmWasAhead = false;
    slot.passCounted = false;
    slot.hadContact = false;
    slot.mdx = 0;
    slot.mdz = 0;
    this.mapToWorld(slot);
  }

  private pickFamily(): number {
    let r = this.rng() * TOTAL_WEIGHT;
    for (let i = 0; i < FAMILY_WEIGHTS.length; i++) {
      r -= FAMILY_WEIGHTS[i];
      if (r <= 0) return i;
    }
    return 0;
  }

  private blank(): TrafficAgent {
    return {
      active: false, id: 0, family: 1, paint: 0, s: 0, lat: 0, dir: 1,
      x: 0, z: 0, heading: 0, mdx: 0, mdz: 0,
      speed: 0, desiredSpeed: 0, state: 'CRUISE', lane: 0, laneFrom: 0, laneTo: -1,
      lanePhase: 0, signal: 0, signalTimer: 0, changeTimer: 0,
      kvx: 0, kvz: 0, kspin: 0, knockedTimer: 0, chainDepth: 0,
      nmTracked: false, nmMinClearance: 99, nmWasAhead: false,
      passCounted: false, hadContact: false,
    };
  }

  // ------------------------------------------------------------------ agents

  /** (s, lat, dir) → world (x, z, heading) via the spine. */
  private mapToWorld(a: TrafficAgent): void {
    this.road.sample(a.s, this.spine);
    const rx = Math.cos(this.spine.heading);
    const rz = Math.sin(this.spine.heading);
    a.x = this.spine.x + rx * a.lat;
    a.z = this.spine.z + rz * a.lat;
    a.heading = a.dir > 0 ? this.spine.heading : this.spine.heading + Math.PI;
  }

  private stepAgent(a: TrafficAgent, dt: number, car: Car): void {
    const fam = FAMILIES[a.family];

    // zone validity: if the layout changed under us (oncoming run ended,
    // etc.) the agent is beyond fog — despawn silently
    const onc = this.road.oncomingAt(a.s);
    if ((a.dir > 0 && a.lane < onc) || (a.dir < 0 && a.lane >= onc)) {
      a.active = false;
      return;
    }

    if (a.state === 'CHANGE_LANE') {
      a.changeTimer += dt;
      a.lanePhase = clamp(a.changeTimer / 2.2, 0, 1);
      const s = a.lanePhase * a.lanePhase * (3 - 2 * a.lanePhase);
      a.lat = this.laneCenter(a.laneFrom) + (this.laneCenter(a.laneTo) - this.laneCenter(a.laneFrom)) * s;
      if (a.lanePhase >= 1) {
        a.lane = a.laneTo;
        a.laneTo = -1;
        a.state = 'CRUISE';
        a.signal = 0;
      }
    } else {
      // construction ahead in our lane? signal out early (readable cue)
      if (a.dir > 0 && a.signal === 0 && this.road.laneBlocked(a.s + 120, a.lane)) {
        // dodge toward the road centre: rightmost block ⇒ move left, else right
        const away = a.lane >= this.cfg.laneCount - 1 ? -1 : 1;
        const target = a.lane + away;
        if (target >= onc && target < this.cfg.laneCount && !this.road.laneBlocked(a.s + 160, target)) {
          a.signal = away as -1 | 1;
          a.signalTimer = 0;
          a.laneTo = target;
        }
      }
      // signalling phase before the move
      if (a.signal !== 0) {
        a.signalTimer += dt;
        if (a.signalTimer >= 1.0) {
          a.state = 'CHANGE_LANE';
          a.changeTimer = 0;
          a.lanePhase = 0;
          a.laneFrom = a.lane;
        }
      } else if (this.rng() < fam.laneChangeEagerness * dt * 0.5) {
        this.considerLaneChange(a, car);
      }
    }

    // IDM-lite car following (leader in current or target lane, whichever is
    // worse; oncoming agents only follow oncoming leaders)
    const leader = this.findLeader(a);
    let acc: number;
    if (leader) {
      const lf = FAMILIES[leader.family];
      const rel = (leader.s - a.s) * a.dir; // >0: leader ahead of a
      const gap = rel - (FAMILIES[a.family].halfL + lf.halfL);
      const dv = a.speed - leader.speed;
      const sStar = fam.s0 + a.speed * fam.headwayT + (a.speed * dv) / (2 * Math.sqrt(fam.aMax * fam.bComfort));
      acc = fam.aMax * (1 - Math.pow(a.speed / Math.max(a.desiredSpeed, 1), 4) - Math.pow(sStar / Math.max(gap, 0.5), 2));
      a.state = a.state === 'CHANGE_LANE' ? a.state : 'FOLLOW';
    } else {
      acc = fam.aMax * (1 - Math.pow(a.speed / Math.max(a.desiredSpeed, 1), 4));
      if (a.state === 'FOLLOW' && a.signal === 0) a.state = 'CRUISE';
    }

    // PANIC: the player closing fast from behind onto me → brake (readable
    // cue). Same-direction traffic only — oncoming cars keep their line.
    if (a.dir > 0) {
      const dsp = a.s - this.playerS;
      if (dsp > 0 && dsp < 45 && Math.abs(this.laneCenter(a.lane) - this.playerLat) < this.cfg.laneWidth * 0.7) {
        const closing = car.u - a.speed;
        if (closing > 8) acc = Math.min(acc, -3);
      }
    }

    a.speed = clamp(a.speed + clamp(acc, -6, fam.aMax) * dt, 0, fam.vMax + 5);
    a.s += a.dir * a.speed * dt;

    // world mapping + per-tick displacement (relative collision sweep)
    const wx = a.x;
    const wz = a.z;
    this.mapToWorld(a);
    a.mdx = a.x - wx;
    a.mdz = a.z - wz;
  }

  private findLeader(a: TrafficAgent): TrafficAgent | null {
    let best: TrafficAgent | null = null;
    let bestRel = Infinity;
    const lanes = a.state === 'CHANGE_LANE' || a.signal !== 0 ? [a.lane, a.laneTo] : [a.lane];
    for (const o of this.agents) {
      if (!o.active || o === a || o.state === 'KNOCKED' || o.dir !== a.dir) continue;
      if (!lanes.includes(o.lane) && !lanes.includes(o.laneTo)) continue;
      const rel = (o.s - a.s) * a.dir; // >0: o ahead of a
      if (rel > 0 && rel < 70 && rel < bestRel) {
        bestRel = rel;
        best = o;
      }
    }
    return best;
  }

  private considerLaneChange(a: TrafficAgent, car: Car): void {
    const onc = this.road.oncomingAt(a.s);
    const dir = this.rng() < 0.5 ? -1 : 1;
    const target = a.lane + dir;
    if (target < onc || target >= this.cfg.laneCount) return;
    if (this.road.laneBlocked(a.s + 40, target)) return;
    // never change into the player's current lane near the player
    if (a.dir > 0 && target === this.playerLane(this.playerLat) && Math.abs(a.s - this.playerS) < 30) return;
    const tx = this.laneCenter(target);
    let frontGap = Infinity;
    let rearGap = Infinity;
    for (const o of this.agents) {
      if (!o.active || o === a || o.state === 'KNOCKED' || o.dir !== a.dir) continue;
      if (this.laneCenter(o.lane) !== tx) continue;
      const rel = (o.s - a.s) * a.dir;
      if (rel > 0) frontGap = Math.min(frontGap, rel - (FAMILIES[a.family].halfL + FAMILIES[o.family].halfL));
      else rearGap = Math.min(rearGap, -rel - (FAMILIES[a.family].halfL + FAMILIES[o.family].halfL));
    }
    if (frontGap < a.speed * 1.2 + 6) return;
    if (rearGap < 8) return;
    a.signal = dir as -1 | 1;
    a.signalTimer = 0;
    a.laneTo = target;
  }

  private stepKnocked(a: TrafficAgent, dt: number, car: Car): void {
    a.knockedTimer += dt;
    a.x += a.kvx * dt;
    a.z += a.kvz * dt;
    a.heading += a.kspin * dt;
    a.mdx = 0;
    a.mdz = 0;
    const decay = Math.max(0, 1 - 2.2 * dt);
    a.kvx *= decay;
    a.kvz *= decay;
    a.kspin *= Math.max(0, 1 - 1.5 * dt);

    // capped chain reactions (PLAN: ≤3 secondaries per event)
    if (a.chainDepth < 3) {
      for (const o of this.agents) {
        if (!o.active || o === a || o.state === 'KNOCKED') continue;
        if (Math.abs(o.z - a.z) < FAMILIES[a.family].halfL + FAMILIES[o.family].halfL && Math.abs(o.x - a.x) < FAMILIES[a.family].halfW + FAMILIES[o.family].halfW) {
          o.state = 'KNOCKED';
          o.kvx = a.kvx * 0.7;
          o.kvz = a.kvz * 0.7 + 2;
          o.kspin = (a.kspin || 1) * 0.6;
          o.chainDepth = a.chainDepth + 1;
          o.knockedTimer = 0;
        }
      }
    }
    void car;
  }

  // ------------------------------------------------------------------ player

  private collidePlayer(car: Car, prevX: number, prevZ: number, pHalfW: number, pHalfL: number): void {
    for (const a of this.agents) {
      if (!a.active) continue;
      if (Math.abs(a.z - car.z) > 14 || Math.abs(a.x - car.x) > 4) continue;
      const fam = FAMILIES[a.family];
      this.agentObb.x = a.x;
      this.agentObb.z = a.z;
      this.agentObb.hw = fam.halfW;
      this.agentObb.hl = fam.halfL;
      this.agentObb.h = a.heading;
      // sweep in the agent's relative frame — oncoming closings reach
      // ~101 m/s (365 km/h) where BOTH bodies move > 0.5 m per tick
      if (!sweptPlayerSAT(prevX - a.mdx, prevZ - a.mdz, car.x - a.mdx, car.z - a.mdz, pHalfW, pHalfL, car.heading, this.agentObb, this.contact)) continue;

      // normal from agent toward player
      const nx = -this.contact.nx;
      const nz = -this.contact.nz;
      const body = {
        x: car.x, z: car.z, heading: car.heading, u: car.u, w: car.w,
        omega: car.omega, halfW: pHalfW, halfL: pHalfL, iz: car.tune.iz,
      };
      const closing = resolveHit(body, a, fam.massRatio, nx, nz);
      // resolveHit mutated the local body — copy the result back onto the car
      car.u = body.u;
      car.w = body.w;
      car.omega = body.omega;
      if (closing > 0.5 && this.crashCount < this.crashes.length) {
        const fx = Math.sin(car.heading);
        const fz = -Math.cos(car.heading);
        this.crashes[this.crashCount++] = {
          agentId: a.id,
          impulse: closing,
          headOn: nx * fx + nz * fz < -0.5,
          x: (car.x + a.x) * 0.5,
          z: (car.z + a.z) * 0.5,
        };
      }
      a.hadContact = true;
      if (a.state !== 'KNOCKED') {
        a.state = 'KNOCKED';
        a.knockedTimer = 0;
        a.signal = 0;
      }
    }
  }

  private detectNearMiss(car: Car, pHalfW: number, pHalfL: number): void {
    for (const a of this.agents) {
      if (!a.active || a.state === 'KNOCKED') continue;
      const fam = FAMILIES[a.family];
      const lenSum = fam.halfL + pHalfL;
      // s-space: agent fully AHEAD of the player when ds > lenSum
      const ds = a.s - this.playerS;
      if (ds > lenSum) {
        a.nmWasAhead = true;
      }
      if (Math.abs(ds) < lenSum + 1.5) {
        const closing = car.u - a.dir * a.speed;
        if (closing > PASS_CLOSING && a.nmWasAhead && !a.nmTracked) a.nmTracked = true;
        if (a.nmTracked) {
          const c = Math.abs(a.lat - this.playerLat) - (fam.halfW + pHalfW);
          a.nmMinClearance = Math.min(a.nmMinClearance, c);
        }
      }
      if (!a.passCounted && ds < -lenSum) {
        // fully passed (agent now behind) — clean-pass event, once per
        // encounter, only without contact on the way through
        const closing = car.u - a.dir * a.speed;
        if (!a.hadContact && closing > 2 && this.passCount < this.passes.length) {
          this.passes[this.passCount++] = {
            agentId: a.id,
            closingSpeed: closing,
            oncoming: a.dir < 0,
          };
        }
        a.passCounted = true;
      }
      if (a.nmTracked && ds < -lenSum) {
        // fully passed (agent now behind) — fire once per encounter
        if (this.nearMissCount < this.nearMisses.length) {
          const tier: NearMissTier | null =
            a.nmMinClearance <= TIER_INCHES ? 'INCHES'
            : a.nmMinClearance <= TIER_VERY_CLOSE ? 'VERY_CLOSE'
            : a.nmMinClearance <= TIER_NEAR ? 'NEAR'
            : null;
          if (tier !== null) {
            this.nearMisses[this.nearMissCount++] = {
              agentId: a.id,
              tier,
              clearance: a.nmMinClearance,
              closingSpeed: car.u - a.dir * a.speed,
              oncoming: a.dir < 0,
              side: a.lat - this.playerLat,
            };
          }
        }
        a.nmTracked = false; // one score per encounter ID (no respawn)
        a.nmWasAhead = false;
        a.nmMinClearance = 99;
      }
    }
  }

  private despawn(car: Car): void {
    for (const a of this.agents) {
      if (!a.active) continue;
      if (a.state === 'KNOCKED') {
        if (a.z > car.z + this.cfg.despawnBehind || a.knockedTimer > 4) a.active = false;
      } else if (a.s < this.playerS - this.cfg.despawnBehind) {
        a.active = false; // behind the player (s-space)
      }
    }
  }

  /** Determinism probe over active agents. */
  hash(): string {
    let h = 0x811c9dc5;
    for (const a of this.agents) {
      if (!a.active) continue;
      h ^= a.id;
      h = Math.imul(h, 0x01000193) >>> 0;
      h ^= Math.floor(a.s * 256) | (Math.floor(a.lat * 256) << 14);
      h = Math.imul(h, 0x01000193) >>> 0;
      h ^= Math.floor(a.speed * 256);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  /** Consume events (copy into fresh arrays for the UI). */
  takeNearMisses(): NearMissEvent[] {
    if (this.nearMissCount === 0) return [];
    const out = this.nearMisses.slice(0, this.nearMissCount);
    this.nearMissCount = 0;
    return out;
  }

  takeCrashes(): CrashEvent[] {
    if (this.crashCount === 0) return [];
    const out = this.crashes.slice(0, this.crashCount);
    this.crashCount = 0;
    return out;
  }

  takePasses(): PassEvent[] {
    if (this.passCount === 0) return [];
    const out = this.passes.slice(0, this.passCount);
    this.passCount = 0;
    return out;
  }

  /** Live density knob (difficulty director, EASY: gentle variety only). */
  setDensity(vehPerKmPerLane: number): void {
    this.cfg.densityPerKmPerLane = clamp(vehPerKmPerLane, 0, 30);
  }
}
