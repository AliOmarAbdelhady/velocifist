// Crossing-safe hand identity tracker (PLAN §5.3, PILL 006).
//
// MediaPipe's handedness labels flip when hands overlap (known issue #4785),
// and our flagship gesture IS crossing the right hand over the left. So we run
// our own 2-track tracker: constant-velocity prediction + nearest-neighbor
// assignment. Handedness labels are used ONLY for the initial lock-on, never
// again. Pure module, no allocations in update() beyond what TS can't avoid.

import { FLOATS_PER_HAND, type RawHand, type TrackedHand } from './handTypes';

export interface HandPair {
  left: TrackedHand | null;
  right: TrackedHand | null;
  /** overall tracking confidence 0..1 (assignment quality × recency) */
  confidence: number;
}

interface Track {
  x: number;
  y: number;
  vx: number;
  vy: number;
  data: Float32Array | null;
  lastSeen: number; // seconds timestamp of last update
  hits: number;
}

const GATE = 0.30; // normalized units; beyond this an assignment is suspicious
const PREDICT_CAP = 0.25;

export class HandIdentityTracker {
  private readonly tracks: [Track, Track]; // [0] = LEFT identity, [1] = RIGHT
  private locked = false;
  private tPrev = -1;

  constructor() {
    const blank = (): Track => ({
      x: 0, y: 0, vx: 0, vy: 0, data: null, lastSeen: -1e9, hits: 0,
    });
    this.tracks = [blank(), blank()];
  }

  reset(): void {
    this.locked = false;
    for (const tr of this.tracks) {
      tr.data = null;
      tr.lastSeen = -1e9;
      tr.vx = 0;
      tr.vy = 0;
      tr.hits = 0;
    }
  }

  /** Swap the two identities (physical-side correction; label ambiguity kill). */
  swap(): void {
    const t = this.tracks[0];
    this.tracks[0] = this.tracks[1];
    this.tracks[1] = t;
  }

  /**
   * @param hands raw detections for one frame (already mirrored by the caller)
   * @param t seconds timestamp
   */
  update(hands: RawHand[], t: number): HandPair {
    const dt = this.tPrev < 0 ? 0.033 : Math.min(0.2, Math.max(1e-3, t - this.tPrev));
    this.tPrev = t;

    // initial lock-on: need two hands with distinct handedness labels.
    // Seeds the identities, then falls through so this frame already resolves.
    if (!this.locked) {
      if (hands.length === 2 && hands[0].label !== hands[1].label) {
        const lh = hands[0].label === 0 ? hands[0] : hands[1];
        const rh = hands[0].label === 1 ? hands[0] : hands[1];
        this.seed(0, lh, t);
        this.seed(1, rh, t);
        this.locked = true;
      } else {
        return { left: null, right: null, confidence: 0 };
      }
    }

    // predict both track positions
    const px: number[] = [0, 0];
    const py: number[] = [0, 0];
    for (let i = 0; i < 2; i++) {
      const tr = this.tracks[i];
      const age = t - tr.lastSeen;
      const lead = Math.min(age, 0.4);
      px[i] = tr.x + Math.max(-PREDICT_CAP, Math.min(PREDICT_CAP, tr.vx)) * lead;
      py[i] = tr.y + Math.max(-PREDICT_CAP, Math.min(PREDICT_CAP, tr.vy)) * lead;
    }

    // assign detections to tracks by nearest predicted position.
    // With ≤2 detections × 2 tracks we enumerate the (≤2) matchings directly.
    let assign: number[] = []; // detection index → track index
    let cost = Infinity;
    if (hands.length === 2) {
      const c00 = dist2(hands[0], px[0], py[0]) + dist2(hands[1], px[1], py[1]);
      const c01 = dist2(hands[0], px[1], py[1]) + dist2(hands[1], px[0], py[0]);
      if (c00 <= c01) { assign = [0, 1]; cost = c00; }
      else { assign = [1, 0]; cost = c01; }
    } else if (hands.length === 1) {
      const c0 = dist2(hands[0], px[0], py[0]);
      const c1 = dist2(hands[0], px[1], py[1]);
      assign = c0 <= c1 ? [0] : [1];
      cost = Math.min(c0, c1);
    }

    let worst = 0;
    for (let d = 0; d < hands.length; d++) {
      const ti = assign[d];
      const tr = this.tracks[ti];
      const hand = hands[d];
      const x = hand.data[0];
      const y = hand.data[1];
      const jump2 = dist2(hand, tr.x, tr.y);
      // velocity update (smoothed)
      const nvx = (x - tr.x) / dt;
      const nvy = (y - tr.y) / dt;
      if (tr.lastSeen > -1e8) {
        tr.vx = tr.vx * 0.6 + nvx * 0.4;
        tr.vy = tr.vy * 0.6 + nvy * 0.4;
      }
      tr.x = x;
      tr.y = y;
      tr.data = hand.data;
      tr.lastSeen = t;
      tr.hits++;
      // per-assignment quality: gate on jump distance (teleports = suspicious)
      const q = Math.max(0, 1 - Math.sqrt(jump2) / GATE);
      worst = Math.max(worst, 1 - q);
    }

    const conf =
      (1 - Math.min(1, worst)) *
      (Math.sqrt(cost) > GATE * 1.5 ? 0.3 : 1) *
      (hands.length === 0 ? 0 : hands.length === 1 ? 0.75 : 1);

    const left = this.fresh(0, t) ? { data: this.tracks[0].data as Float32Array, confidence: conf } : null;
    const right = this.fresh(1, t) ? { data: this.tracks[1].data as Float32Array, confidence: conf } : null;
    return { left, right, confidence: conf };
  }

  get isLocked(): boolean {
    return this.locked;
  }

  private fresh(i: number, t: number): boolean {
    const tr = this.tracks[i];
    return tr.data !== null && t - tr.lastSeen < 0.15 && tr.hits >= 1;
  }

  private seed(i: number, hand: RawHand, t: number): void {
    const tr = this.tracks[i];
    tr.x = hand.data[0];
    tr.y = hand.data[1];
    tr.vx = 0;
    tr.vy = 0;
    tr.data = hand.data;
    tr.lastSeen = t;
    tr.hits = 1;
  }
}

function dist2(hand: RawHand, x: number, y: number): number {
  const dx = hand.data[0] - x;
  const dy = hand.data[1] - y;
  return dx * dx + dy * dy;
}

export const _FLOATS_PER_HAND = FLOATS_PER_HAND;
