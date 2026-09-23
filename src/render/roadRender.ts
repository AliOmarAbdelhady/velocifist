// RoadRibbon (PLAN §10.1, M4): the streamed road surface. One preallocated
// BufferGeometry covering the visible window (~880 m) — positions rewritten
// from the spine each frame (interpolated sample lookups only, no trig in
// the hot path), UVs pinning the asphalt pattern to world arclength. Lane
// markings live in a dual-variant cross-section texture (u selects the
// same-direction or oncoming layout), so zone changes are pure UV math.
// Guardrails are one InstancedMesh of 4.4 m segments following the spine.
//
// Draw cost: 2 calls total (ribbon + rails). Build cost per frame: ~1k vertex
// writes — well under budget; sim-side chunk generation is the ≤2 ms gate.

import * as THREE from 'three';
import { RoadSystem, CHUNK_LEN, type SpinePoint } from '../sim/road';

const ROW_STEP = 8;
const BEHIND = 140;
const AHEAD = 920;
const MAX_ROWS = 176; // 132 base rows + zone-boundary duplicates + slack
const COLS = 5; // lat: [-E, -R, 0, +R, +E]
const RAIL_SEG = 4.4;
const RAIL_POOL = 520; // (920+140)/4.4 × 2 sides + slack
const POST_SEG = 24; // delineator spacing (ADR-016 readability)
const POST_POOL = 96;
const Y = 0.02;

// reused (no per-frame allocation)
const FWD = new THREE.Vector3(0, 0, -1);
const ONE = new THREE.Vector3(1, 1, 1);

export interface RoadLook {
  asphaltTint: number;
  roughness: number;
  metalness: number;
  railColor: number;
}

export function makeMarkingsTexture(): THREE.CanvasTexture {
  // 512×128: two cross-section variants side by side (same-dir | oncoming).
  // Drawn bright-on-dark so material.color tints per theme.
  // ADR-016 readability: brighter/wider edge lines, longer dashes, less
  // speckle — the lines must read at 200 km/h from 400 m out.
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;

  for (let variant = 0; variant < 2; variant++) {
    const ox = variant * 256;
    // asphalt-ish noise (luminance only — tinted by the material colour)
    g.fillStyle = '#5e5e5e';
    g.fillRect(ox, 0, 256, 128);
    for (let i = 0; i < 550; i++) {
      const v = 92 + Math.floor(Math.random() * 26);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(ox + Math.random() * 256, Math.random() * 128, 2, 2);
    }
    // gravel shoulders (outer 3 m each side of the 30 m band)
    g.fillStyle = '#48443c';
    g.fillRect(ox, 0, 26, 128);
    g.fillRect(ox + 230, 0, 26, 128);

    const line = (lat: number, w: number, color: string, dash?: [number, number]): void => {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.setLineDash(dash ? [dash[0] * (128 / 24), dash[1] * (128 / 24)] : []);
      const x = ox + ((lat + 15) / 30) * 256;
      g.beginPath();
      g.moveTo(x, -2);
      g.lineTo(x, 130);
      g.stroke();
      g.setLineDash([]);
    };
    // solid edge lines (bright + wide: they must survive the theme tint multiply)
    line(-12, 6.5, '#ffffff');
    line(12, 6.5, '#ffffff');
    // internal lane boundaries: long dashes (4 m on / 8 m off — reads at speed)
    line(-6, 5, '#ffffff', [4, 8]);
    line(6, 5, '#ffffff', [4, 8]);
    // centre line: white dashes (same-dir) or double yellow (oncoming ×2)
    if (variant === 0) {
      line(0, 4.5, '#ffffff', [4, 8]);
    } else {
      line(-0.4, 3.5, '#ffe14d');
      line(0.4, 3.5, '#ffe14d');
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class RoadRibbon {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly positions: Float32Array;
  private readonly uvs: Float32Array;
  private readonly rails: THREE.InstancedMesh;
  private readonly posts: THREE.InstancedMesh;
  private readonly reflectors: THREE.InstancedMesh;
  private readonly railMat: THREE.MeshStandardMaterial;
  private readonly postMat: THREE.MeshStandardMaterial;
  private readonly reflMat: THREE.MeshStandardMaterial;
  private readonly roadMat: THREE.MeshStandardMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly posV = new THREE.Vector3();
  private readonly dirV = new THREE.Vector3();
  private readonly sp: SpinePoint = { x: 0, z: 0, heading: 0 };
  private lastRailCenter = Number.NaN;
  private lastPostCenter = Number.NaN;
  private E = 15;

  constructor(look: RoadLook, maxAniso: number) {
    this.geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX_ROWS * COLS * 3);
    this.uvs = new Float32Array(MAX_ROWS * COLS * 2);
    const normals = new Float32Array(MAX_ROWS * COLS * 3);
    for (let i = 0; i < normals.length; i += 3) {
      normals[i + 1] = 1;
    }
    const index = new Uint16Array((MAX_ROWS - 1) * 4 * 6);
    let k = 0;
    for (let r = 0; r < MAX_ROWS - 1; r++) {
      for (let cIdx = 0; cIdx < COLS - 1; cIdx++) {
        const a = r * COLS + cIdx;
        const b = a + 1;
        const d = a + COLS;
        const e = d + 1;
        index[k++] = a; index[k++] = d; index[k++] = b;
        index[k++] = b; index[k++] = d; index[k++] = e;
      }
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(new THREE.BufferAttribute(index, 1));

    const tex = makeMarkingsTexture();
    tex.anisotropy = maxAniso;
    this.roadMat = new THREE.MeshStandardMaterial({
      map: tex,
      color: look.asphaltTint,
      roughness: look.roughness,
      metalness: look.metalness,
    });
    this.mesh = new THREE.Mesh(this.geo, this.roadMat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    this.railMat = new THREE.MeshStandardMaterial({
      color: look.railColor,
      roughness: 0.45,
      metalness: 0.55,
    });
    this.rails = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.7, RAIL_SEG),
      this.railMat,
      RAIL_POOL,
    );
    this.rails.frustumCulled = false;
    this.rails.count = 0;
    this.group.add(this.rails);

    // ADR-016 readability: delineator posts every 24 m on both shoulders —
    // white post + amber reflector band. Classic highway cue: they give the
    // eye a rhythm that makes the road edge read long before the rail does.
    this.postMat = new THREE.MeshStandardMaterial({
      color: 0xe8e8e6,
      roughness: 0.7,
      metalness: 0.0,
    });
    this.posts = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.09, 1.0, 0.09),
      this.postMat,
      POST_POOL,
    );
    this.posts.frustumCulled = false;
    this.posts.count = 0;
    this.group.add(this.posts);
    this.reflMat = new THREE.MeshStandardMaterial({
      color: 0x281500,
      emissive: 0xffb01f,
      emissiveIntensity: 1.4,
      roughness: 0.4,
    });
    this.reflectors = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.1, 0.13, 0.1),
      this.reflMat,
      POST_POOL,
    );
    this.reflectors.frustumCulled = false;
    this.reflectors.count = 0;
    this.group.add(this.reflectors);
    this.lastPostCenter = Number.NaN;
  }

  setLook(look: RoadLook): void {
    this.roadMat.color.setHex(look.asphaltTint);
    this.roadMat.roughness = look.roughness;
    this.roadMat.metalness = look.metalness;
    this.railMat.color.setHex(look.railColor);
  }

  update(road: RoadSystem, pS: number): void {
    const half = road.roadHalf;
    this.E = half + 3;
    const lats: number[] = [-this.E, -half, 0, half, this.E];

    const s0 = Math.max(0, pS - BEHIND);
    const s1 = pS + AHEAD;
    road.ensureTo(s1 + 64);

    // rows: 8 m grid + doubled rows at oncoming-zone boundaries (crisp u switch)
    let rows = 0;
    const pushRow = (s: number, variant: number): void => {
      if (rows >= MAX_ROWS) return;
      road.sample(s, this.sp);
      const rx = Math.cos(this.sp.heading);
      const rz = Math.sin(this.sp.heading);
      const base = rows * COLS;
      for (let c = 0; c < COLS; c++) {
        const lat = lats[c];
        this.positions[(base + c) * 3] = this.sp.x + rx * lat;
        this.positions[(base + c) * 3 + 1] = Y;
        this.positions[(base + c) * 3 + 2] = this.sp.z + rz * lat;
        this.uvs[(base + c) * 2] = (variant + (lat + this.E) / (2 * this.E)) / 2;
        this.uvs[(base + c) * 2 + 1] = (s / ROW_STEP) % 1;
      }
      rows++;
    };
    const variantAt = (s: number): number => (road.oncomingAt(s) > 0 ? 1 : 0);

    // boundary list inside the window
    const firstC = Math.floor(s0 / CHUNK_LEN);
    const lastC = Math.floor(s1 / CHUNK_LEN) + 1;
    const boundaries: number[] = [];
    for (let ci = firstC; ci <= lastC; ci++) {
      const b = ci * CHUNK_LEN;
      if (b <= s0 || b >= s1) continue;
      if (variantAt(b - 2) !== variantAt(b + 2)) boundaries.push(b);
    }

    let prevVariant = variantAt(s0);
    let bi = 0;
    for (let s = s0; s <= s1 && rows < MAX_ROWS - 1; s += ROW_STEP) {
      while (bi < boundaries.length && boundaries[bi] < s) bi++;
      if (bi < boundaries.length && boundaries[bi] >= s && boundaries[bi] < s + ROW_STEP) {
        const b = boundaries[bi];
        pushRow(b, prevVariant);
        pushRow(b, variantAt(b + 2));
        prevVariant = variantAt(b + 2);
        bi++;
        s = b; // continue the grid from the boundary
        continue;
      }
      pushRow(s, prevVariant);
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, (rows - 1) * 4 * 6));
    this.geo.computeBoundingSphere(); // keep culling honest (frustumCulled off anyway)

    this.updateRails(road, pS, half);
    this.updatePosts(road, pS, half);
  }

  /** Delineators: white post (base y 0..1.0) + reflector band at 0.86. */
  private updatePosts(road: RoadSystem, pS: number, half: number): void {
    const center = Math.round(pS / POST_SEG);
    if (center === this.lastPostCenter) return;
    this.lastPostCenter = center;
    const from = Math.max(0, pS - BEHIND);
    const to = pS + AHEAD;
    let n = 0;
    for (const side of [-1, 1]) {
      for (let s = from; s < to && n < POST_POOL; s += POST_SEG) {
        road.sample(s, this.sp);
        const rx = Math.cos(this.sp.heading);
        const rz = Math.sin(this.sp.heading);
        const px = this.sp.x + rx * side * (half + 1.35);
        const pz = this.sp.z + rz * side * (half + 1.35);
        this.posV.set(px, 0.5, pz);
        this.q.identity();
        this.m.compose(this.posV, this.q, ONE);
        this.posts.setMatrixAt(n, this.m);
        this.posV.set(px, 0.86, pz);
        this.m.compose(this.posV, this.q, ONE);
        this.reflectors.setMatrixAt(n, this.m);
        n++;
      }
    }
    this.posts.count = n;
    this.reflectors.count = n;
    this.posts.instanceMatrix.needsUpdate = true;
    this.reflectors.instanceMatrix.needsUpdate = true;
  }

  private updateRails(road: RoadSystem, pS: number, half: number): void {
    const center = Math.round(pS / RAIL_SEG);
    if (center === this.lastRailCenter) return;
    this.lastRailCenter = center;
    const from = Math.max(0, pS - BEHIND);
    const to = pS + AHEAD;
    let n = 0;
    for (const side of [-1, 1]) {
      for (let s = from; s < to && n < RAIL_POOL; s += RAIL_SEG) {
        road.sample(s + RAIL_SEG / 2, this.sp);
        const rx = Math.cos(this.sp.heading);
        const rz = Math.sin(this.sp.heading);
        this.posV.set(this.sp.x + rx * side * (half + 0.55), 0.55, this.sp.z + rz * side * (half + 0.55));
        this.dirV.set(Math.sin(this.sp.heading), 0, -Math.cos(this.sp.heading));
        this.q.setFromUnitVectors(FWD, this.dirV);
        this.m.compose(this.posV, this.q, ONE);
        this.rails.setMatrixAt(n++, this.m);
      }
    }
    this.rails.count = n;
    this.rails.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.rails.geometry.dispose();
    this.railMat.dispose();
    this.posts.geometry.dispose();
    this.postMat.dispose();
    this.reflectors.geometry.dispose();
    this.reflMat.dispose();
  }
}
