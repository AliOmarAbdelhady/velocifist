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
import {
  RES_EVAL_FRAMES,
  RES_LADDERS,
  nextResolution,
  startResolution,
  type DelegatePref,
} from './trackerTuning';
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
  /** EMA of worker-reported inference ms (ADR-021) */
  inferenceMs: number;
  /** EMA of processed frames per second (ADR-021) */
  fps: number;
  /** current inference frame size, e.g. "320×240" (ADR-021) */
  res: string;
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
    inferenceMs: 0,
    fps: 0,
    res: '—',
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
  private muteTimer: number | null = null;
  // ADR-021 adaptive resolution + rVFC pump bookkeeping
  private res: [number, number] = [320, 240];
  private framesSinceEval = 0;
  private pumpScheduled = false;
  private pumpTimer: number | null = null;

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
   * ADR-021: `prefer` overrides the measured GPU/CPU pick (?ar= URL).
   */
  async start(timeoutMs = 75000, prefer: DelegatePref = 'auto'): Promise<void> {
    this.info.phase = 'STARTING';
    this.info.error = null;
    this.lostFired = false;
    try {
      // ask for a crisp source (driver-facing); the pump downscales to the
      // delegate-appropriate inference size — better landmarks at distance
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 960 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: 'user',
        },
        audio: false,
      });
    } catch (err) {
      this.info.phase = 'DENIED';
      this.info.error = classifyGumError(err);
      return;
    }

    for (const track of this.stream.getVideoTracks()) {
      track.addEventListener('ended', () => this.lose('camera disconnected (USB/privacy switch?)'));
      // Chrome fires transient mutes during startup renegotiation — give the
      // track a grace period before declaring the camera stolen.
      track.addEventListener('mute', () => {
        if (this.muteTimer === null) {
          this.muteTimer = window.setTimeout(() => {
            this.muteTimer = null;
            this.lose('camera muted — taken over by another app?');
          }, 2500);
        }
      });
      track.addEventListener('unmute', () => {
        if (this.muteTimer !== null) {
          clearTimeout(this.muteTimer);
          this.muteTimer = null;
        }
      });
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
    this.worker.postMessage({ type: 'init', prefer }); // asset URLs are bundled into the worker

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
    if (this.muteTimer !== null) {
      clearTimeout(this.muteTimer);
      this.muteTimer = null;
    }
    if (this.pumpTimer !== null) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
    this.pumpScheduled = false;
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
    this.schedulePump();
    // Watchdog: if the rVFC/rAF scheduling chain ever stalls (driver quirk,
    // tab throttling), restart it — the pump must never silently die.
    this.pumpTimer = window.setInterval(() => {
      if (
        this.pumpScheduled ||
        this.info.phase === 'DENIED' ||
        this.info.phase === 'ERROR' ||
        this.info.phase === 'IDLE'
      ) {
        return;
      }
      this.schedulePump();
    }, 500);
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    // ADR-021: requestVideoFrameCallback fires per DECODED camera frame —
    // the pump cadence stays at the camera's ~30 Hz even when the main
    // thread is saturated by the render loop on weak machines (rAF would
    // throttle hand tracking down to the game's fps).
    type RVFCVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    const v = this.video as RVFCVideo;
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(() => void this.pumpOnce());
    } else {
      requestAnimationFrame(() => void this.pumpOnce());
    }
  }

  private async pumpOnce(): Promise<void> {
    this.pumpScheduled = false;
    if (this.info.phase === 'DENIED' || this.info.phase === 'ERROR' || this.info.phase === 'IDLE') return;
    if (this.video.readyState >= 2 && !this.pending && this.worker) {
      this.pending = true;
      try {
        const [w, h] = this.res;
        const bitmap = await createImageBitmap(this.video, {
          resizeWidth: w,
          resizeHeight: h,
          resizeQuality: w >= 480 ? 'medium' : 'low',
        });
        const ts = performance.now();
        this.worker.postMessage({ type: 'frame', ts, bitmap }, [bitmap]);
      } catch {
        this.pending = false;
      }
    }
    this.schedulePump();
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
      this.info.inferenceMs = msg.ms ?? 0;
      this.res = startResolution(msg.delegate);
      this.info.res = `${this.res[0]}×${this.res[1]}`;
      this.readyResolve?.();
      return;
    }
    if (msg.type === 'status') {
      this.info.error = `loading: ${msg.message}`; // transient init progress
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
    if (typeof msg.ms === 'number') {
      this.info.inferenceMs =
        this.info.inferenceMs === 0 ? msg.ms : this.info.inferenceMs * 0.9 + msg.ms * 0.1;
    }
    // processed-frame-rate EMA from wall-clock deltas
    if (this.lastFrameWallTime > 0) {
      const hz = 1000 / Math.max(1, now - this.lastFrameWallTime);
      this.info.fps = this.info.fps === 0 ? hz : this.info.fps * 0.9 + hz * 0.1;
    }
    // ADR-021 adaptive resolution: re-evaluate the inference frame size on a
    // fixed cadence so one slow frame (GC, tab switch) can't flap it
    if (++this.framesSinceEval >= RES_EVAL_FRAMES) {
      this.framesSinceEval = 0;
      const next = nextResolution(this.info.inferenceMs, this.res, RES_LADDERS[this.info.delegate === 'GPU' ? 'GPU' : 'CPU']);
      if (next) {
        this.res = next;
        this.info.res = `${next[0]}×${next[1]}`;
      }
    }

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
