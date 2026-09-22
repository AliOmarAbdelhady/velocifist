// Input arbiter (PLAN §5.8): merges hand-gesture intent with the keyboard
// fallback. Keyboard wins while actively used (it is also the accessibility
// and camera-failure path); hands win whenever they are confidently tracked.

import type { DriverIntent } from '../sim/intent';

export type InputSource = 'HANDS' | 'KEYS' | 'NONE';

export class InputArbiter {
  readonly intent: DriverIntent = { steer: 0, throttle: 0, brake: 0 };
  source: InputSource = 'NONE';
  private lastKeyActivity = -1e9;

  update(
    handIntent: DriverIntent | null,
    handConfidence: number,
    keyboardIntent: DriverIntent,
    t: number,
  ): DriverIntent {
    const kbActive =
      keyboardIntent.steer !== 0 || keyboardIntent.throttle !== 0 || keyboardIntent.brake !== 0;
    if (kbActive) this.lastKeyActivity = t;
    const kbRecent = t - this.lastKeyActivity < 1.0;

    if (kbRecent) {
      this.source = 'KEYS';
      copyInto(this.intent, keyboardIntent);
    } else if (handIntent && handConfidence > 0.5) {
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
