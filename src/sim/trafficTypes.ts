// Traffic data model: vehicle families, agent state, event payloads (PLAN §8).
// Agents are kinematic (lane s, lateral offset, speed) — deliberately NOT
// physics bodies: perf, legibility, and the fairness invariant all depend on
// traffic being predictable. Collision impulse turns them into KNOCKED
// ballistics (velocity + spin), which CAN secondary-hit other agents.

export type TrafficState =
  | 'CRUISE'
  | 'FOLLOW'
  | 'CHANGE_LANE'
  | 'PANIC'
  | 'KNOCKED';

export interface FamilyDef {
  id: string;
  /** OBB half-extents, m: [halfWidth, halfLength] */
  halfW: number;
  halfL: number;
  /** desired-speed band, m/s */
  vMin: number;
  vMax: number;
  /** IDM-lite parameters */
  aMax: number; // m/s²
  bComfort: number; // m/s²
  headwayT: number; // s
  s0: number; // standstill gap, m
  /** how eager to change lanes, 0..1 */
  laneChangeEagerness: number;
  /** relative mass for collision response (vs player car ~1) */
  massRatio: number;
}

/** Seven families with distinct sizes, speeds and habits (PLAN §8). */
export const FAMILIES: readonly FamilyDef[] = [
  { id: 'compact', halfW: 0.85, halfL: 1.9, vMin: 25, vMax: 31, aMax: 1.8, bComfort: 2.2, headwayT: 1.4, s0: 2.2, laneChangeEagerness: 0.5, massRatio: 0.7 },
  { id: 'sedan', halfW: 0.92, halfL: 2.3, vMin: 24, vMax: 30, aMax: 1.6, bComfort: 2.2, headwayT: 1.5, s0: 2.4, laneChangeEagerness: 0.45, massRatio: 1.0 },
  { id: 'sports', halfW: 0.95, halfL: 2.2, vMin: 28, vMax: 36, aMax: 2.4, bComfort: 2.6, headwayT: 1.2, s0: 2.2, laneChangeEagerness: 0.6, massRatio: 0.9 },
  { id: 'suv', halfW: 1.02, halfL: 2.5, vMin: 24, vMax: 29, aMax: 1.4, bComfort: 2.0, headwayT: 1.6, s0: 2.6, laneChangeEagerness: 0.35, massRatio: 1.3 },
  { id: 'van', halfW: 1.05, halfL: 2.7, vMin: 22, vMax: 27, aMax: 1.2, bComfort: 1.9, headwayT: 1.7, s0: 2.8, laneChangeEagerness: 0.25, massRatio: 1.4 },
  { id: 'bus', halfW: 1.3, halfL: 6.0, vMin: 20, vMax: 25, aMax: 0.9, bComfort: 1.6, headwayT: 2.0, s0: 3.2, laneChangeEagerness: 0.08, massRatio: 2.6 },
  { id: 'truck', halfW: 1.25, halfL: 5.4, vMin: 19, vMax: 23, aMax: 0.8, bComfort: 1.5, headwayT: 2.2, s0: 3.4, laneChangeEagerness: 0.06, massRatio: 3.0 },
];

/** Pool slot: `active` agents are simulated + rendered.
 *  Primary state is ROAD-frame (M4): s (arclength, +forward), lat (lateral
 *  offset, +right), dir (+1 same as player, −1 oncoming). World x/z/heading
 *  are derived from the spine each tick (collision + rendering read them);
 *  KNOCKED agents switch to pure world ballistics. */
export interface TrafficAgent {
  active: boolean;
  id: number;
  family: number;
  paint: number;
  /** road frame */
  s: number;
  lat: number;
  dir: 1 | -1;
  /** derived world pose (z decreases with travel — same convention as the player) */
  x: number;
  z: number;
  heading: number; // rad; 0 = travelling −z; spins when KNOCKED
  /** world displacement this tick (relative-sweep bookkeeping, M4) */
  mdx: number;
  mdz: number;
  speed: number; // m/s along the travel direction (always ≥ 0)
  desiredSpeed: number;
  state: TrafficState;
  lane: number;
  laneFrom: number;
  laneTo: number;
  lanePhase: number; // 0..1 lateral lerp progress
  signal: -1 | 0 | 1; // blinker before/during a change
  signalTimer: number;
  changeTimer: number;
  // knocked ballistic state
  kvx: number;
  kvz: number;
  kspin: number;
  knockedTimer: number;
  chainDepth: number;
  // near-miss tracking (per encounter; one score per agent, PLAN §11.1)
  nmTracked: boolean;
  nmMinClearance: number;
  nmWasAhead: boolean;
  // clean-pass tracking (one per encounter; arm() resets)
  passCounted: boolean;
  hadContact: boolean;
}

export interface PassEvent {
  agentId: number;
  closingSpeed: number;
  oncoming: boolean;
}

export type NearMissTier = 'INCHES' | 'VERY_CLOSE' | 'NEAR';

export interface NearMissEvent {
  agentId: number;
  tier: NearMissTier;
  /** swept minimum body-to-body clearance, m */
  clearance: number;
  closingSpeed: number; // m/s
  oncoming: boolean;
}

export interface CrashEvent {
  agentId: number;
  /** impulse magnitude along the contact normal, m/s (per player-mass) */
  impulse: number;
  headOn: boolean;
}

export interface TrafficConfig {
  laneCount: number;
  laneWidth: number;
  /** vehicles per km per lane (difficulty director ramps this in M7) */
  densityPerKmPerLane: number;
  /** spawn window ahead of the player, m */
  spawnAheadMin: number;
  spawnAheadMax: number;
  despawnBehind: number;
  maxAgents: number;
  seed: number;
}

export const DEFAULT_TRAFFIC_CONFIG: TrafficConfig = {
  laneCount: 4,
  laneWidth: 6,
  // EASY (ADR-008): relaxed density — the difficulty director nudges this
  // live, gently, and never escalates toward a kill pace
  densityPerKmPerLane: 6.5,
  spawnAheadMin: 320,
  spawnAheadMax: 470,
  despawnBehind: 80,
  maxAgents: 48,
  seed: 12345,
};
