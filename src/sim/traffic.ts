// TrafficSystem (PLAN §8): kinematic lane agents with an IDM/MOBIL-inspired
// FSM, a fairness-guaranteeing spawner, knocked ballistics with capped chain
// reactions, and swept near-miss detection. Pure sim: no DOM/Three.
//
// FAIRNESS INVARIANT (tested in the soak): at every moment the player must
// have ≥1 reachable lane whose nearest same-lane agent leaves a survivable
// time-gap (reaction distance v×1.6 s, PLAN). The spawner checks it before
// accepting any placement; the soak verifies it continuously.

import type { Car } from './car';
import { mulberry32, type Rng } from './rng';
import {
  FAMILIES,
  DEFAULT_TRAFFIC_CONFIG,
  type TrafficAgent,
  type TrafficConfig,
  type NearMissEvent,
  type CrashEvent,
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
    agentId: 0, tier: 'NEAR' as const, clearance: 0, closingSpeed: 0, oncoming: false,
  }));
  nearMissCount = 0;
  readonly crashes: CrashEvent[] = Array.from({ length: 16 }, () => ({
    agentId: 0, impulse: 0, headOn: false,
  }));
  crashCount = 0;

  private cfg: TrafficConfig;
  private rng: Rng;
  private nextId = 1;
  private spawnTimer = 0;
  private simTime = 0;
  private readonly contact: Contact = { nx: 0, nz: 0, depth: 0 };
  private readonly agentObb: OBB = { x: 0, z: 0, hw: 0, hl: 0, h: 0 };
  private lastEscapeCheck = -1;
  private lastEscapeValue = true;

  constructor(cfg: Partial<TrafficConfig> = {}) {
    this.cfg = { ...DEFAULT_TRAFFIC_CONFIG, ...cfg };
    this.rng = mulberry32(this.cfg.seed);
    for (let i = 0; i < this.cfg.maxAgents; i++) {
      this.agents.push(this.blank());
    }
  }

  laneCenter(lane: number): number {
    return (lane - (this.cfg.laneCount - 1) / 2) * this.cfg.laneWidth;
  }

  playerLane(x: number): number {
    const l = Math.round(x / this.cfg.laneWidth + (this.cfg.laneCount - 1) / 2);
    return clamp(l, 0, this.cfg.laneCount - 1);
  }

  /**
   * FAIRNESS INVARIANT: does the player have a reachable, survivable lane?
   * Called by the spawner before accepting a placement, and by the soak test
   * continuously. Pure — evaluates the CURRENT agent snapshot.
   */
  hasEscape(px: number, pz: number, pu: number, pHalfW: number, pHalfL: number): boolean {
    const reach = REACTION_T * LATERAL_SPEED + pHalfW;
    for (let lane = 0; lane < this.cfg.laneCount; lane++) {
      const lx = this.laneCenter(lane);
      if (Math.abs(lx - px) > reach) continue; // not reachable in time
      let blocked = false;
      for (const a of this.agents) {
        if (!a.active) continue;
        const alx = this.laneCenter(a.laneTo >= 0 && a.state === 'CHANGE_LANE' ? a.laneTo : a.lane);
        if (alx !== lx) continue;
        const dz = pz - a.z; // >0: agent ahead of player (z more negative... agent ahead = a.z < pz → dz = pz − a.z > 0 ✓)
        if (Math.abs(dz) < FAMILIES[a.family].halfL + pHalfL + 2.5) {
          blocked = true; // beside/overlapping the entry
          break;
        }
        if (dz > 0) {
          const gap = dz - (FAMILIES[a.family].halfL + pHalfL);
          const closing = Math.max(0.5, pu - a.speed);
          const brakeDist = (pu * pu) / 20 + 4;
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

    this.spawn(dt, car, pHalfW, pHalfL);

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

  // ------------------------------------------------------------------ spawn

  private spawn(dt: number, car: Car, pHalfW: number, pHalfL: number): void {
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

    const lane = Math.floor(this.rng() * this.cfg.laneCount);
    const z = car.z - (this.cfg.spawnAheadMin + this.rng() * (this.cfg.spawnAheadMax - this.cfg.spawnAheadMin));

    // never spawn into the player's current lane
    if (lane === this.playerLane(car.x)) return;
    // lane gap: no neighbour within 30 m of the placement
    for (const a of this.agents) {
      if (!a.active) continue;
      const alx = this.laneCenter(a.lane);
      if (alx !== this.laneCenter(lane)) continue;
      if (Math.abs(a.z - z) < 30 + FAMILIES[a.family].halfL) return;
    }

    // place provisionally, then check the fairness invariant
    this.arm(slot, lane, z);
    if (!this.hasEscape(car.x, car.z, car.u, pHalfW, pHalfL)) {
      slot.active = false; // reject — would wall the player
    }
  }

  private arm(slot: TrafficAgent, lane: number, z: number): void {
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
    slot.x = this.laneCenter(lane);
    slot.z = z;
    slot.heading = 0;
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
      active: false, id: 0, family: 1, paint: 0, x: 0, z: 0, heading: 0,
      speed: 0, desiredSpeed: 0, state: 'CRUISE', lane: 0, laneFrom: 0, laneTo: -1,
      lanePhase: 0, signal: 0, signalTimer: 0, changeTimer: 0,
      kvx: 0, kvz: 0, kspin: 0, knockedTimer: 0, chainDepth: 0,
      nmTracked: false, nmMinClearance: 99, nmWasAhead: false,
    };
  }

  // ------------------------------------------------------------------ agents

  private stepAgent(a: TrafficAgent, dt: number, car: Car): void {
    const fam = FAMILIES[a.family];

    if (a.state === 'CHANGE_LANE') {
      a.changeTimer += dt;
      a.lanePhase = clamp(a.changeTimer / 2.2, 0, 1);
      const s = a.lanePhase * a.lanePhase * (3 - 2 * a.lanePhase);
      a.x = this.laneCenter(a.laneFrom) + (this.laneCenter(a.laneTo) - this.laneCenter(a.laneFrom)) * s;
      if (a.lanePhase >= 1) {
        a.lane = a.laneTo;
        a.laneTo = -1;
        a.state = 'CRUISE';
        a.signal = 0;
      }
    } else {
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

    // IDM-lite car following (leader in current or target lane, whichever is worse)
    const leader = this.findLeader(a);
    let acc: number;
    if (leader) {
      const lf = FAMILIES[leader.family];
      const gap = a.z - leader.z - (FAMILIES[a.family].halfL + lf.halfL);
      const dv = a.speed - leader.speed;
      const sStar = fam.s0 + a.speed * fam.headwayT + (a.speed * dv) / (2 * Math.sqrt(fam.aMax * fam.bComfort));
      acc = fam.aMax * (1 - Math.pow(a.speed / Math.max(a.desiredSpeed, 1), 4) - Math.pow(sStar / Math.max(gap, 0.5), 2));
      a.state = a.state === 'CHANGE_LANE' ? a.state : 'FOLLOW';
    } else {
      acc = fam.aMax * (1 - Math.pow(a.speed / Math.max(a.desiredSpeed, 1), 4));
      if (a.state === 'FOLLOW' && a.signal === 0) a.state = 'CRUISE';
    }

    // PANIC: the player closing fast from behind onto me → brake (readable cue)
    // player travels −z ⇒ agent AHEAD of player has a.z < car.z (dzp < 0)
    const dzp = a.z - car.z;
    if (dzp < 0 && dzp > -45 && Math.abs(this.laneCenter(a.lane) - car.x) < this.cfg.laneWidth * 0.7) {
      const closing = car.u - a.speed;
      if (closing > 8) acc = Math.min(acc, -3);
    }

    a.speed = clamp(a.speed + clamp(acc, -6, fam.aMax) * dt, 0, fam.vMax + 5);
    a.z -= a.speed * dt;
  }

  private findLeader(a: TrafficAgent): TrafficAgent | null {
    let best: TrafficAgent | null = null;
    let bestDz = Infinity;
    const lanes = a.state === 'CHANGE_LANE' || a.signal !== 0 ? [a.lane, a.laneTo] : [a.lane];
    for (const o of this.agents) {
      if (!o.active || o === a || o.state === 'KNOCKED') continue;
      if (!lanes.includes(o.lane) && !lanes.includes(o.laneTo)) continue;
      const dz = a.z - o.z; // >0: o ahead of a
      if (dz > 0 && dz < 70 && dz < bestDz) {
        bestDz = dz;
        best = o;
      }
    }
    return best;
  }

  private considerLaneChange(a: TrafficAgent, car: Car): void {
    const dir = this.rng() < 0.5 ? -1 : 1;
    const target = a.lane + dir;
    if (target < 0 || target >= this.cfg.laneCount) return;
    // never change into the player's current lane near the player
    if (target === this.playerLane(car.x) && Math.abs(a.z - car.z) < 30) return;
    const tx = this.laneCenter(target);
    let frontGap = Infinity;
    let rearGap = Infinity;
    for (const o of this.agents) {
      if (!o.active || o === a || o.state === 'KNOCKED') continue;
      if (this.laneCenter(o.lane) !== tx) continue;
      const dz = a.z - o.z;
      if (dz > 0) frontGap = Math.min(frontGap, dz - (FAMILIES[a.family].halfL + FAMILIES[o.family].halfL));
      else rearGap = Math.min(rearGap, -dz - (FAMILIES[a.family].halfL + FAMILIES[o.family].halfL));
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
      if (!sweptPlayerSAT(prevX, prevZ, car.x, car.z, pHalfW, pHalfL, car.heading, this.agentObb, this.contact)) continue;

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
        };
      }
      if (a.state !== 'KNOCKED') {
        a.state = 'KNOCKED';
        a.knockedTimer = 0;
        a.signal = 0;
      }
    }
  }

  private detectNearMiss(car: Car, pHalfW: number, pHalfL: number): void {
    const closingMin = PASS_CLOSING;
    for (const a of this.agents) {
      if (!a.active || a.state === 'KNOCKED') continue;
      const fam = FAMILIES[a.family];
      const lenSum = fam.halfL + pHalfL;
      // player travels −z ⇒ agent fully AHEAD when dz < −lenSum
      const dz = a.z - car.z;
      if (dz < -lenSum) {
        a.nmWasAhead = true;
      }
      if (Math.abs(dz) < lenSum + 1.5) {
        const closing = car.u - a.speed;
        if (closing > closingMin && a.nmWasAhead && !a.nmTracked) a.nmTracked = true;
        if (a.nmTracked) {
          const c = Math.abs(a.x - car.x) - (fam.halfW + pHalfW);
          a.nmMinClearance = Math.min(a.nmMinClearance, c);
        }
      }
      if (a.nmTracked && dz > lenSum) {
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
              closingSpeed: car.u - a.speed,
              oncoming: false,
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
      if (a.z > car.z + this.cfg.despawnBehind) a.active = false;
      else if (a.state === 'KNOCKED' && a.knockedTimer > 4) a.active = false;
    }
  }

  /** Determinism probe over active agents. */
  hash(): string {
    let h = 0x811c9dc5;
    for (const a of this.agents) {
      if (!a.active) continue;
      h ^= a.id;
      h = Math.imul(h, 0x01000193) >>> 0;
      h ^= Math.floor(a.x * 256) | (Math.floor(a.z * 256) << 14);
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

  get escapeInvariant(): boolean {
    // cached probe — the soak calls hasEscape directly; this exposes the last
    // spawner-side result for the HUD
    void this.lastEscapeCheck;
    void this.lastEscapeValue;
    return true;
  }
}
