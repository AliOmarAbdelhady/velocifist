// Quality presets + auto-scaler (M6, PLAN §14): the Low preset is the
// Iris Xe-class baseline. The autoscaler watches an EMA of frame time and
// steps DOWN quickly under sustained pressure (with hysteresis) and UP only
// after a long clean stretch — and never above the user's manual cap.
// Decision logic lives in the DOM-free `Autoscaler` (unit-tested).

export type QualityLevel = 'low' | 'medium' | 'high';
export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

export interface QualityPreset {
  /** device-pixel-ratio cap (clamped to [0.75, 1.5] overall) */
  dprCap: number;
  gradePass: boolean;
  msaa: number;
  speedLines: boolean;
  sparkCap: number;
  smokeCap: number;
  anisotropy: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    dprCap: 1.0, gradePass: false, msaa: 0, speedLines: false,
    sparkCap: 128, smokeCap: 96, anisotropy: 4,
  },
  medium: {
    dprCap: 1.25, gradePass: true, msaa: 0, speedLines: true,
    sparkCap: 224, smokeCap: 160, anisotropy: 8,
  },
  high: {
    dprCap: 1.5, gradePass: true, msaa: 4, speedLines: true,
    sparkCap: 320, smokeCap: 200, anisotropy: 8,
  },
};

export interface LevelChange {
  from: QualityLevel;
  to: QualityLevel;
}

/** DOM-free step decision core (tested). Feed per-frame dt in ms. */
export class Autoscaler {
  private ema = 16.7;
  private badFrames = 0;
  private goodFrames = 0;
  private idx: number;

  /** hard frame-time ceiling that counts as "bad" (ms) */
  readonly badMs: number;
  /** sustained "good" ceiling (ms) */
  readonly goodMs: number;

  constructor(
    start: QualityLevel = 'medium',
    private readonly cap: QualityLevel = 'high',
    badMs = 19.5,
    goodMs = 14.0,
  ) {
    this.idx = QUALITY_LEVELS.indexOf(start);
    this.badMs = badMs;
    this.goodMs = goodMs;
  }

  get level(): QualityLevel {
    return QUALITY_LEVELS[this.idx];
  }

  get emaMs(): number {
    return this.ema;
  }

  /** Feed one frame; returns a change when the level shifts this frame. */
  feed(frameDtMs: number): LevelChange | null {
    this.ema = this.ema * 0.94 + Math.min(frameDtMs, 100) * 0.06;

    if (this.ema > this.badMs) {
      this.badFrames++;
      this.goodFrames = 0;
    } else {
      this.badFrames = 0;
      if (this.ema < this.goodMs && this.idx < QUALITY_LEVELS.indexOf(this.cap)) {
        this.goodFrames++;
      } else {
        this.goodFrames = 0;
      }
    }

    // step down after ~1.5 s of sustained pressure
    if (this.badFrames > 90 && this.idx > 0) {
      const from = this.level;
      this.idx--;
      this.badFrames = 0;
      this.goodFrames = -900; // stay put ≥15 s after a step down
      this.ema = 16.7;
      return { from, to: this.level };
    }
    // step up only after ~25 s clean and one level at a time
    if (this.goodFrames > 1500) {
      const from = this.level;
      this.idx++;
      this.goodFrames = 0;
      return { from, to: this.level };
    }
    return null;
  }
}

/** Manages mode (auto | manual level) and applies the effective preset. */
export class QualityManager {
  mode: 'auto' | QualityLevel;
  private auto: Autoscaler;
  private manual: QualityLevel;
  private lastApplied: QualityLevel | null = null;

  constructor(
    setting: 'auto' | QualityLevel = 'auto',
    private readonly onChange: (level: QualityLevel, preset: QualityPreset) => void,
  ) {
    this.mode = setting;
    this.manual = setting === 'auto' ? 'medium' : setting;
    this.auto = new Autoscaler('medium', 'high');
  }

  get level(): QualityLevel {
    return this.mode === 'auto' ? this.auto.level : this.manual;
  }

  get preset(): QualityPreset {
    return QUALITY_PRESETS[this.level];
  }

  get emaMs(): number {
    return this.auto.emaMs;
  }

  /** Cycle auto → low → medium → high → auto (Q key / options). */
  cycle(): void {
    const order: ('auto' | QualityLevel)[] = ['auto', 'low', 'medium', 'high'];
    const cur = order.indexOf(this.mode === 'auto' ? 'auto' : this.manual);
    this.setMode(order[(cur + 1) % order.length]);
  }

  setMode(mode: 'auto' | QualityLevel): void {
    this.mode = mode;
    if (mode !== 'auto') this.manual = mode;
    this.auto = new Autoscaler(this.manual, 'high');
    this.apply(true);
  }

  observeFrame(frameDtMs: number): void {
    if (this.mode !== 'auto') return;
    if (this.auto.feed(frameDtMs)) this.apply(false);
  }

  private apply(force: boolean): void {
    const level = this.level;
    if (!force && level === this.lastApplied) return;
    this.lastApplied = level;
    this.onChange(level, QUALITY_PRESETS[level]);
  }
}
