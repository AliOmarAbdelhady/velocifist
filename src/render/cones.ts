// Slalom cone course (M1 feel-testing target): deterministic, seeded, stateless
// per slot (hashRng) so any window of the course can be generated in any order.
// One InstancedMesh draw call. Pooled; instance matrices rewritten only when the
// active slot window changes. Collision arrives in M3 — visual targets for now.

import * as THREE from 'three';
import { hashRng } from '../sim/rng';

const SPACING = 28; // m between slots
const POOL = 56;
const AHEAD = 340;
const BEHIND = 50;

interface SlotLayout {
  count: 1 | 2;
  xs: [number, number];
}

function slotLayout(i: number): SlotLayout {
  if (i < 3) return { count: 1, xs: [0, 0] }; // clean start zone
  if (i % 9 === 0) return { count: 2, xs: [-3.4, 3.4] }; // gate
  const r = hashRng(i);
  if (r < 0.18) return { count: 1, xs: [0, 0] }; // center cone
  return { count: 1, xs: [3.4 * (i % 2 === 0 ? -1 : 1), 0] }; // alternating slalom
}

export class Cones {
  private readonly mesh: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4(); // reused — rewrite path is rare but hot-adjacent
  private firstSlot = Number.NaN;

  constructor() {
    const geo = new THREE.ConeGeometry(0.28, 0.62, 10);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.7 });
    this.mesh = new THREE.InstancedMesh(geo, mat, POOL);
    this.mesh.frustumCulled = false; // instances span a moving window
    this.mesh.count = 0;
  }

  get object(): THREE.Object3D {
    return this.mesh;
  }

  update(carZ: number): void {
    const first = Math.floor((carZ - BEHIND) / SPACING);
    if (first === this.firstSlot) return;
    this.firstSlot = first;

    const m = this.m;
    let n = 0;
    for (let i = first; n < POOL; i++) {
      const layout = slotLayout(i);
      for (let k = 0; k < layout.count && n < POOL; k++) {
        m.makeTranslation(layout.xs[k], 0.31, i * SPACING);
        this.mesh.setMatrixAt(n, m);
        n++;
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
