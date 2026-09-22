// Chase camera rig (PLAN §7): spring-arm with speed-scaled stiffness, look-ahead
// biased into the steer, dynamic FOV (NFS recipe: low base + wide with speed),
// micro-shake ∝ v² (respects prefers-reduced-motion). Modes: CHASE / HOOD / FAR.
// Zero allocations per frame — all vectors are preallocated scratch.

import * as THREE from 'three';

export const CAM_MODES = ['CHASE', 'HOOD', 'FAR'] as const;

export interface RigInput {
  x: number;
  z: number;
  heading: number;
  u: number;
  steer: number;
  ayLast: number;
}

const _anchor = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

export class CameraRig {
  mode = 0; // index into CAM_MODES
  private readonly pos = new THREE.Vector3(0, 3.2, 8);
  private readonly vel = new THREE.Vector3();
  private readonly look = new THREE.Vector3(0, 1, -20);
  private shakeT = 0;
  private readonly reduced: boolean;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.reduced =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  cycle(): void {
    this.mode = (this.mode + 1) % CAM_MODES.length;
    // reset spring velocity so the rig glides to the new mount instead of whipping
    this.vel.set(0, 0, 0);
  }

  /** Floating-origin shift (M4): translate internal world-frame state by +dz. */
  rebase(dz: number): void {
    this.pos.z += dz;
    this.look.z += dz;
  }

  update(dt: number, c: RigInput, vMax: number): void {
    // The spring is only stable for steps ≲ 2/ω (ω up to 12 ⇒ ~17 ms).
    // Slow frames (background tab, hitch, weak GPU) would fling the rig —
    // substep the integration so the camera survives any frame rate.
    const steps = Math.max(1, Math.min(8, Math.ceil(dt / 0.033)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.substep(h, c, vMax);
    this.finish(dt, c, vMax);
  }

  private substep(dt: number, c: RigInput, vMax: number): void {
    const speedFrac = Math.min(Math.abs(c.u) / vMax, 1);
    const sinH = Math.sin(c.heading);
    const cosH = Math.cos(c.heading);
    _fwd.set(sinH, 0, -cosH);

    if (this.mode === 1) {
      // HOOD: rigid mount, slightly ahead of the cabin
      this.pos.set(c.x, 0, c.z).addScaledVector(_fwd, 0.5);
      this.pos.y = 1.12;
      this.vel.set(0, 0, 0);
    } else {
      // CHASE / FAR: spring arm (critically damped, stiffness grows with speed)
      const back = this.mode === 0 ? 6.5 + 0.8 * speedFrac : 11;
      const up = this.mode === 0 ? 2.8 : 4.6;
      const omega = this.mode === 0 ? 3.2 + 8.8 * speedFrac : 2.2 + 3.0 * speedFrac;
      _anchor.set(c.x, 0, c.z).addScaledVector(_fwd, -back);
      _anchor.y = up;
      const k = omega * omega;
      const cd = 2 * omega; // critical damping
      this.vel.addScaledVector(_anchor.sub(this.pos), k * dt);
      this.vel.multiplyScalar(Math.max(0, 1 - cd * dt));
      this.pos.addScaledVector(this.vel, dt);
    }
  }

  /** Look target, micro-shake and FOV run once per frame (not per substep). */
  private finish(dt: number, c: RigInput, vMax: number): void {
    const speedFrac = Math.min(Math.abs(c.u) / vMax, 1);
    const sinH = Math.sin(c.heading);
    const cosH = Math.cos(c.heading);
    _fwd.set(sinH, 0, -cosH);
    _right.set(cosH, 0, sinH);

    // look-ahead, biased into the steer direction (12% of the lookahead)
    const lookAhead = 4 + 0.04 * Math.abs(c.u);
    _lookTarget.set(c.x, 0, c.z).addScaledVector(_fwd, lookAhead);
    _lookTarget.addScaledVector(_right, lookAhead * 0.12 * Math.max(-1, Math.min(1, c.steer * 5)));
    _lookTarget.y = 1.1;
    this.look.lerp(_lookTarget, Math.min(1, 10 * dt));

    // micro-shake ∝ v² — sells the speed without nausea
    this.shakeT += dt * (7 + 9 * speedFrac);
    let sx = 0;
    let sy = 0;
    if (!this.reduced && this.mode !== 1) {
      const amp = 0.02 * speedFrac * speedFrac;
      sx = amp * (Math.sin(this.shakeT * 1.1) + 0.5 * Math.sin(this.shakeT * 2.3 + 1.7));
      sy = amp * (Math.sin(this.shakeT * 1.7 + 0.9) + 0.5 * Math.sin(this.shakeT * 2.9 + 2.4));
    }

    this.camera.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
    this.camera.lookAt(this.look);
    const baseFov = this.mode === 1 ? 56 : 50;
    const fovSpan = this.mode === 1 ? 24 : 28;
    this.camera.fov = baseFov + fovSpan * speedFrac;
    this.camera.updateProjectionMatrix();
  }
}
