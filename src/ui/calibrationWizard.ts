// Calibration wizard (PLAN §5.6, §5.9): side-correction, anchor capture with
// progress, a short follow-the-wheel practice pass measuring mean |error|,
// live latency + grip readouts. Runs over the shared PiP canvas enlarged.

import type { HandTracker } from '../input/handTracker';
import type { PipRenderer } from '../render/pip';

type Phase = 'HOLD' | 'PRACTICE' | 'DONE';

export class CalibrationWizard {
  private phase: Phase = 'HOLD';
  private practiceT = 0;
  private practiceSamples = 0;
  private practiceErrorSum = 0;
  private practiceRms = 0;
  private raf = 0;
  private lastT = 0;

  constructor(
    private readonly tracker: HandTracker,
    private readonly pip: PipRenderer,
    private readonly ui: {
      root: HTMLElement;
      title: HTMLElement;
      body: HTMLElement;
      progress: HTMLElement;
    },
  ) {}

  async run(): Promise<void> {
    this.phase = 'HOLD';
    this.ui.root.style.display = 'flex';
    this.pip.setWizardMode(true);
    this.tracker.solver.beginCalibration();
    this.setTitle('CALIBRATION');
    this.setBody('Hold both hands as if gripping a wheel — 9 and 3 — fists closed.');

    return new Promise((resolve) => {
      const tick = (t: number): void => {
        // camera died mid-wizard → abort cleanly back to the recovery flow
        if (this.tracker.info.phase === 'ERROR') {
          this.phase = 'DONE';
          this.finish(resolve);
          return;
        }
        const dt = this.lastT ? (t - this.lastT) / 1000 : 0;
        this.lastT = t;
        this.pip.draw();

        const s = this.tracker.solver;
        if (this.phase === 'HOLD') {
          // physical-side sanity: if identities disagree with screen sides, swap
          this.tracker.ensureSides();
          this.setProgress(s.calibrationProgress);
          this.setBody(
            `Hold both hands as if gripping a wheel — 9 and 3 — fists closed.\n` +
              `hands: ${this.tracker.info.lastHands.length}/2   latency: ${this.tracker.info.latencyMs.toFixed(0)} ms`,
          );
          if (s.calibrated) {
            this.phase = 'PRACTICE';
            this.practiceT = 0;
            this.setTitle('PRACTICE');
            this.setProgress(0);
          }
        } else if (this.phase === 'PRACTICE') {
          this.practiceT += dt;
          const target = 40 * Math.sin(2 * Math.PI * 0.25 * this.practiceT);
          const err = Math.abs(s.state.wheelAngleDeg - target);
          this.practiceErrorSum += err;
          this.practiceSamples++;
          this.setProgress(Math.min(1, this.practiceT / 6));
          this.setBody(
            `Follow the wheel: turn with the ghost spoke.\n` +
              `target ${target.toFixed(0)}°  wheel ${s.state.wheelAngleDeg.toFixed(0)}°  err ${err.toFixed(0)}°`,
          );
          this.drawGhost(target);
          if (this.practiceT >= 6) {
            this.practiceRms = this.practiceErrorSum / Math.max(1, this.practiceSamples);
            this.phase = 'DONE';
          }
        }
        if (this.phase !== 'DONE') this.raf = requestAnimationFrame(tick);
        else {
          this.finish(resolve);
        }
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  private finish(resolve: () => void): void {
    const verdict =
      this.practiceRms < 12 ? 'Excellent control!' : this.practiceRms < 20 ? 'Good — small adjustments help.' : 'Try recalibrating in a brighter spot.';
    this.setTitle('CALIBRATED');
    this.setBody(
      `mean tracking error ${this.practiceRms.toFixed(1)}° — ${verdict}\n` +
        `Fists = accelerate · open = brake · cross hands for full lock.\nStarting…`,
    );
    this.setProgress(1);
    setTimeout(() => {
      this.ui.root.style.display = 'none';
      this.pip.setWizardMode(false);
      cancelAnimationFrame(this.raf);
      resolve();
    }, 2200);
  }

  /** ghost spoke drawn on the PiP canvas after the wheel sprite */
  private drawGhost(targetDeg: number): void {
    void targetDeg; // drawn by pip in a future polish pass — text readout for now
  }

  private setTitle(s: string): void {
    this.ui.title.textContent = s;
  }

  private setBody(s: string): void {
    this.ui.body.textContent = s;
  }

  private setProgress(frac: number): void {
    this.ui.progress.style.width = `${Math.round(frac * 100)}%`;
  }

  get meanErrorDeg(): number {
    return this.practiceRms;
  }
}
