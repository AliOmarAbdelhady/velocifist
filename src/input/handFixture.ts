// Synthetic hand landmark geometry (shared by CI fixtures and the
// ?pipdemo=1 AR demo source — no camera needed). Builds a palm-toward-camera
// hand at a given wrist position with a per-finger curl (0 = extended,
// 1 = fully folded) and thumb posture.

import type { RawHand } from './handTypes';

export interface HandSpec {
  wrist: [number, number];
  /** hand size reference (wrist→middle-MCP distance), normalized units */
  scale?: number;
  /** curl for index/middle/ring/pinky, 0..1 */
  curl?: number;
  /** thumb tucked across the palm (fist) or out to the side (open) */
  thumbAcross?: boolean;
  label?: 0 | 1;
  score?: number;
}

const FINGERS: Array<[number, number, number]> = [
  // [MCP, PIP, TIP]
  [5, 6, 8],
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
];
const SPREAD = [-0.16, -0.05, 0.06, 0.17]; // x offsets from middle, × scale

export function makeHand(spec: HandSpec): RawHand {
  const s = spec.scale ?? 0.14;
  const curl = spec.curl ?? 0;
  const [wx, wy] = spec.wrist;
  const d = new Float32Array(63);

  const set = (lm: number, x: number, y: number): void => {
    d[lm * 3] = x;
    d[lm * 3 + 1] = y;
    d[lm * 3 + 2] = 0;
  };

  set(0, wx, wy);

  // thumb chain: CMC, MCP, IP out to the side; TIP either across (fist) or out
  set(1, wx - 0.45 * s, wy - 0.35 * s);
  set(2, wx - 0.62 * s, wy - 0.62 * s);
  set(3, wx - 0.72 * s, wy - 0.88 * s);
  if (spec.thumbAcross ?? curl > 0.7) {
    set(4, wx - 0.1 * s, wy - 1.0 * s); // tucked toward index MCP
  } else {
    set(4, wx - 0.85 * s, wy - 1.12 * s); // extended out
  }

  const fold = curl * Math.PI * 0.92; // angle at PIP
  for (let f = 0; f < 4; f++) {
    const [mcp, pip, tip] = FINGERS[f];
    const fx = wx + SPREAD[f] * s * 2.4;
    const mcpY = wy - 1.0 * s;
    set(mcp, fx, mcpY);
    const pipY = mcpY - 0.55 * s;
    set(pip, fx, pipY);
    // tip: rotate the distal segment by `fold` from straight
    const len = 0.65 * s;
    set(tip, fx + Math.sin(fold) * len * 0.4, pipY - Math.cos(fold) * len);
    // fill unused joints (CMC/DIP) with midpoints — only listed indices matter
  }
  // rough fill for joints we don't compute (1..3 done; 7,11,15,19 ≈ PIP→TIP mid)
  for (const [pip, mid, tip] of [
    [6, 7, 8],
    [10, 11, 12],
    [14, 15, 16],
    [18, 19, 20],
  ] as Array<[number, number, number]>) {
    set(
      mid,
      (d[pip * 3] + d[tip * 3]) / 2,
      (d[pip * 3 + 1] + d[tip * 3 + 1]) / 2,
    );
  }

  return { data: d, label: spec.label ?? 0, score: spec.score ?? 0.95 };
}

export function makeFist(wrist: [number, number], label: 0 | 1): RawHand {
  return makeHand({ wrist, curl: 0.95, thumbAcross: true, label, scale: 0.14 });
}

export function makeOpen(wrist: [number, number], label: 0 | 1): RawHand {
  return makeHand({ wrist, curl: 0.05, thumbAcross: false, label, scale: 0.14 });
}
