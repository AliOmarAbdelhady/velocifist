// Instanced traffic rendering (PLAN §8): one InstancedMesh per family
// (merged 2-box silhouettes), per-instance paint via instanceColor, blinker
// tint while signalling/changing lanes. ~7 draw calls for the whole fleet.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FAMILIES, type TrafficAgent } from '../sim/trafficTypes';

const PAINTS = [0xdfe3e8, 0xb9bfc7, 0x22262b, 0x8e2323, 0x2b4a7e, 0x6d7378];
const CAPS = [10, 10, 6, 6, 6, 4, 4];
const HEIGHTS = [1.35, 1.4, 1.1, 1.7, 1.95, 2.8, 2.5];

export class TrafficRenderer {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly yellow = new THREE.Color(0xffc23d);

  constructor() {
    for (let f = 0; f < FAMILIES.length; f++) {
      const fam = FAMILIES[f];
      const body = new THREE.BoxGeometry(fam.halfW * 2, HEIGHTS[f] * 0.62, fam.halfL * 2);
      body.translate(0, HEIGHTS[f] * 0.31 + 0.18, 0);
      const cabin = new THREE.BoxGeometry(fam.halfW * 1.7, HEIGHTS[f] * 0.38, fam.halfL * 0.5);
      cabin.translate(0, HEIGHTS[f] * 0.62 + 0.24, fam.halfL * 0.18);
      const geo = mergeGeometries([body, cabin])!;
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.35 });
      const mesh = new THREE.InstancedMesh(geo, mat, CAPS[f]);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }

  sync(agents: readonly TrafficAgent[], timeSec: number): void {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const blink = Math.sin(timeSec * 8) > 0;
    for (const a of agents) {
      if (!a.active) continue;
      const mesh = this.meshes[a.family];
      const n = counts[a.family];
      if (n >= CAPS[a.family]) continue;
      this.m.makeRotationY(-a.heading);
      this.m.setPosition(a.x, 0, a.z);
      mesh.setMatrixAt(n, this.m);
      const signalling = a.signal !== 0;
      this.color.setHex(PAINTS[a.paint % PAINTS.length]);
      if (signalling && blink) this.color.lerp(this.yellow, 0.7);
      mesh.setColorAt(n, this.color);
      counts[a.family] = n + 1;
    }
    for (let f = 0; f < this.meshes.length; f++) {
      const mesh = this.meshes[f];
      if (mesh.count !== counts[f] || counts[f] > 0) {
        mesh.count = counts[f];
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
