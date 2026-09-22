// Collision (PLAN §6.4): 2D OBB-vs-OBB SAT with swept substeps for high
// closing speeds, and an authored impulse response (no rigid-body engine).
// Pure module — narrow interfaces in, mutations out, zero allocation in the
// hot path (Contact written into a caller-owned out object).
//
// Tunneling math (why substeps): at 365 km/h closing (101 m/s) the player
// moves ~1.7 m per 60 Hz tick; a 1 m corner-clip lasts ~10 ms < one tick and
// would be missed. Sub-interpolating the player's motion at ≤0.5 m per test
// guarantees overlap windows are sampled.

export interface OBB {
  x: number;
  z: number;
  /** half width (lateral) */
  hw: number;
  /** half length (longitudinal) */
  hl: number;
  /** heading, rad (0 = facing −z) */
  h: number;
}

export interface Contact {
  /** unit normal from A toward B */
  nx: number;
  nz: number;
  depth: number;
}

const AXES = 4;

export function obbSAT(a: OBB, b: OBB, out: Contact): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let best = Infinity;
  let bnx = 0;
  let bnz = 0;

  for (let i = 0; i < AXES; i++) {
    // axis = lateral or forward of a (i<2) / of b (i>=2)
    let ax: number;
    let az: number;
    if (i === 0) {
      ax = Math.cos(a.h);
      az = Math.sin(a.h);
    } else if (i === 1) {
      ax = Math.sin(a.h);
      az = -Math.cos(a.h);
    } else if (i === 2) {
      ax = Math.cos(b.h);
      az = Math.sin(b.h);
    } else {
      ax = Math.sin(b.h);
      az = -Math.cos(b.h);
    }

    const ra =
      a.hw * Math.abs(ax * Math.cos(a.h) + az * Math.sin(a.h)) +
      a.hl * Math.abs(ax * Math.sin(a.h) - az * Math.cos(a.h));
    const rb =
      b.hw * Math.abs(ax * Math.cos(b.h) + az * Math.sin(b.h)) +
      b.hl * Math.abs(ax * Math.sin(b.h) - az * Math.cos(b.h));

    const dist = ax * dx + az * dz;
    const overlap = ra + rb - Math.abs(dist);
    if (overlap <= 0) return false;
    if (overlap < best) {
      best = overlap;
      const s = dist >= 0 ? 1 : -1;
      bnx = ax * s;
      bnz = az * s;
    }
  }
  out.nx = bnx;
  out.nz = bnz;
  out.depth = best;
  return true;
}

/** Player's swept path vs an agent: sub-interpolated SAT tests, ≤0.5 m each. */
export function sweptPlayerSAT(
  prevX: number,
  prevZ: number,
  curX: number,
  curZ: number,
  pHw: number,
  pHl: number,
  pH: number,
  agent: OBB,
  out: Contact,
): boolean {
  const dist = Math.hypot(curX - prevX, curZ - prevZ);
  const n = Math.min(4, Math.max(1, Math.ceil(dist / 0.5)));
  const player: OBB = { x: 0, z: 0, hw: pHw, hl: pHl, h: pH };
  for (let i = 1; i <= n; i++) {
    const t = i === n ? 1 : i / n;
    player.x = prevX + (curX - prevX) * t;
    player.z = prevZ + (curZ - prevZ) * t;
    if (obbSAT(player, agent, out)) return true;
  }
  return false;
}

export interface PlayerBody {
  x: number;
  z: number;
  heading: number;
  u: number;
  w: number;
  omega: number;
  halfW: number;
  halfL: number;
  iz: number;
}

export interface AgentBody {
  x: number;
  z: number;
  heading: number;
  speed: number;
  kvx: number;
  kvz: number;
  kspin: number;
}

const RESTITUTION = 0.25;

/**
 * Authored impulse response. `nx/nz` point from the AGENT toward the PLAYER.
 * Mutates the player's velocities (u/w/omega) and arms the agent's knocked
 * ballistic state. Returns the closing speed along the normal (damage proxy).
 */
export function resolveHit(
  p: PlayerBody,
  a: AgentBody,
  massRatio: number,
  nx: number,
  nz: number,
): number {
  const fx = Math.sin(p.heading);
  const fz = -Math.cos(p.heading);
  const rx = Math.cos(p.heading);
  const rz = Math.sin(p.heading);

  // world velocities
  let pvx = fx * p.u + rx * p.w;
  let pvz = fz * p.u + rz * p.w;
  const avx = a.kspin !== 0 || a.kvx !== 0 || a.kvz !== 0 ? a.kvx : 0;
  const avz = a.kspin !== 0 || a.kvx !== 0 || a.kvz !== 0 ? a.kvz : -a.speed;

  const rvx = pvx - avx;
  const rvz = pvz - avz;
  const vn = rvx * nx + rvz * nz; // < 0 = approaching
  if (vn >= 0) return 0;

  const closing = -vn;
  const share = massRatio / (1 + massRatio); // how much the player feels

  // normal impulse (with restitution)
  const jn = (1 + RESTITUTION) * closing * share;
  pvx += nx * jn;
  pvz += nz * jn;

  // tangential scrub (glancing hits slide, they don't stick)
  const tx = rvx - nx * vn;
  const tz = rvz - nz * vn;
  pvx -= tx * 0.15 * share;
  pvz -= tz * 0.15 * share;

  // yaw kick from the contact arm (agent offset in player frame)
  const dx = a.x - p.x;
  const dz = a.z - p.z;
  const armR = dx * rx + dz * rz; // lateral arm
  const armF = dx * fx + dz * fz; // longitudinal arm
  const fComp = nx * fx + nz * fz; // normal vs forward
  const rComp = nx * rx + nz * rz;
  // arcade yaw gain: physically r×J/Iz is imperceptible at game scale —
  // side/corner hits should visibly rotate the car (PLAN §6.4 "yaw kick")
  p.omega += (armR * fComp - armF * rComp) * jn * 0.018;
  p.omega = Math.max(-2.5, Math.min(2.5, p.omega));

  // back to body frame
  p.u = pvx * fx + pvz * fz;
  p.w = pvx * rx + pvz * rz;
  if (p.u < 0) p.u = 0;

  // agent becomes ballistic: momentum-ish transfer + spin
  const push = (jn * 1.2) / (1 + massRatio * 0.5);
  a.kvx = avx + nx * push * -1; // pushed along −n (away from the player)
  a.kvz = avz - nz * push;
  const spinDir = armR > 0 ? -1 : 1;
  a.kspin = spinDir * Math.min(2.5, 0.6 + 0.12 * closing);
  return closing;
}
