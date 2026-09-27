// One Euro Filter (Casiez et al., CHI 2012) — the standard adaptive low-pass
// filter for noisy human-motion tracking: low cutoff (more smoothing) when the
// signal is slow, high cutoff (low lag) when it moves fast. Pure module.

export interface OneEuroConfig {
  /** cutoff at zero speed, Hz — lower = smoother at rest */
  minCutoff: number;
  /** speed coefficient — higher = more responsive to fast motion */
  beta: number;
  /** cutoff for the derivative estimate, Hz */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroConfig = {
  // ADR-021 (CPU-class AR): slightly softer at rest (CPU landmarks jitter
  // more) but notably faster to follow real motion — beta up ~70% cuts the
  // lag a slow-moving wheel feels, which is what "accurate" reads as.
  minCutoff: 0.9,
  beta: 0.012,
  dCutoff: 1.0,
};

const TWO_PI = Math.PI * 2;

export class OneEuro {
  private xPrev = 0;
  private dxPrev = 0;
  private tPrev = -1;
  private initialized = false;

  constructor(private cfg: OneEuroConfig = DEFAULT_ONE_EURO) {}

  setConfig(cfg: Partial<OneEuroConfig>): void {
    Object.assign(this.cfg, cfg);
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (TWO_PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** t in seconds (monotonic). Returns filtered value. */
  filter(x: number, t: number): number {
    if (!this.initialized) {
      this.initialized = true;
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max(1e-4, t - this.tPrev);
    this.tPrev = t;

    const dx = (x - this.xPrev) / dt;
    const aD = this.alpha(this.cfg.dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.cfg.minCutoff + this.cfg.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }

  reset(): void {
    this.initialized = false;
  }
}
