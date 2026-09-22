// Hand-tracking Web Worker: owns MediaPipe HandLandmarker (GPU delegate with
// CPU fallback) and runs inference on downscaled frames sent from the main
// thread. Fully decoupled: inference stalls never stall the render loop.
// Frames are single-flight (main thread skips while a frame is in flight) so
// latency cannot accumulate a backlog.
//
// Asset loading: wasm glue/binary and the model go through Vite's asset
// pipeline (`?url` imports from node_modules / src) — NOT from /public. Vite's
// dev server refuses to module-import public/ files, which is exactly how
// MediaPipe loads its wasm glue (PILL 034).

import { HandLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import modelUrl from '../assets/models/hand_landmarker.task?url';

const W = 320;
const H = 240;

const post = (msg: unknown, transfer?: Transferable[]): void => {
  (self as unknown as { postMessage(m: unknown, t?: Transferable[]): void }).postMessage(msg, transfer);
};

const canvas = new OffscreenCanvas(W, H);
const ctx = canvas.getContext('2d')!;
let landmarker: HandLandmarker | null = null;
let inFlight = false;

async function createLandmarker(): Promise<'GPU' | 'CPU'> {
  // hand-built WasmFileset (FilesetResolver is just a path-join helper; we
  // already have pipeline-resolved URLs)
  const fileset = { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl };
  const make = (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  try {
    landmarker = await make('GPU');
    return 'GPU';
  } catch {
    landmarker = await make('CPU');
    return 'CPU';
  }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: 'init' } | { type: 'frame'; ts: number; bitmap: ImageBitmap };

  if (msg.type === 'init') {
    try {
      const delegate = await createLandmarker();
      post({ type: 'ready', delegate });
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (msg.type === 'frame') {
    if (!landmarker || inFlight) {
      msg.bitmap.close();
      return;
    }
    inFlight = true;
    try {
      ctx.drawImage(msg.bitmap, 0, 0, W, H);
      msg.bitmap.close();
      const result = landmarker.detectForVideo(canvas, msg.ts);
      const n = result.landmarks.length;
      const data = new Float32Array(n * 63);
      const labels = new Int8Array(n);
      const scores = new Float32Array(n);
      for (let h = 0; h < n; h++) {
        const lm = result.landmarks[h];
        for (let i = 0; i < 21; i++) {
          data[h * 63 + i * 3] = lm[i].x;
          data[h * 63 + i * 3 + 1] = lm[i].y;
          data[h * 63 + i * 3 + 2] = lm[i].z;
        }
        const cat = result.handedness[h]?.[0];
        labels[h] = cat?.categoryName === 'Left' ? 0 : 1;
        scores[h] = cat?.score ?? 0.9;
      }
      post(
        { type: 'hands', ts: msg.ts, count: n, data, labels, scores },
        [data.buffer, labels.buffer, scores.buffer],
      );
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      inFlight = false;
    }
  }
};
