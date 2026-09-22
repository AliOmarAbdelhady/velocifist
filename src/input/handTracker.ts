// HandTracker — main-thread side of the hand pipeline (PLAN §5.1–5.3):
// camera capture → downscaled ImageBitmaps → worker inference → mirrored
// landmarks → identity tracker → One Euro + GestureSolver → DriverIntent.
// Measures capture→intent latency (EMA) and exposes raw hands for the PiP.
//
// Robustness contract (PLAN §22 chaos drills): start() resolves ONLY once the
// worker is genuinely ready (or after a timeout with a classified error);
// mid-run camera loss (track ended/muted, persistent inference errors) flips
// phase to ERROR with a human-readable reason and fires onLost exactly once.

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

function classifyGumError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission denied — click the camera icon in the address bar and allow access, then retry';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no usable camera found — is one connected?';
    case 'NotReadableError':
    case 'AbortError':
      return 'camera busy — close other apps/tabs using it (Cheese, Zoom, another browser window) and retry';
    default:
      return err instanceof Error ? err.message : String(err);
  }
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

  /** Fired exactly once if the camera/tracker dies mid-run. */
  onLost: ((reason: string) => void) | null = null;

  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private identity = new HandIdentityTracker();
  private pending = false;
  private lastHands: RawHand[] = [];
  private lastFrameWallTime = 0;
  private tBase = 0;
  private readyResolve: (() => void) | null = null;
  private consecutiveErrors = 0;
  private lostFired = false;

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

  /**
   * Starts camera + worker and resolves when the pipeline is READY
   * (or failed with a classified error — check info.phase/info.error).
   */
  async start(timeoutMs = 25000): Promise<void> {
    this.info.phase = 'STARTING';
    this.info.error = null;
    this.lostFired = false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      this.info.phase = 'DENIED';
      this.info.error = classifyGumError(err);
      return;
    }

    for (const track of this.stream.getVideoTracks()) {
      track.addEventListener('ended', () => this.lose('camera disconnected (USB/privacy switch?)'));
      track.addEventListener('mute', () => this.lose('camera taken over by another app'));
    }

    document.body.appendChild(this.video);
    this.video.srcObject = this.stream;
    try {
      await this.video.play();
    } catch {
      this.lose('could not start the video stream');
      return;
    }

    this.worker = new Worker(new URL('./tracker.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent<TrackerMessage>) => this.onMessage(e.data);
    this.worker.postMessage({
      type: 'init',
      wasmBase: '/vendor/mediapipe/wasm',
      modelUrl: '/models/hand_landmarker.task',
    });

    const ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([ready, timeout]);
    if (this.info.phase === 'STARTING') {
      this.lose(`model failed to load within ${Math.round(timeoutMs / 1000)} s — check the console`);
    }

    this.startPump();
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.remove();
    if (this.info.phase !== 'DENIED' && this.info.phase !== 'ERROR') this.info.phase = 'IDLE';
  }

  /** Force L/R identities to match screen sides (kills any label ambiguity). */
  ensureSides(): void {
    const l = this.lastPair.left;
    const r = this.lastPair.right;
    if (l && r && l.data[0] > r.data[0]) this.identity.swap();
  }

  private startPump(): void {
    const pump = async (): Promise<void> => {
      if (this.info.phase === 'DENIED' || this.info.phase === 'ERROR' || this.info.phase === 'IDLE') return;
      if (this.video.readyState >= 2 && !this.pending && this.worker) {
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
      }
      requestAnimationFrame(() => void pump());
    };
    void pump();
  }

  private lose(reason: string): void {
    if (this.info.phase === 'ERROR') return;
    this.info.phase = 'ERROR';
    this.info.error = reason;
    if (!this.lostFired) {
      this.lostFired = true;
      this.onLost?.(reason);
    }
  }

  private onMessage(msg: TrackerMessage): void {
    if (msg.type === 'ready') {
      this.info.phase = 'READY';
      this.info.delegate = msg.delegate;
      this.readyResolve?.();
      return;
    }
    if (msg.type === 'error') {
      if (this.info.phase === 'STARTING') {
        // init failure: GPU and CPU both failed
        this.info.phase = 'ERROR';
        this.info.error = msg.message;
        this.readyResolve?.();
        this.lostFired = true; // start() reports it; no onLost needed
      } else {
        // per-frame inference hiccup: tolerate bursts, die on persistence
        if (++this.consecutiveErrors > 45) this.lose(`tracking failed repeatedly (${msg.message})`);
      }
      return;
    }
    if (msg.type !== 'hands') return;

    this.pending = false;
    this.consecutiveErrors = 0;
    const now = performance.now();
    this.info.latencyMs = this.info.latencyMs * 0.85 + (now - msg.ts) * 0.15;

    // mirror: screen-left = player-left
    const hands: RawHand[] = [];
    for (let h = 0; h < msg.count; h++) {
      const src = msg.data.subarray(h * 63, h * 63 + 63);
      const d = new Float32Array(63);
      for (let i = 0; i < 21; i++) {
        d[i * 3] = 1 - src[i * 3];
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
