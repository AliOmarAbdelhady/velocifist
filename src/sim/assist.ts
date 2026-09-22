// Forward collision mitigation (M7, "very easy" directive — extends
// ADR-008): watches agents in the player's path and blends in a gentle
// auto-brake when time-to-collision shrinks. It never steers and never
// slams: deliberate weaving (steering away) relieves it, and the player's
// own harder braking always wins. Oncoming traffic still bites — you can
// opt into risk — but the assist buys you a long, calm warning first.

import type { Car } from './car';
import type { DriverIntent } from './intent';
import { FAMILIES, type TrafficAgent } from './trafficTypes';

export interface AssistParams {
  /** TTC (s) at which the assist starts braking */
  ttcBrake: number;
  /** TTC (s) at which the assist reaches full strength */
  ttcFull: number;
  /** brake cap — the assist coaxes, the player decides */
  maxBrake: number;
  /** lateral overlap window beyond the body widths (m) */
  latMargin: number;
  /** how far ahead to scan (m) */
  scanAheadM: number;
  /** |steer| above this, directed away from the threat, relieves the assist */
  steerReliefThreshold: number;
  /** below this speed the assist is off (parking / creep) */
  minSpeed: number;
}

export const DEFAULT_ASSIST: AssistParams = {
  ttcBrake: 1.9,
  ttcFull: 0.6,
  maxBrake: 0.7,
  latMargin: 0.9,
  scanAheadM: 140,
  steerReliefThreshold: 0.3,
  minSpeed: 8,
};

export interface AssistView {
  /** 0..1 brake the assist wants to apply this step */
  brake: number;
  /** seconds to collision with the worst threat (Infinity when clear) */
  ttc: number;
}

/** Compute into `out` (per-step sim code passes a preallocated view). */
export function forwardAssist(
  car: Car,
  intent: DriverIntent,
  agents: readonly TrafficAgent[],
  playerS: number,
  playerLat: number,
  params: AssistParams = DEFAULT_ASSIST,
  out: AssistView = { brake: 0, ttc: Infinity },
): AssistView {
  out.brake = 0;
  out.ttc = Infinity;
  const u = car.u;
  if (u < params.minSpeed) return out;

  const pHalfW = car.tune.bodyDims[0] / 2;
  let worst = 0;

  for (const a of agents) {
    if (!a.active) continue;
    // road frame: ahead ⇔ larger s; both directions of travel use s ascending
    const gap = a.s - playerS;
    if (gap <= 0 || gap > params.scanAheadM) continue;

    const fam = FAMILIES[a.family];
    const latOverlap =
      params.latMargin + fam.halfW + pHalfW - Math.abs(a.lat - playerLat);
    if (latOverlap <= 0) continue;

    const closing = u - a.dir * a.speed;
    if (closing < 2) continue;

    const ttc = gap / closing;
    if (ttc > params.ttcBrake) continue;

    // proximity ramp: full strength at ttcFull, zero at ttcBrake
    let level = (params.ttcBrake - ttc) / (params.ttcBrake - params.ttcFull);
    level = level < 0 ? 0 : level > 1 ? 1 : level;

    // lateral forgiveness: shaving the edge of the corridor brakes less
    const softOverlap = Math.min(1, latOverlap / (fam.halfW + pHalfW));
    level *= 0.35 + 0.65 * softOverlap;

    // deliberate evasion relieves the assist — weaving stays fun. A
    // dead-centre threat is relieved by steering EITHER way.
    const threatSide = Math.sign(a.lat - playerLat);
    const steerSide = Math.sign(intent.steer);
    if (
      Math.abs(intent.steer) > params.steerReliefThreshold &&
      (threatSide === 0 || steerSide === threatSide)
    ) {
      level *= 0.35;
    }

    if (level > worst) {
      worst = level;
      out.ttc = ttc;
    }
  }

  out.brake = Math.min(params.maxBrake, worst);
  return out;
}

/** Blend the assist into a driver intent (pure — returns the same object). */
export function applyAssist(
  intent: DriverIntent,
  assist: AssistView,
): DriverIntent {
  if (assist.brake <= 0.02) return intent;
  if (assist.brake > intent.brake) intent.brake = assist.brake;
  // a strong assist also eases off the gas so the brake actually bites
  if (assist.brake > 0.45) intent.throttle = Math.min(intent.throttle, 1 - assist.brake);
  return intent;
}
