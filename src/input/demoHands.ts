// DemoHands — the synthetic hand source behind `?pipdemo=1` (M7): feeds the
// REAL pipeline (identity tracker → GestureSolver) with fixture geometry on a
// scripted cycle (cruise → one-hand hold → hands lost → regrip → brake), so
// the AR dashboard, the solver's graceful degradation and the game itself can
// be demonstrated and E2E-verified without a camera. Satisfies TrackerLike.

import { GestureSolver, type CalibrationData } from './gestures';
import { HandIdentityTracker, type HandPair } from './handTracks';
import { makeFist, makeOpen } from './handFixture';
import type { RawHand } from './handTypes';
import type { TrackerLike } from '../render/pip';

const CAL: CalibrationData = {
  anchorLx: 0.35,
  anchorLy: 0.6,
  anchorRx: 0.65,
  anchorRy: 0.6,
  shoulderRef: 0.3,
};

/** Place a hand as if gripping the wheel at angle `deg` around the centre. */
function fistAt(side: 'L' | 'R', deg: number): RawHand {
  const c = 0.5;
  const r = 0.15;
  const base = side === 'L' ? 180 : 0;
  const a = ((base + deg) * Math.PI) / 180;
  return makeFist([c + r * Math.cos(a), 0.6 - r * Math.sin(a)], side === 'L' ? 0 : 1);
}

function openAt(side: 'L' | 'R', deg: number): RawHand {
  const c = 0.5;
  const r = 0.15;
  const base = side === 'L' ? 180 : 0;
  const a = ((base + deg) * Math.PI) / 180;
  return makeOpen([c + r * Math.cos(a), 0.6 - r * Math.sin(a)], side === 'L' ? 0 : 1);
}

type HandSel = 'fist' | 'open' | null;

/** Scripted demo cycle (seconds, loops): cruise a sinusoid, drop hands,
 *  regrip, brake, recover. */
export function demoPhase(t: number): { l: HandSel; r: HandSel; wheelDeg: number } {
  const m = t % 20;
  const wheel = 40 * Math.sin((m / 7) * Math.PI * 2);
  if (m < 11) return { l: 'fist', r: 'fist', wheelDeg: wheel };
  if (m < 13) return { l: 'fist', r: null, wheelDeg: wheel * 0.4 }; // PARTIAL hold
  if (m < 14.5) return { l: null, r: null, wheelDeg: 0 }; // HANDS_LOST
  if (m < 16) return { l: 'fist', r: 'open', wheelDeg: wheel * 0.6 }; // regrip
  if (m < 18) return { l: 'open', r: 'open', wheelDeg: 0 }; // brake
  return { l: 'fist', r: 'fist', wheelDeg: wheel };
}

export class DemoHands implements TrackerLike {
  readonly solver = new GestureSolver({}, { load: () => ({ ...CAL }) });
  private videoEl: HTMLVideoElement | null = null;
  get video(): HTMLVideoElement {
    this.videoEl ??= document.createElement('video');
    return this.videoEl;
  }
  readonly info = {
    phase: 'READY',
    latencyMs: 24,
    delegate: 'DEMO',
    lastHands: [] as readonly RawHand[],
  };
  pair: HandPair = { left: null, right: null, confidence: 0 };

  private readonly identity = new HandIdentityTracker();
  private raf = 0;
  private t0 = 0;
  private running = false;
  /** sim-time throttle for the solver feed (~30 Hz like a real camera) */
  private nextFeed = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.t0 = performance.now();
    this.identity.reset();
    const loop = (): void => {
      if (!this.running) return;
      const now = performance.now();
      const t = (now - this.t0) / 1000;
      if (t >= this.nextFeed) {
        this.nextFeed += 1 / 30;
        this.feed(t);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private feed(t: number): void {
    const ph = demoPhase(t);
    const hands: RawHand[] = [];
    if (ph.l === 'fist') hands.push(fistAt('L', ph.wheelDeg));
    else if (ph.l === 'open') hands.push(openAt('L', ph.wheelDeg));
    if (ph.r === 'fist') hands.push(fistAt('R', ph.wheelDeg));
    else if (ph.r === 'open') hands.push(openAt('R', ph.wheelDeg));
    this.info.lastHands = hands;
    this.pair = this.identity.update(hands, t);
    this.solver.update(this.pair, t);
  }
}
