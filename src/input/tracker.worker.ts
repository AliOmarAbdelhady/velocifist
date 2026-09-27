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
import { pickDelegate } from './trackerTuning';
// NOTE: the MODULE build of the glue — the classic build ("vision_wasm_internal.js")
// assigns its factory to globals that don't exist when imported as ESM in a
// module worker → "ModuleFactory not set". Binary is shared between variants.
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import modelUrl from '../assets/models/hand_landmarker.task?url';

const post = (msg: unknown, transfer?: Transferable[]): void => {
  (self as unknown as { postMessage(m: unknown, t?: Transferable[]): void }).postMessage(msg, transfer);
};

// inference canvas — resized on the fly when the adaptive resolution changes
const canvas = new OffscreenCanvas(320, 240);
const ctx = canvas.getContext('2d')!;
let landmarker: HandLandmarker | null = null;
let inFlight = false;

async function buildFileset(): Promise<{ wasmLoaderPath: string; wasmBinaryPath: string }> {
  // Vite's dev server module-transforms any served .js — including Emscripten
  // glue — and breaks it ("importModule is not defined", swallowed as a hang
  // inside MediaPipe's init). Blob URLs never hit the server, so we fetch the
  // glue text (plain fetch is fine) and let the raw code execute untouched.
  // Works identically in dev and production. (PILL 035)
  post({ type: 'status', message: 'fetching wasm glue' });
  const res = await fetch(wasmLoaderUrl);
  if (!res.ok) throw new Error(`wasm glue fetch failed: HTTP ${res.status}`);
  const src = await res.text();
  post({ type: 'status', message: `glue fetched (${(src.length / 1024).toFixed(0)} kB) — blob` });
  const blobUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  return { wasmLoaderPath: blobUrl, wasmBinaryPath: wasmBinaryUrl };
}

async function createLandmarker(prefer: 'auto' | 'gpu' | 'cpu'): Promise<{ delegate: 'GPU' | 'CPU'; ms: number }> {
  post({ type: 'status', message: 'creating landmarker' });
  // Each instance gets a FRESH blob URL for the wasm glue: two landmarkers
  // sharing one glue module scope die with "ModuleFactory not set" (the
  // second instance finds the factory already consumed).
  const make = async (delegate: 'GPU' | 'CPU') =>
    HandLandmarker.createFromOptions(await buildFileset(), {
      baseOptions: { modelAssetPath: modelUrl, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      // sticky tracking (M7 hands pass): lower bars keep locks through
      // motion blur / partial occlusion instead of dropping outright.
      // ADR-021: CPU inference is noisier — track even stickier.
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.3,
    });

  // ADR-021: measure, don't assume. A weak GPU initializes WebGL fine and
  // then runs several times slower than the CPU; "GPU first, CPU on crash"
  // locks such machines into the slow path forever. Build + benchmark +
  // CLOSE each delegate sequentially (one wasm runtime alive at a time —
  // a transient double is exactly what a weak laptop can't afford), then
  // rebuild the winner.
  const bench = async (l: HandLandmarker): Promise<number> => {
    let ts = performance.now();
    l.detectForVideo(canvas, ts); // warm-up (JIT / wasm page-in)
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      ts = Math.max(t0, ts + 1); // detectForVideo needs monotonic stamps
      l.detectForVideo(canvas, ts);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  };

  const tryBench = async (delegate: 'GPU' | 'CPU'): Promise<number | null> => {
    try {
      const l = await make(delegate);
      const ms = await bench(l);
      l.close();
      return ms;
    } catch (err) {
      console.warn(`[ar] ${delegate} delegate unusable:`, err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  let gpuMs: number | null = null;
  let cpuMs: number | null = null;
  if (prefer === 'gpu' || prefer === 'auto') gpuMs = await tryBench('GPU');
  if (prefer === 'cpu' || prefer === 'auto' || gpuMs === null) cpuMs = await tryBench('CPU');

  const delegate =
    prefer === 'gpu' && gpuMs !== null
      ? 'GPU'
      : prefer === 'cpu' && cpuMs !== null
        ? 'CPU'
        : pickDelegate(gpuMs, cpuMs);
  const ms = delegate === 'GPU' ? gpuMs : cpuMs;
  if (ms === null) {
    throw new Error('neither GPU nor CPU delegate could be initialized');
  }

  post({ type: 'status', message: `starting ${delegate} inference` });
  landmarker = await make(delegate);
  return { delegate, ms };
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: 'init'; prefer?: 'auto' | 'gpu' | 'cpu' } | { type: 'frame'; ts: number; bitmap: ImageBitmap };

  if (msg.type === 'init') {
    try {
      const { delegate, ms } = await createLandmarker(msg.prefer ?? 'auto');
      post({ type: 'ready', delegate, ms });
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
      // ADR-021: the inference canvas follows the adaptive frame size
      if (canvas.width !== msg.bitmap.width || canvas.height !== msg.bitmap.height) {
        canvas.width = msg.bitmap.width;
        canvas.height = msg.bitmap.height;
      }
      ctx.drawImage(msg.bitmap, 0, 0);
      msg.bitmap.close();
      const t0 = performance.now();
      const result = landmarker.detectForVideo(canvas, msg.ts);
      const inferMs = performance.now() - t0;
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
        { type: 'hands', ts: msg.ts, count: n, data, labels, scores, ms: inferMs },
        [data.buffer, labels.buffer, scores.buffer],
      );
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      inFlight = false;
    }
  }
};
