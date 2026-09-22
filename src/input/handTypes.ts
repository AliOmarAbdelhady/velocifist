// Shared hand-tracking types between the worker, the tracker and the solver.
// Landmark layout: MediaPipe's 21 points, flat [x,y,z]×21 Float32Array,
// normalized image coords (x right, y down, origin top-left), NOT yet mirrored.
// Landmark indices: 0 wrist · 4 thumb tip · 5/9/13/17 MCPs · 6/10/14/18 PIPs
// · 8/12/16/20 fingertips.

export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
} as const;

export const LANDMARKS_PER_HAND = 21;
export const FLOATS_PER_HAND = 63;

/** 0 = "Left" label, 1 = "Right" label (MediaPipe handedness, mirrored view). */
export type HandLabel = 0 | 1;

export interface RawHand {
  data: Float32Array; // 63 floats
  label: HandLabel;
  score: number;
}

export interface TrackedHand {
  data: Float32Array;
  /** identity confidence for this assignment, 0..1 */
  confidence: number;
}

/** Worker → main message payloads. */
export type TrackerMessage =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'status'; message: string }
  | { type: 'error'; message: string }
  | {
      type: 'hands';
      ts: number; // performance.now() stamped at capture
      count: number;
      data: Float32Array; // count × 63
      labels: Int8Array; // count
      scores: Float32Array; // count
    };
