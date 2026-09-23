// Tilt steering math (M15, ADR-015 era): hold the phone in landscape like a
// steering wheel and TURN it — the gyroscope orientation maps to the wheel.
// Pure functions so the exact formula is unit-tested; the phone page served
// by scripts/remote-relay.mjs embeds the same math verbatim (it is a
// standalone page and cannot import from src/ — keep them in sync).

const RAD = Math.PI / 180;

/**
 * Wheel-plane angle (deg) from deviceorientation beta/gamma (deg).
 * Holding the screen toward you like a wheel, turning the wheel rotates
 * gravity in the screen plane: θ = atan2(sin β, sin γ). Only RELATIVE
 * rotation matters — calibration absorbs any constant offset, so exact
 * sign conventions don't matter as long as this is consistent.
 */
export function orientationToWheel(betaDeg: number, gammaDeg: number): number {
  return (Math.atan2(Math.sin(betaDeg * RAD), Math.sin(gammaDeg * RAD)) * 180) / Math.PI;
}

/** Map a wheel angle to steer −1..1 around a calibrated zero, with clamping. */
export function wheelToSteer(
  wheelDeg: number,
  calibDeg: number,
  fullLockDeg = 95,
): number {
  const d = wheelDeg - calibDeg;
  // wrap into ±180 so calibrating upside-down still works
  const wrapped = d > 180 ? d - 360 : d < -180 ? d + 360 : d;
  return Math.max(-1, Math.min(1, wrapped / fullLockDeg));
}
