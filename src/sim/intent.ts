// DriverIntent — the single input contract produced by every input source
// (keyboard now; hand gestures in M2; gamepad optional later). PLAN §4.

export interface DriverIntent {
  /** -1 = full left, +1 = full right */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
}
