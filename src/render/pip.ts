// Webcam picture-in-picture — the AR dashboard (M7 overhaul): mirrored
// camera feed, state-coloured hand skeletons with grip gauges and motion
// trails, a live rocker-style steering wheel with the actual hand orbs on
// its rim, direction chevrons, pedal meters, a plain-language gesture
// banner and a status ring that pulses when hands are lost. One canvas,
// drawn once per render frame. Draws from a `TrackerLike` source so a
// synthetic demo source (`?pipdemo=1`) can drive it without a camera.

import type { GestureSolver, SolverState } from '../input/gestures';
import type { HandPair } from '../input/handTracks';
import type { RawHand } from '../input/handTypes';
import type { DriverIntent } from '../sim/intent';

/** Everything the AR overlay reads — satisfied by HandTracker and DemoHands. */
export interface TrackerLike {
  readonly solver: GestureSolver;
  readonly info: {
    readonly phase: string;
    readonly latencyMs: number;
    readonly delegate: string;
    readonly lastHands: readonly RawHand[];
  };
  readonly pair: HandPair;
  readonly video: HTMLVideoElement;
}

// MediaPipe hand skeleton connections (index pairs)
const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const STATUS_COLOR: Record<string, string> = {
  TRACKING: '#43d17a',
  CALIBRATING: '#ffd166',
  PARTIAL: '#ffb01f',
  HANDS_LOST: '#ff4d4d',
  UNCALIBRATED: '#8a93a6',
};

const TRAIL = 26;

/** Plain-language readout of what the hands are commanding (pure — tested). */
export function gestureBanner(
  state: SolverState,
  intent: DriverIntent,
  oneHanded = false,
): string {
  switch (state.status) {
    case 'UNCALIBRATED':
      return 'HOLD BOTH HANDS UP TO CALIBRATE';
    case 'CALIBRATING':
      return 'CALIBRATING — HOLD STEADY…';
    case 'HANDS_LOST':
      return `HANDS LOST — AUTO-HOLD`;
    case 'PARTIAL':
      if (oneHanded) return 'SHOW A HAND';
      if (state.fistL || state.fistR) return 'ONE HAND — HOLDING';
      return 'SHOW BOTH HANDS';
    case 'TRACKING':
      if (oneHanded && !(state.fistL && state.fistR)) {
        if (state.fistL || state.fistR) {
          const a = Math.abs(state.wheelAngleDeg);
          if (a < 10) return 'FIST — FULL THROTTLE';
          return `TURNING ${state.wheelAngleDeg > 0 ? 'LEFT' : 'RIGHT'} ${Math.round(a)}°`;
        }
        return 'OPEN PALM — BRAKING';
      }
      if (state.fistL && state.fistR) {
        const a = Math.abs(state.wheelAngleDeg);
        if (a < 10) return 'FISTS — FULL THROTTLE';
        return `TURNING ${state.wheelAngleDeg > 0 ? 'LEFT' : 'RIGHT'} ${Math.round(a)}°`;
      }
      if (!state.fistL && !state.fistR) return 'OPEN PALMS — BRAKING';
      return 'REGRIP — HOLDING';
  }
}

export class PipRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly trail = new Float32Array(TRAIL * 4);
  private trailN = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly source: TrackerLike,
  ) {
    this.canvas.width = 480;
    this.canvas.height = 360;
    this.ctx = canvas.getContext('2d')!;
  }

  setWizardMode(on: boolean): void {
    this.canvas.parentElement?.classList.toggle('wizard', on);
  }

  draw(): void {
    const g = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const video = this.source.video;
    const st = this.source.solver.state;
    const intent = this.source.solver.intent;

    g.clearRect(0, 0, w, h);
    g.fillStyle = '#101318';
    g.fillRect(0, 0, w, h);

    // mirrored camera feed (screen-left = player-left)
    if (video.readyState >= 2) {
      g.save();
      g.translate(w, 0);
      g.scale(-1, 1);
      g.drawImage(video, 0, 0, w, h);
      g.restore();
      g.fillStyle = 'rgba(8,10,16,0.32)';
      g.fillRect(0, 0, w, h);
    }

    this.drawTrail(g);
    this.drawSkeletons(g, w, h, st);
    this.drawWheel(g, w, h, st, intent);
    this.drawPedals(g, w, h, intent);
    this.drawBanner(g, w, h, st, intent);
    this.drawStatusRing(g, w, h, st);
  }

  /** Fading wrist trails — the tracking feels alive. */
  private drawTrail(g: CanvasRenderingContext2D): void {
    const t = this.trail;
    const pair = this.source.pair;
    t.copyWithin(4, 0, (TRAIL - 1) * 4);
    t[0] = pair.left ? pair.left.data[0] : -1;
    t[1] = pair.left ? pair.left.data[1] : -1;
    t[2] = pair.right ? pair.right.data[0] : -1;
    t[3] = pair.right ? pair.right.data[1] : -1;
    if (this.trailN < TRAIL) this.trailN++;
    const w = this.canvas.width;
    const h = this.canvas.height;
    for (let i = this.trailN - 1; i > 0; i--) {
      const a = (1 - i / TRAIL) * 0.28;
      g.strokeStyle = `rgba(140, 220, 255, ${a.toFixed(3)})`;
      g.lineWidth = 2;
      for (let s = 0; s < 2; s++) {
        const x0 = t[i * 4 + s * 2];
        const y0 = t[i * 4 + s * 2 + 1];
        const x1 = t[(i - 1) * 4 + s * 2];
        const y1 = t[(i - 1) * 4 + s * 2 + 1];
        if (x0 < 0 || x1 < 0) continue;
        g.beginPath();
        g.moveTo(x0 * w, y0 * h);
        g.lineTo(x1 * w, y1 * h);
        g.stroke();
      }
    }
  }

  private drawSkeletons(g: CanvasRenderingContext2D, w: number, h: number, st: SolverState): void {
    const px = (v: number): number => v * w;
    const py = (v: number): number => v * h;
    // nearest-side fist colouring (labels are unreliable across crossings)
    const lw = this.source.pair.left ? this.source.pair.left.data[0] : -9;
    const rw = this.source.pair.right ? this.source.pair.right.data[0] : -9;
    for (const hand of this.source.info.lastHands) {
      const nearLeft = Math.abs(hand.data[0] - lw) <= Math.abs(hand.data[0] - rw);
      const fist = nearLeft ? st.fistL : st.fistR;
      const grip = nearLeft ? st.gripL : st.gripR;
      const line = fist ? 'rgba(255, 176, 46, 0.9)' : 'rgba(110, 190, 255, 0.85)';
      g.strokeStyle = line;
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.beginPath();
      for (const [a, b] of CONNECTIONS) {
        g.moveTo(px(hand.data[a * 3]), py(hand.data[a * 3 + 1]));
        g.lineTo(px(hand.data[b * 3]), py(hand.data[b * 3 + 1]));
      }
      g.stroke();
      // joints
      g.fillStyle = line;
      for (let i = 0; i < 21; i++) {
        g.beginPath();
        g.arc(px(hand.data[i * 3]), py(hand.data[i * 3 + 1]), i === 0 ? 4 : 2, 0, Math.PI * 2);
        g.fill();
      }
      // wrist grip gauge: arc filling with grip
      const wx = px(hand.data[0]);
      const wy = py(hand.data[1]);
      g.beginPath();
      g.arc(wx, wy, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * grip);
      g.strokeStyle = fist ? 'rgba(255, 176, 46, 0.95)' : 'rgba(110, 190, 255, 0.7)';
      g.lineWidth = 3;
      g.stroke();
    }
  }

  private drawWheel(
    g: CanvasRenderingContext2D,
    w: number,
    h: number,
    st: SolverState,
    intent: DriverIntent,
  ): void {
    const cx = w / 2;
    const cy = h * 0.52;
    const r = h * 0.3;
    g.save();
    g.translate(cx, cy);
    g.rotate((-st.wheelAngleDeg * Math.PI) / 180); // + wheel = CCW on screen

    // rim
    const rim = g.createLinearGradient(-r, 0, r, 0);
    rim.addColorStop(0, '#cfd6e4');
    rim.addColorStop(0.5, '#8a93a6');
    rim.addColorStop(1, '#cfd6e4');
    g.strokeStyle = rim;
    g.lineWidth = 9;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
    // grip zones at 9 / 3 o'clock
    g.strokeStyle = 'rgba(255,176,46,0.55)';
    g.lineWidth = 12;
    g.beginPath();
    g.arc(0, 0, r, Math.PI - 0.45, Math.PI + 0.45);
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r, -0.45, 0.45);
    g.stroke();
    // spokes
    g.strokeStyle = 'rgba(210, 218, 232, 0.8)';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(-r * 0.92, 0);
    g.lineTo(r * 0.92, 0);
    g.moveTo(0, -r * 0.25);
    g.lineTo(0, r * 0.92);
    g.stroke();
    g.restore();

    // hub marker + angle readout (screen-fixed)
    g.fillStyle = '#e8ecf4';
    g.beginPath();
    g.arc(cx, cy - r - 12, 4, 0, Math.PI * 2);
    g.fill();
    g.font = 'bold 15px ui-monospace, monospace';
    g.textAlign = 'center';
    g.fillStyle = '#e8ecf4';
    g.fillText(`${Math.abs(Math.round(st.wheelAngleDeg))}°`, cx, cy + 5);

    // hand orbs ON the wheel at the tracked wrist positions
    const orb = (hand: { data: Float32Array } | null, grip: number, fist: boolean): void => {
      if (!hand) return;
      const x = hand.data[0] * w;
      const y = hand.data[1] * h;
      const grad = g.createRadialGradient(x, y, 1, x, y, 16 + grip * 6);
      const c0 = fist ? '255,190,80' : '130,200,255';
      grad.addColorStop(0, `rgba(${c0},0.95)`);
      grad.addColorStop(1, `rgba(${c0},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, 16 + grip * 6, 0, Math.PI * 2);
      g.fill();
    };
    const pair = this.source.pair;
    orb(pair.left, st.gripL, st.fistL);
    orb(pair.right, st.gripR, st.fistR);

    // direction chevrons: intensity follows the actual steering command
    const cmd = Math.abs(intent.steer);
    if (cmd > 0.08) {
      const n = Math.min(3, 1 + Math.floor(cmd * 2.99));
      const dir = intent.steer > 0 ? 1 : -1; // steer + = right
      const y = cy;
      for (let i = 0; i < n; i++) {
        const x = cx + dir * (r + 26 + i * 16);
        g.strokeStyle = `rgba(120, 230, 255, ${(0.35 + 0.6 * cmd).toFixed(2)})`;
        g.lineWidth = 4;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(x - dir * 7, y - 9);
        g.lineTo(x, y);
        g.lineTo(x - dir * 7, y + 9);
        g.stroke();
      }
    }
    g.textAlign = 'left';
  }

  private drawPedals(g: CanvasRenderingContext2D, w: number, h: number, intent: DriverIntent): void {
    const x = w - 26;
    const top = h * 0.2;
    const bh = h * 0.52;
    const bar = (frac: number, c0: string, c1: string, label: string): void => {
      g.fillStyle = 'rgba(255,255,255,0.13)';
      g.beginPath();
      g.roundRect(x, top, 16, bh, 5);
      g.fill();
      const grad = g.createLinearGradient(0, top + bh, 0, top);
      grad.addColorStop(0, c0);
      grad.addColorStop(1, c1);
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(x, top + bh * (1 - frac), 16, Math.max(2, bh * frac), 5);
      g.fill();
      g.font = 'bold 11px ui-monospace, monospace';
      g.fillStyle = 'rgba(232,236,244,0.85)';
      g.textAlign = 'center';
      g.fillText(label, x + 8, top + bh + 16);
    };
    bar(intent.throttle, '#3f9e3a', '#9fe27a', 'T');
    bar(intent.brake, '#a03028', '#ff7a5c', 'B');
    g.textAlign = 'left';
  }

  private drawBanner(g: CanvasRenderingContext2D, w: number, h: number, st: SolverState, _intent: DriverIntent): void {
    const text = gestureBanner(st, this.source.solver.intent, st.oneHanded);
    g.font = 'bold 16px ui-monospace, monospace';
    const tw = g.measureText(text).width;
    const bx = w / 2 - tw / 2 - 14;
    const by = h - 46;
    g.fillStyle = st.status === 'HANDS_LOST' ? 'rgba(120,20,20,0.72)' : 'rgba(10,14,22,0.72)';
    g.beginPath();
    g.roundRect(bx, by, tw + 28, 30, 8);
    g.fill();
    g.fillStyle = st.status === 'HANDS_LOST' ? '#ffb3ab' : '#e8ecf4';
    g.textAlign = 'left';
    g.fillText(text, bx + 14, by + 21);
  }

  private drawStatusRing(g: CanvasRenderingContext2D, w: number, h: number, st: SolverState): void {
    const color = STATUS_COLOR[st.status] ?? '#8a93a6';
    const t = performance.now() / 1000;
    const pulse = st.status === 'HANDS_LOST' ? 0.45 + 0.55 * Math.abs(Math.sin(t * 3)) : 0.85;
    g.strokeStyle = color;
    g.globalAlpha = pulse;
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(2, 2, w - 4, h - 4, 14);
    g.stroke();
    g.globalAlpha = 1;

    // status + telemetry pill
    g.font = 'bold 14px ui-monospace, monospace';
    const label = `${st.status}`;
    g.fillStyle = 'rgba(10,14,22,0.72)';
    g.beginPath();
    g.roundRect(10, 10, 118, 22, 6);
    g.fill();
    g.fillStyle = color;
    g.fillText(label, 18, 25);
    g.fillStyle = 'rgba(232,236,244,0.8)';
    const lat = this.source.info.latencyMs.toFixed(0);
    const right = `${lat} ms · ${this.source.info.delegate}`;
    g.fillText(right, w - 14 - g.measureText(right).width, 25);
  }
}
