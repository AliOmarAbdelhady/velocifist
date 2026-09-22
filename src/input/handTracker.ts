// HandTracker — main-thread side of the hand pipeline (PLAN §5.1–5.3):
// camera capture → downscaled ImageBitmaps → worker inference → mirrored
// landmarks → identity tracker → One Euro + GestureSolver → DriverIntent.
// Also measures capture→intent latency (EMA) and exposes raw hands for the PiP.

import { GestureSolver } from './gestures';
import { HandIdentityTracker, type HandPair } from './handTracks';
import type { RawHand, TrackerMessage } from './handTypes';
import { loadJSON, saveJSON } from '../persist/local';

export type TrackerPhase =
  | 'IDLE'
  | 'STARTING'
  | 'READY'
  | 'DENIED'
  | 'ERROR';

export interface TrackerInfo {
  phase: TrackerPhase;
  delegate: 'GPU' | 'CPU' | '—';
  error: string | null;
  latencyMs: number;
  /** mirrored raw detections of the latest processed frame (for the PiP) */
  lastHands: readonly RawHand[];
}

export class HandTracker {
  readonly solver: GestureSolver;
  readonly video: HTMLVideoElement;
  readonly info: TrackerInfo = {
    phase: 'IDLE',
    delegate: '—',
    error: null,
    latencyMs: 0,
    lastHands: [],
  };

  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private identity = new HandIdentityTracker();
  private pending = false;
  private lastHands: RawHand[] = [];
  private lastFrameWallTime = 0;
  private tBase = 0; // performance.now() at first frame → solver seconds clock

  constructor() {
    this.solver = new GestureSolver(
      {},
      {
        load: () => loadJSON('calib'),
        save: (c) => saveJSON('calib', c),
      },
    );
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.style.display = 'none';
  }

  get pair(): HandPair {
    return this.lastPair;
  }
  private lastPair: HandPair = { left: null, right: null, confidence: 0 };

  async start(): Promise<void> {
    this.info.phase = 'STARTING';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
    } catch {
      this.info.phase = 'DENIED';
      return;
    }
    document.body.appendChild(this.video);
    this.video.srcObject = this.stream;
    await this.video.play();

    this.worker = new Worker(new URL('./tracker.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent<TrackerMessage>) => this.onMessage(e.data);
    this.worker.postMessage({
      type: 'init',
      wasmBase: '/vendor/mediapipe/wasm',
      modelUrl: '/models/hand_landmarker.task',
    });

    // camera frames → worker (single-flight)
    const pump = async (): Promise<void> => {
      if (this.video.readyState < 2 || this.pending || !this.worker) {
        if (this.info.phase !== 'DENIED' && this.info.phase !== 'ERROR')
          requestAnimationFrame(() => void pump());
        return;
      }
      this.pending = true;
      try {
        const bitmap = await createImageBitmap(this.video, {
          resizeWidth: 320,
          resizeHeight: 240,
          resizeQuality: 'low',
        });
        const ts = performance.now();
        this.worker.postMessage({ type: 'frame', ts, bitmap }, [bitmap]);
      } catch {
        this.pending = false;
      }
      requestAnimationFrame(() => void pump());
    };
    void pump();
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.remove();
    this.info.phase = 'IDLE';
  }

  /** Force L/R identities to match screen sides (kills any label ambiguity). */
  ensureSides(): void {
    const l = this.lastPair.left;
    const r = this.lastPair.right;
    if (l && r && l.data[0] > r.data[0]) this.identity.swap();
  }

  private onMessage(msg: TrackerMessage): void {
    if (msg.type === 'ready') {
      this.info.phase = 'READY';
      this.info.delegate = msg.delegate;
      return;
    }
    if (msg.type === 'error') {
      this.info.error = msg.message;
      return;
    }
    if (msg.type !== 'hands') return;

    this.pending = false;
    const now = performance.now();
    this.info.latencyMs = this.info.latencyMs * 0.85 + (now - msg.ts) * 0.15;

    // mirror: screen-left = player-left
    const hands: RawHand[] = [];
    for (let h = 0; h < msg.count; h++) {
      const src = msg.data.subarray(h * 63, h * 63 + 63);
      const d = new Float32Array(63);
      for (let i = 0; i < 21; i++) d[i * 3] = 1 - src[i * 3];
      for (let i = 0; i < 21; i++) {
        d[i * 3 + 1] = src[i * 3 + 1];
        d[i * 3 + 2] = src[i * 3 + 2];
      }
      hands.push({ data: d, label: msg.labels[h] === 0 ? 0 : 1, score: msg.scores[h] });
    }
    this.lastHands = hands;
    this.info.lastHands = hands;

    if (this.tBase === 0) this.tBase = now;
    const t = (now - this.tBase) / 1000;
    this.lastPair = this.identity.update(hands, t);
    this.solver.update(this.lastPair, t);
    this.lastFrameWallTime = now;
  }

  /** ms since the last processed camera frame (staleness probe). */
  get frameAgeMs(): number {
    return this.lastFrameWallTime === 0 ? Infinity : performance.now() - this.lastFrameWallTime;
  }
}
