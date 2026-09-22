// Car visual (M1 placeholder quality — hero meshes land in M6):
// box body from tune dims/color, spring-damped body roll/pitch from the
// physics accel outputs, rolling + steering front wheels.
// Conventions: car faces −z; group.rotation.y = −heading (PILL 009).

import * as THREE from 'three';
import type { CarTune } from '../sim/car';

export interface CarPose {
  x: number;
  z: number;
  heading: number;
}

const WHEEL_R = 0.33;

export class CarView {
  readonly group = new THREE.Group();
  private bodyGroup = new THREE.Group();
  private frontPivots: THREE.Group[] = [];
  private wheelMeshes: THREE.Mesh[] = [];
  private roll = 0;
  private pitch = 0;
  private wheelSpin = 0;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  constructor(private tune: CarTune) {
    this.build();
  }

  private build(): void {
    const [w, h, l] = this.tune.bodyDims;
    const bodyGeo = new THREE.BoxGeometry(w, h * 0.55, l);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: this.tune.color,
      roughness: 0.32,
      metalness: 0.75,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.42 + h * 0.27;

    const cabinGeo = new THREE.BoxGeometry(w * 0.82, h * 0.4, l * 0.42);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x14181f,
      roughness: 0.14,
      metalness: 0.4,
    });
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 0.42 + h * 0.55 + h * 0.2, l * 0.06);

    this.bodyGroup.add(body, cabin);
    this.group.add(this.bodyGroup);

    const wheelGeo = new THREE.BoxGeometry(0.36, WHEEL_R * 2, WHEEL_R * 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x101013, roughness: 0.9 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * (w / 2 - 0.08), WHEEL_R, sz * (l / 2 - 0.75));
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        pivot.add(wheel);
        this.group.add(pivot);
        this.wheelMeshes.push(wheel);
        if (sz < 0) this.frontPivots.push(pivot); // front = −z
      }
    }
    this.geometries.push(bodyGeo, cabinGeo, wheelGeo);
    this.materials.push(bodyMat, cabinMat, wheelMat);
  }

  setTune(tune: CarTune): void {
    // rebuild on car switch (dev feature; M5 garage will do this properly)
    this.dispose(false);
    this.bodyGroup = new THREE.Group();
    this.frontPivots = [];
    this.wheelMeshes = [];
    this.tune = tune;
    this.build();
  }

  update(pose: CarPose, u: number, steer: number, ax: number, ay: number, dt: number): void {
    this.group.position.set(pose.x, 0, pose.z);
    this.group.rotation.y = -pose.heading;

    // spring-damped roll/pitch (lerp toward accel-derived targets)
    const rollT = Math.max(-0.09, Math.min(0.09, -ay * 0.0045));
    const pitchT = Math.max(-0.05, Math.min(0.05, ax * 0.004));
    this.roll += (rollT - this.roll) * Math.min(1, 6 * dt);
    this.pitch += (pitchT - this.pitch) * Math.min(1, 6 * dt);
    this.bodyGroup.rotation.z = this.roll;
    this.bodyGroup.rotation.x = this.pitch;

    // wheels: roll with speed; front pair steers with the road-wheel angle
    this.wheelSpin += (u / WHEEL_R) * dt;
    for (const wheel of this.wheelMeshes) wheel.rotation.x = this.wheelSpin;
    for (const pivot of this.frontPivots) pivot.rotation.y = -steer;
  }

  dispose(full = true): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = [];
    this.materials = [];
    if (full) this.group.clear();
  }
}
