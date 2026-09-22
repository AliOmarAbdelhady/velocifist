// Input arbiter (PLAN §5.8, M7 robustness rework): merges hand-gesture intent
// with the keyboard fallback. Keyboard wins while actively used (it is also
// the accessibility and camera-failure path); hands win whenever they are
// plausibly tracked.
//
// M7: raw confidence is EMA-smoothed and gated with HYSTERESIS — a flickery
// frame no longer hard-cuts the hand intent to zero. Between the drop
// threshold and the hold timeout the solver's own graceful degradation
// (auto-hold brake, steering decay) drives the car; only a sustained loss
// falls through to NONE. This is what makes dropouts feel like the car
// calmly holding instead of lurching.

import type { DriverIntent } from '../sim/intent';

export type InputSource = 'HANDS' | 'KEYS' | 'NONE';

export interface ArbiterConfig {
  /** EMA factor for hand confidence (per update) */
  confEma: number;
  /** smoothed confidence to (re)enter HANDS */
  enterConf: number;
  /** smoothed confidence below which hands are considered lost */
  dropConf: number;
  /** how long below dropConf before giving up on hands entirely (s) */
  holdGraceSec: number;
}

export const DEFAULT_ARBITER_CONFIG: ArbiterConfig = {
  confEma: 0.25,
  enterConf: 0.45,
  dropConf: 0.25,
  holdGraceSec: 0.8,
};

export class InputArbiter {
  readonly intent: DriverIntent = { steer: 0, throttle: 0, brake: 0 };
  source: InputSource = 'NONE';
  /** smoothed hand confidence 0..1 (AR glow can read it) */
  confSmooth = 0;
  /** seconds since hands were last confidently tracked (Infinity if never) */
  handsGoodAgeSec = Infinity;

  private cfg: ArbiterConfig;
  private lastKeyActivity = -1e9;
  private lastHandGood = -1e9;
  private usingHands = false;

  constructor(cfg: Partial<ArbiterConfig> = {}) {
    this.cfg = { ...DEFAULT_ARBITER_CONFIG, ...cfg };
  }

  update(
    handIntent: DriverIntent | null,
    handConfidence: number,
    keyboardIntent: DriverIntent,
    t: number,
  ): DriverIntent {
    this.confSmooth =
      this.confSmooth * (1 - this.cfg.confEma) + handConfidence * this.cfg.confEma;

    const kbActive =
      keyboardIntent.steer !== 0 || keyboardIntent.throttle !== 0 || keyboardIntent.brake !== 0;
    if (kbActive) this.lastKeyActivity = t;
    const kbRecent = t - this.lastKeyActivity < 1.0;

    if (this.confSmooth >= this.cfg.enterConf) {
      this.usingHands = true;
      this.lastHandGood = t;
    } else if (this.confSmooth < this.cfg.dropConf) {
      if (t - this.lastHandGood > this.cfg.holdGraceSec) this.usingHands = false;
    } else {
      // inside the hysteresis band: keep the current verdict
      if (this.usingHands) this.lastHandGood = t;
    }
    this.handsGoodAgeSec = this.lastHandGood < -1e8 ? Infinity : t - this.lastHandGood;

    if (kbRecent) {
      this.source = 'KEYS';
      copyInto(this.intent, keyboardIntent);
    } else if (handIntent && this.usingHands) {
      this.source = 'HANDS';
      copyInto(this.intent, handIntent);
    } else {
      this.source = 'NONE';
      this.intent.steer = 0;
      this.intent.throttle = 0;
      this.intent.brake = 0;
    }
    return this.intent;
  }
}

function copyInto(dst: DriverIntent, src: DriverIntent): void {
  dst.steer = src.steer;
  dst.throttle = src.throttle;
  dst.brake = src.brake;
}
