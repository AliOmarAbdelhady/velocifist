// RoadSystem (PLAN §10.1, M4): the world spine. A seeded, chunk-streamed
// curved road in WORLD space — the player's physics stays honest (real
// steering, real lateral g through bends) while traffic runs in ROAD space
// (s = arclength, lat = lateral offset, dir = travel direction) and is mapped
// onto the spine for collision/rendering. Pure sim: no DOM/Three.
//
// Frame conventions (extends PILL 009):
//   s   arclength from start; increases in the player's travel direction.
//   lat lateral offset from the spine centre; +lat = road-right (world +x at
//       heading 0). Lane 0 is the LEFTMOST lane (most negative lat).
//   dir +1 = same direction as the player, −1 = oncoming.
//   "ahead" (larger s) ⇔ smaller world z. Spine z is strictly decreasing.
//
// Chunks are 256 m, integrated at 4 m (RK2 on heading κ(s), gentle modules
// only: |Δθ| ≤ 0.26 rad/chunk ⇒ R ≥ ~740 m at the peak — always drivable at
// highway speed, never a hairpin, per PLAN "no vMax hairpins").
//
// A z-rebase (floating origin) shifts the whole world by +4096 m whenever the
// player's raw z passes −4096, keeping float32 render precision healthy on
// 20+ km runs. It is a pure translation: exact, deterministic, invisible.

import { hashRng } from './rng';

export const CHUNK_LEN = 256;
export const SAMPLE_STEP = 4;
const SAMPLES_PER_CHUNK = CHUNK_LEN / SAMPLE_STEP; // 64 intervals, 65 stored

/** Max |Δheading| per chunk — keeps peak curvature ≥ ~740 m radius. */
const MAX_DTHETA = 0.26;

export interface SpinePoint {
  x: number;
  z: number;
  heading: number;
}

export interface Projection {
  s: number;
  lat: number;
}

/** The slice of road geometry the vehicle sim needs (implemented by RoadSystem). */
export interface RoadGuide {
  project(x: number, z: number, out: Projection): void;
  sample(s: number, out: SpinePoint): void;
}

export type ThemeId = 'coastal' | 'neon' | 'desert';

export type ChunkModule = 'STRAIGHT' | 'ARC' | 'SEE_S' | 'SEE_S_MIRROR';

export interface ChunkFeature {
  module: ChunkModule;
  /** signed heading change over the chunk, rad */
  dTheta: number;
  /** cumulative spine heading at the END of the chunk, rad (chain state —
   *  makes features order-independent and fully determined by the seed) */
  hEnd: number;
  /** number of left-side oncoming lanes in this chunk (0 or laneCount/2) */
  oncomingLanes: number;
  construction: boolean;
}

/** What the difficulty director may modulate per theme (M7 ramps these). */
export interface FeaturePolicy {
  /** probability a chunk is an oncoming (×2 score) zone — neon only, > 0 to enable */
  oncomingP: number;
  /** probability a chunk is a construction zone */
  constructionP: number;
  /** curvature appetite multiplier (desert > coastal) */
  curveBias: number;
}

export const THEME_POLICIES: Record<ThemeId, FeaturePolicy> = {
  coastal: { oncomingP: 0, constructionP: 0.1, curveBias: 1.0 },
  neon: { oncomingP: 0.55, constructionP: 0.06, curveBias: 1.05 },
  desert: { oncomingP: 0, constructionP: 0.12, curveBias: 1.3 },
};

interface ChunkData {
  sx: Float32Array;
  sz: Float32Array;
  sh: Float32Array;
  feature: ChunkFeature;
}

export interface RoadOpts {
  seed?: number;
  theme?: ThemeId;
  laneCount?: number;
  laneWidth?: number;
  policy?: FeaturePolicy;
  /** dead-straight featureless road (tests, M3 parity) */
  flat?: boolean;
}

const REBASE_AT = -4096;
const REBASE_DZ = 4096;

export class RoadSystem implements RoadGuide {
  readonly theme: ThemeId;
  readonly laneCount: number;
  readonly laneWidth: number;
  readonly seed: number;
  private readonly policy: FeaturePolicy;
  private readonly flat: boolean;

  private readonly chunks = new Map<number, ChunkData>();
  private genChunk = 0; // next chunk index to generate
  private curX = 0;
  private curZ = 0;
  private curH = 0;

  private projHint = 0;
  private zShift = 0;

  /** perf probes (dev HUD / M4 gate: chunk build ≤ 2 ms) */
  lastBuildMs = 0;
  maxBuildMs = 0;

  constructor(opts: RoadOpts = {}) {
    this.seed = opts.seed ?? 1;
    this.theme = opts.theme ?? 'coastal';
    this.laneCount = opts.laneCount ?? 4;
    this.laneWidth = opts.laneWidth ?? 6;
    this.policy = opts.policy ?? THEME_POLICIES[this.theme];
    this.flat = opts.flat ?? false;
  }

  /** Straight featureless road: s = −z, lat = x (M3 identity behaviour). */
  static straight(laneCount = 4, laneWidth = 6): RoadSystem {
    return new RoadSystem({ flat: true, laneCount, laneWidth, seed: 1 });
  }

  get roadHalf(): number {
    return (this.laneCount * this.laneWidth) / 2;
  }

  laneLat(lane: number): number {
    return (lane - (this.laneCount - 1) / 2) * this.laneWidth;
  }

  /** Number of oncoming lanes active at arclength s (0 or laneCount/2). */
  oncomingAt(s: number): number {
    return this.chunkFeature(Math.max(0, Math.floor(s / CHUNK_LEN))).oncomingLanes;
  }

  /** Is this lane closed by a construction zone at s? */
  laneBlocked(s: number, lane: number): boolean {
    const i = Math.max(0, Math.floor(s / CHUNK_LEN));
    return this.chunkFeature(i).construction && this.blockedLaneOf(i) === lane;
  }

  /** Which lane the construction zone of chunk i closes (a same-dir edge lane). */
  blockedLaneOf(i: number): number {
    const onc = this.chunkFeature(i).oncomingLanes;
    return hashRng(i, this.seed ^ 0x1357) < 0.5 ? onc : this.laneCount - 1;
  }

  chunkFeature(i: number): ChunkFeature {
    if (this.flat || i < 0) return FLAT_FEATURE;
    const cached = this.features.get(i);
    if (cached) return cached;
    // compute the chain [3..i] bottom-up so every feature sees its
    // predecessor — features are pure functions of (seed, policy, i)
    let j = i;
    const stack: number[] = [];
    while (j >= 3 && !this.features.has(j)) {
      stack.push(j);
      j--;
    }
    while (stack.length > 0) {
      const k = stack.pop()!;
      this.features.set(k, this.computeFeature(k));
    }
    return this.features.get(i) ?? FLAT_FEATURE;
  }

  private readonly features = new Map<number, ChunkFeature>();

  private computeFeature(i: number): ChunkFeature {
    if (i < 3) {
      // launch pad: calm, featureless
      return { module: 'STRAIGHT', dTheta: 0, hEnd: 0, oncomingLanes: 0, construction: false };
    }
    const prev = this.features.get(i - 1) ?? null;
    const baseH = prev ? prev.hEnd : 0;
    // corrective bias: past ±0.5 rad of cumulative heading the next bend is
    // forced the other way, keeping |heading| < ~0.76 rad and world z strictly
    // decreasing (the projection and −z heuristics rely on it)
    const bias = Math.abs(baseH) > 0.5 ? (baseH > 0 ? -1 : 1) : 0;

    // --- module ---
    let module: ChunkModule;
    let dTheta = 0;
    const rMod = hashRng(i, this.seed ^ 0x9e37);
    const rMag = hashRng(i, this.seed ^ 0x51ab);
    let rDir = hashRng(i, this.seed ^ 0x7f4a) < 0.5 ? 1 : -1;
    if (bias !== 0) rDir = bias; // corrective steer back toward heading 0
    const pArc = Math.min(0.62, 0.5 * this.policy.curveBias);
    if (prev && prev.module === 'SEE_S') {
      module = 'SEE_S_MIRROR';
      dTheta = -prev.dTheta;
    } else if (rMod < pArc) {
      module = 'ARC';
      dTheta = rDir * (0.1 + rMag * 0.16) * this.policy.curveBias;
    } else if (rMod < pArc + 0.18) {
      module = 'SEE_S';
      dTheta = rDir * (0.14 + rMag * 0.12) * this.policy.curveBias;
    } else {
      module = 'STRAIGHT';
    }
    dTheta = Math.max(-MAX_DTHETA, Math.min(MAX_DTHETA, dTheta));

    // --- oncoming zones (with run hysteresis so zones don't flicker) ---
    let oncomingLanes = 0;
    if (i >= 4 && this.policy.oncomingP > 0 && this.laneCount >= 4) {
      const prevOnc = prev ? prev.oncomingLanes : 0;
      const r = hashRng(i, this.seed ^ 0x2c9f);
      const stay = prevOnc > 0 && r < Math.max(0.65, this.policy.oncomingP);
      if (stay || (!prevOnc && r < this.policy.oncomingP)) {
        oncomingLanes = this.laneCount / 2;
      }
    }

    // --- construction (never inside an oncoming zone, never back-to-back) ---
    let construction = false;
    if (
      oncomingLanes === 0 && i >= 4 && this.policy.constructionP > 0 &&
      !(prev && prev.construction) &&
      module !== 'SEE_S' && module !== 'SEE_S_MIRROR' &&
      hashRng(i, this.seed ^ 0x66d2) < this.policy.constructionP
    ) {
      construction = true;
    }

    return { module, dTheta, hEnd: baseH + dTheta, oncomingLanes, construction };
  }

  // ------------------------------------------------------------------ spine

  /** Curvature κ(s), rad/m at GLOBAL arclength s — ramped inside the chunk
   *  so headings join C1 across boundaries. */
  private kappa(i: number, globalS: number): number {
    const f = this.chunkFeature(i);
    if (f.dTheta === 0) return 0;
    const t = (globalS - i * CHUNK_LEN) / CHUNK_LEN;
    const r = smoothstep01(t / 0.25) * (1 - smoothstep01((t - 0.75) / 0.25));
    return (f.dTheta / (0.75 * CHUNK_LEN)) * r;
  }

  private generateChunk(): void {
    const t0 = performance.now();
    const i = this.genChunk;
    const sx = new Float32Array(SAMPLES_PER_CHUNK + 1);
    const sz = new Float32Array(SAMPLES_PER_CHUNK + 1);
    const sh = new Float32Array(SAMPLES_PER_CHUNK + 1);
    // carry the integration state across chunk boundaries (C0 + C1 continuous)
    let x = this.curX;
    let z = this.curZ;
    let h = this.curH;
    let s = i * CHUNK_LEN;
    for (let j = 0; j <= SAMPLES_PER_CHUNK; j++) {
      sx[j] = x;
      sz[j] = z;
      sh[j] = h;
      if (j === SAMPLES_PER_CHUNK) break;
      // RK2 on (x', z') = (sin h, −cos h), h' = κ(s)
      const k1 = this.kappa(i, s);
      const hm = h + k1 * (SAMPLE_STEP / 2);
      const km = this.kappa(i, s + SAMPLE_STEP / 2);
      x += Math.sin(hm) * SAMPLE_STEP;
      z += -Math.cos(hm) * SAMPLE_STEP;
      h += km * SAMPLE_STEP;
      s += SAMPLE_STEP;
    }
    this.curX = x;
    this.curZ = z;
    this.curH = h;
    this.chunks.set(i, { sx, sz, sh, feature: this.chunkFeature(i) });
    this.genChunk = i + 1;
    this.lastBuildMs = performance.now() - t0;
    if (this.lastBuildMs > this.maxBuildMs) this.maxBuildMs = this.lastBuildMs;
  }

  /** Generate chunks until s is covered (amortised: one 256 m chunk per ~4 s). */
  ensureTo(s: number): void {
    const target = Math.max(0, Math.ceil((s + 1) / CHUNK_LEN));
    while (this.genChunk < target) this.generateChunk();
  }

  /** Spine centre at arclength s. out.z includes the rebase shift. */
  sample(s: number, out: SpinePoint): void {
    if (this.flat) {
      out.x = 0;
      out.z = -s + this.zShift;
      out.heading = 0;
      return;
    }
    if (s < 0) s = 0;
    this.ensureTo(s);
    const c = Math.min(Math.floor(s / CHUNK_LEN), this.genChunk - 1);
    const local = s - c * CHUNK_LEN;
    const j = Math.min(Math.floor(local / SAMPLE_STEP), SAMPLES_PER_CHUNK - 1);
    const f = local / SAMPLE_STEP - j;
    const d = this.chunks.get(c)!;
    out.x = d.sx[j] + (d.sx[j + 1] - d.sx[j]) * f;
    out.z = d.sz[j] + (d.sz[j + 1] - d.sz[j]) * f + this.zShift;
    out.heading = d.sh[j] + (d.sh[j + 1] - d.sh[j]) * f;
  }

  /**
   * Nearest-point projection of a world position onto the spine: descend to
   * the locally closest segment (deterministic walk around the cached hint —
   * the player moves continuously, so this is O(1) per tick); arbitrary
   * queries self-relocate once via the monotone −z estimate.
   */
  project(x: number, z: number, out: Projection): void {
    if (this.flat) {
      out.s = -(z - this.zShift);
      out.lat = x;
      return;
    }
    let hint = this.projHint;
    let jumped = false;
    let i = Math.max(0, Math.floor(hint / SAMPLE_STEP));
    this.ensureTo((i + 2) * SAMPLE_STEP + CHUNK_LEN);
    this.segEval(i, x, z);
    let bt = this.seg.t;
    let bd2 = this.seg.d2;
    let blat = this.seg.lat;
    for (let iter = 0; iter < 1024; iter++) {
      if (iter === 192 && !jumped) {
        // far query — relocate the hint by the (monotone) z estimate
        jumped = true;
        i = Math.max(0, Math.floor((-(z - this.zShift)) / SAMPLE_STEP));
        this.ensureTo((i + 2) * SAMPLE_STEP + CHUNK_LEN);
        this.segEval(i, x, z);
        bt = this.seg.t;
        bd2 = this.seg.d2;
        blat = this.seg.lat;
      }
      // the walk can outrun the generated frontier — grow it on demand
      if (i + 2 >= this.genChunk * SAMPLES_PER_CHUNK) {
        this.ensureTo((i + 3) * SAMPLE_STEP + CHUNK_LEN);
      }
      const maxSeg = this.genChunk * SAMPLES_PER_CHUNK - 1;
      if (i + 1 < maxSeg) {
        this.segEval(i + 1, x, z);
        if (this.seg.d2 < bd2) {
          i++;
          bt = this.seg.t;
          bd2 = this.seg.d2;
          blat = this.seg.lat;
          continue;
        }
      }
      if (i > 0) {
        this.segEval(i - 1, x, z);
        if (this.seg.d2 < bd2) {
          i--;
          bt = this.seg.t;
          bd2 = this.seg.d2;
          blat = this.seg.lat;
          continue;
        }
      }
      break;
    }
    out.s = (i + bt) * SAMPLE_STEP;
    out.lat = blat;
    this.projHint = out.s;
  }

  private readonly seg = { t: 0, d2: 0, lat: 0 };

  /** clamped foot + squared distance + road-frame lat for segment i (reused out) */
  private segEval(i: number, x: number, z: number): void {
    const cA = Math.floor((i * SAMPLE_STEP) / CHUNK_LEN);
    const dA = this.chunks.get(cA)!;
    const jA = i - cA * SAMPLES_PER_CHUNK;
    const cB = Math.floor(((i + 1) * SAMPLE_STEP) / CHUNK_LEN);
    const dB = this.chunks.get(cB)!;
    const jB = i + 1 - cB * SAMPLES_PER_CHUNK;
    const p0x = dA.sx[jA];
    const p0z = dA.sz[jA] + this.zShift;
    const p1x = dB.sx[jB];
    const p1z = dB.sz[jB] + this.zShift;
    const dx = p1x - p0x;
    const dz = p1z - p0z;
    const len2 = dx * dx + dz * dz;
    let t = ((x - p0x) * dx + (z - p0z) * dz) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const fx = p0x + dx * t;
    const fz = p0z + dz * t;
    const ex = x - fx;
    const ez = z - fz;
    const hh = dA.sh[jA] + (dB.sh[jB] - dA.sh[jA]) * t;
    this.seg.t = t;
    this.seg.d2 = ex * ex + ez * ez;
    this.seg.lat = ex * Math.cos(hh) + ez * Math.sin(hh);
  }

  // ------------------------------------------------------------------ rebase

  /**
   * Floating origin: when raw player z has run past −4096, shift the world
   * +4096 in z (pure translation — s/lat unaffected). Returns the dz applied
   * so the caller can shift car/pose/traffic-remnants; 0 otherwise.
   */
  maybeRebase(rawPlayerZ: number): number {
    if (this.flat || rawPlayerZ >= REBASE_AT) return 0;
    this.zShift += REBASE_DZ;
    return REBASE_DZ;
  }

  get worldZShift(): number {
    return this.zShift;
  }

  // ------------------------------------------------------------------ misc

  /** Determinism probe over generated chunks (sparse for speed). */
  hash(): string {
    let h = 0x811c9dc5;
    const buf = new Float64Array(1);
    const view = new DataView(buf.buffer);
    for (let c = 0; c < this.genChunk; c++) {
      const d = this.chunks.get(c)!;
      for (let j = 0; j <= SAMPLES_PER_CHUNK; j += 8) {
        for (const v of [d.sx[j], d.sz[j], d.sh[j]]) {
          buf[0] = v;
          for (let b = 0; b < 8; b++) {
            h ^= view.getUint8(b);
            h = Math.imul(h, 0x01000193) >>> 0;
          }
        }
      }
    }
    return h.toString(16).padStart(8, '0');
  }
}

const FLAT_FEATURE: ChunkFeature = {
  module: 'STRAIGHT',
  dTheta: 0,
  hEnd: 0,
  oncomingLanes: 0,
  construction: false,
};

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
