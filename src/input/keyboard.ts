// Keyboard fallback controller — permanent accessibility/dev input (PLAN §5.8).
// Produces a reused DriverIntent object; the arbiter reads it by reference.

import type { DriverIntent } from '../sim/intent';

export interface KeyboardController {
  /** Live intent (reused object — copy fields if you need to keep it). */
  readonly intent: DriverIntent;
  /** Call once per sim step; ramps steering toward the pressed direction. */
  update(dt: number): void;
  dispose(): void;
}

const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function createKeyboard(): KeyboardController {
  const down = new Set<string>();
  const intent: DriverIntent = { steer: 0, throttle: 0, brake: 0 };
  let steerTarget = 0;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (PREVENT.has(e.code)) e.preventDefault();
    down.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
  };
  const onBlur = (): void => down.clear();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    intent,
    update(dt: number) {
      intent.throttle = down.has('KeyW') || down.has('ArrowUp') ? 1 : 0;
      intent.brake =
        down.has('KeyS') || down.has('ArrowDown') || down.has('Space') ? 1 : 0;
      steerTarget =
        (down.has('KeyA') || down.has('ArrowLeft') ? -1 : 0) +
        (down.has('KeyD') || down.has('ArrowRight') ? 1 : 0);
      // Press: 4.5/s toward target; release/return: 6/s (snappier centering).
      const rate = steerTarget === 0 ? 6 : 4.5;
      const d = steerTarget - intent.steer;
      const maxStep = rate * dt;
      intent.steer =
        Math.abs(d) <= maxStep ? steerTarget : intent.steer + Math.sign(d) * maxStep;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
