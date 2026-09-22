// Webcam picture-in-picture with the AR overlay (PLAN §5.6): mirrored camera
// feed, hand skeletons, the live virtual steering wheel, grip glows, pedal
// bars, status + latency. One canvas, drawn once per render frame.

import type { HandTracker } from '../input/handTracker';
import type { RawHand } from '../input/handTypes';

// MediaPipe hand skeleton connections (index pairs)
const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export class PipRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly tracker: HandTracker,
  ) {
    this.canvas.width = 320;
    this.canvas.height = 240;
    this.ctx = canvas.getContext('2d')!;
  }

  setWizardMode(on: boolean): void {
    this.canvas.parentElement?.classList.toggle('wizard', on);
  }

  draw(): void {
    const g = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const video = this.tracker.video;

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
    }
    g.fillStyle = 'rgba(8,10,16,0.25)';
    g.fillRect(0, 0, w, h);

    // skeletons (coords already mirrored)
    const px = (lm: number): number => lm * w;
    const py = (lm: number): number => lm * h;
    for (const hand of this.tracker.info.lastHands as RawHand[]) {
      g.strokeStyle = 'rgba(120, 255, 160, 0.85)';
      g.lineWidth = 1.5;
      g.beginPath();
      for (const [a, b] of CONNECTIONS) {
        g.moveTo(px(hand.data[a * 3]), py(hand.data[a * 3 + 1]));
        g.lineTo(px(hand.data[b * 3]), py(hand.data[b * 3 + 1]));
      }
      g.stroke();
    }

    // virtual steering wheel
    const st = this.tracker.solver.state;
    const cx = w / 2;
    const cy = h * 0.64;
    const r = h * 0.3;
    g.save();
    g.translate(cx, cy);
    g.rotate((-st.wheelAngleDeg * Math.PI) / 180); // + wheel = CCW on screen
    g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-r, 0);
    g.lineTo(r, 0);
    g.moveTo(0, 0);
    g.lineTo(0, r);
    g.stroke();
    g.restore();

    // grip glows at tracked wrists
    const pair = this.tracker.pair;
    const gripDot = (hand: { data: Float32Array } | null, grip: number, fist: boolean): void => {
      if (!hand) return;
      const x = hand.data[0] * w;
      const y = hand.data[1] * h;
      g.beginPath();
      g.arc(x, y, 7 + grip * 4, 0, Math.PI * 2);
      g.fillStyle = fist ? 'rgba(255, 176, 46, 0.95)' : 'rgba(110, 190, 255, 0.65)';
      g.fill();
    };
    gripDot(pair.left, st.gripL, st.fistL);
    gripDot(pair.right, st.gripR, st.fistR);

    // pedal bars (right edge)
    const barX = w - 14;
    const bh = h - 60;
    const bar = (frac: number, color: string, top: number): void => {
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(barX, top, 8, bh);
      g.fillStyle = color;
      g.fillRect(barX, top + bh * (1 - frac), 8, bh * frac);
    };
    bar(this.tracker.solver.intent.throttle, '#7ee27a', 26);
    bar(this.tracker.solver.intent.brake, '#ff5a5a', 26);

    // status + latency
    g.font = '11px ui-monospace, monospace';
    g.fillStyle = st.status === 'TRACKING' ? '#9fe870' : '#ffd166';
    const lat = this.tracker.info.latencyMs.toFixed(0);
    g.fillText(`${st.status}  ${lat} ms  ${this.tracker.info.delegate}`, 8, 16);
  }
}
