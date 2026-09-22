// Construction zones (M4): cone lines placed from the road's chunk features
// (the same deterministic stream the sim uses). Cones sit on the blocked
// lane's inner edge with a staggered warning taper before the zone; the car
// can scatter them (small speed scrub, cone drops) — visual targets with
// just enough consequence to read as real. One InstancedMesh, pooled,
// rewritten only when the visible chunk window changes.

import * as THREE from 'three';
import { RoadSystem, CHUNK_LEN, type Projection } from '../sim/road';
import type { Car } from '../sim/car';

const POOL = 192;
const BEHIND = 60;
const AHEAD = 760;
const CONE_STEP = 8;

export class Cones {
  private readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly proj: Projection = { s: 0, lat: 0 };
  private readonly coneS = new Float64Array(POOL);
  private readonly coneLat = new Float64Array(POOL);
  private readonly down = new Uint8Array(POOL);
  private n = 0;
  private firstChunk = Number.NaN;

  constructor() {
    const geo = new THREE.ConeGeometry(0.28, 0.62, 10);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.7 });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  get object(): THREE.Object3D {
    return this.mesh;
  }

  /** Returns cones knocked over by the car this frame (score/FX hook). */
  update(road: RoadSystem, pS: number, car: Car): number {
    const fc = Math.floor((pS - BEHIND) / CHUNK_LEN);
    if (fc !== this.firstChunk) {
      this.firstChunk = fc;
      this.rebuild(road, fc, Math.floor((pS + AHEAD) / CHUNK_LEN));
    }
    return this.checkCar(road, car);
  }

  private rebuild(road: RoadSystem, fc: number, lc: number): void {
    this.n = 0;
    this.down.fill(0);
    for (let ci = Math.max(0, fc); ci <= lc && this.n < POOL - 6; ci++) {
      const f = road.chunkFeature(ci);
      if (!f.construction) continue;
      const base = ci * CHUNK_LEN;
      const lane = road.blockedLaneOf(ci);
      const lat = road.laneLat(lane) + (lane < road.laneCount / 2 ? 3.4 : -3.4);
      // warning taper: 3 staggered cones before the zone mouth
      for (let k = 0; k < 3; k++) {
        this.place(road, base - 26 + k * 8, lat + (3.4 - k * 1.1) * (lane < road.laneCount / 2 ? -1 : 1));
      }
      for (let s = base + 2; s < base + CHUNK_LEN && this.n < POOL; s += CONE_STEP) {
        this.place(road, s, lat);
      }
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private place(road: RoadSystem, s: number, lat: number): void {
    if (this.n >= POOL) return;
    const sp = { x: 0, z: 0, heading: 0 };
    road.sample(s, sp);
    const rx = Math.cos(sp.heading);
    const rz = Math.sin(sp.heading);
    this.coneS[this.n] = s;
    this.coneLat[this.n] = lat;
    this.m.makeTranslation(sp.x + rx * lat, 0.31, sp.z + rz * lat);
    this.mesh.setMatrixAt(this.n, this.m);
    this.n++;
  }

  private checkCar(road: RoadSystem, car: Car): number {
    if (this.n === 0) return 0;
    road.project(car.x, car.z, this.proj);
    let hits = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.down[i]) continue;
      if (Math.abs(this.coneS[i] - this.proj.s) > 1.4) continue;
      if (Math.abs(this.coneLat[i] - this.proj.lat) > 1.4) continue;
      this.down[i] = 1;
      hits++;
      car.u *= 0.992; // scatter cost — a brush, not a crash
      this.m.makeTranslation(0, -50, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
    if (hits > 0) this.mesh.instanceMatrix.needsUpdate = true;
    return hits;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
