// M0 placeholder vehicle: a deterministic kinematic "mule" used to validate the engine
// loop, scene, HUD and CI determinism before the real bicycle model lands in M1.
// Pure module: no DOM, no Three.js. The car travels toward -z (world x = screen right
// with the chase camera behind it at +z).

export interface DriverIntent {
  /** -1 = full left, +1 = full right */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
}

export interface VehicleTune {
  /** top speed, m/s */
  vMax: number;
  /** acceleration at full throttle, m/s^2 */
  accel: number;
  /** deceleration at full brake, m/s^2 */
  brakeDecel: number;
  /** rolling + engine braking above walking pace, m/s^2 */
  coastDecel: number;
  /** quadratic drag coefficient (1/m) */
  dragK: number;
  /** yaw authority at low speed, rad/s */
  steerRate: number;
  /** speed at which yaw authority halves, m/s */
  steerFade: number;
  /** |x| clamp — placeholder for real road boundaries, m */
  roadHalfWidth: number;
  /** heading clamp, rad */
  maxHeading: number;
}

export const MULE_TUNE: VehicleTune = {
  vMax: 94, // ~338 km/h — Falcone-class placeholder
  accel: 9.5,
  brakeDecel: 13,
  coastDecel: 0.6,
  dragK: 0.0009,
  steerRate: 2.2,
  steerFade: 22,
  roadHalfWidth: 9,
  maxHeading: 0.35,
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class PlaceholderVehicle {
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  /** total distance travelled, m (drives road texture scroll) */
  distance = 0;
  readonly tune: VehicleTune;

  constructor(tune: VehicleTune = MULE_TUNE) {
    this.tune = tune;
  }

  step(dt: number, intent: DriverIntent): void {
    const t = this.tune;
    const drag = t.dragK * this.speed * this.speed;
    // Coast decel applies all the way down to a stop; the clamp below absorbs the
    // final overshoot in one step (no sign oscillation around zero).
    const a = t.accel * intent.throttle - t.brakeDecel * intent.brake - t.coastDecel - drag;
    this.speed = clamp(this.speed + a * dt, 0, t.vMax);

    // Speed-sensitive steering: authority fades with speed; no turning while stopped.
    const authority = t.steerRate / (1 + this.speed / t.steerFade);
    const speedFactor = Math.min(1, this.speed / 6);
    this.heading = clamp(
      this.heading + intent.steer * authority * speedFactor * dt,
      -t.maxHeading,
      t.maxHeading,
    );

    this.x = clamp(
      this.x + Math.sin(this.heading) * this.speed * dt,
      -t.roadHalfWidth,
      t.roadHalfWidth,
    );
    this.z -= Math.cos(this.heading) * this.speed * dt;
    this.distance += this.speed * dt;
  }

  /**
   * Determinism probe: FNV-1a over the IEEE-754 bits of the state.
   * Dev/test use only (allocates) — never called in the hot path.
   */
  hash(): string {
    const buf = new Float64Array(1);
    const view = new DataView(buf.buffer);
    let h = 0x811c9dc5;
    for (const v of [this.x, this.z, this.heading, this.speed, this.distance]) {
      buf[0] = v;
      view.setFloat64(0, v);
      for (let i = 0; i < 8; i++) {
        h ^= view.getUint8(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    }
    return h.toString(16).padStart(8, '0');
  }
}
