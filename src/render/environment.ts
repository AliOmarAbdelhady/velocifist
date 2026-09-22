// EnvironmentRenderer (PLAN §10.2, M4): the three launch themes. Each theme
// owns a sky shader (3-stop gradient + sun disc/glow + procedural stars),
// matched fog + a two-light rig, a follow ground plane (plus ocean for the
// coast), and 2–3 instanced prop pools placed deterministically from chunk
// seeds (the same chunk stream the sim uses — renderer reads, never writes).
//
// TOD/weather variants are data on the theme struct (M6/M7 extend); the
// launch set is each theme's signature look: Coastal Sunset, Neon Night,
// Desert Noon. ~10 draw calls total.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoadSystem, CHUNK_LEN, type SpinePoint, type ThemeId } from '../sim/road';
import { hashRng } from '../sim/rng';
import type { RoadLook } from './roadRender';

export interface ThemeDef {
  id: ThemeId;
  name: string;
  sky: {
    horizon: number;
    mid: number;
    zenith: number;
    sunDir: [number, number, number];
    sunColor: number;
    sunI: number;
    stars: boolean;
  };
  fog: { color: number; near: number; far: number };
  hemi: { sky: number; ground: number; intensity: number };
  sun: { color: number; intensity: number };
  ground: number;
  water?: number;
  road: RoadLook;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  coastal: {
    id: 'coastal',
    name: 'Coastal Sunset Highway',
    sky: { horizon: 0xffb06e, mid: 0x9a6b8f, zenith: 0x35406e, sunDir: [-0.62, 0.17, -0.72], sunColor: 0xffd9a8, sunI: 1.0, stars: false },
    fog: { color: 0xf2b48a, near: 90, far: 430 },
    hemi: { sky: 0xffd0a8, ground: 0x54455e, intensity: 0.85 },
    sun: { color: 0xffc98a, intensity: 2.1 },
    ground: 0x5b4a4a,
    water: 0x1d5568,
    road: { asphaltTint: 0x8a8078, roughness: 0.9, metalness: 0.0, railColor: 0x8a8478 },
  },
  neon: {
    id: 'neon',
    name: 'Neon Night City',
    sky: { horizon: 0x2b1e4d, mid: 0x131a33, zenith: 0x05060f, sunDir: [0.3, 0.55, -0.4], sunColor: 0xcfe0ff, sunI: 0.3, stars: true },
    fog: { color: 0x0d1024, near: 40, far: 360 },
    hemi: { sky: 0x33406e, ground: 0x1a1030, intensity: 0.5 },
    sun: { color: 0xb9c8ff, intensity: 0.5 },
    ground: 0x10131f,
    road: { asphaltTint: 0x9aa4c0, roughness: 0.38, metalness: 0.12, railColor: 0x74808f },
  },
  desert: {
    id: 'desert',
    name: 'Desert Canyon Pass',
    sky: { horizon: 0xe8d9a8, mid: 0x7fb2e6, zenith: 0x3f7fd6, sunDir: [0.25, 0.9, -0.35], sunColor: 0xfffbe8, sunI: 1.2, stars: false },
    fog: { color: 0xe6d7b0, near: 110, far: 470 },
    hemi: { sky: 0xcfe4ff, ground: 0xa8895f, intensity: 1.0 },
    sun: { color: 0xfff3d0, intensity: 2.6 },
    ground: 0xc9a86a,
    road: { asphaltTint: 0x9a8f80, roughness: 0.95, metalness: 0.0, railColor: 0xb7bcc4 },
  },
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uMid;
uniform vec3 uZenith;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunI;
uniform float uStars;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, h));
  col = mix(col, uZenith, smoothstep(0.18, 0.65, h));
  col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));
  float sd = dot(d, normalize(uSunDir));
  col += uSunColor * uSunI * 3.0 * pow(max(sd, 0.0), 600.0);
  col += uSunColor * uSunI * 0.35 * pow(max(sd, 0.0), 24.0);
  if (uStars > 0.5) {
    vec3 cell = floor(d * 160.0);
    float hsh = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    col += vec3(step(0.9985, hsh)) * smoothstep(0.08, 0.35, h) * 0.85;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------- geometry

function colored(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function palmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.13, 0.24, 4.4, 6);
  trunk.translate(0, 2.2, 0);
  parts.push(colored(trunk, 0x6b4f3a));
  for (let i = 0; i < 5; i++) {
    const frond = new THREE.ConeGeometry(0.38, 2.3, 4);
    frond.scale(1, 0.26, 1);
    frond.translate(0, 0.3, 0);
    frond.rotateX(-1.05);
    frond.rotateY((i / 5) * Math.PI * 2);
    frond.translate(0, 4.3, 0);
    parts.push(colored(frond, i % 2 === 0 ? 0x3f7a4f : 0x4c8a58));
  }
  return mergeGeometries(parts)!;
}

function rockGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1.6, 0.85, 1.25);
  return colored(g, 0x8f8378);
}

function mesaGeometry(): THREE.BufferGeometry {
  const top = new THREE.CylinderGeometry(0.62, 1.0, 1.0, 7);
  top.translate(0, 0.5, 0);
  const cap = new THREE.CylinderGeometry(0.6, 0.62, 0.1, 7);
  cap.translate(0, 1.0, 0);
  return mergeGeometries([colored(top, 0xb5764a), colored(cap, 0xc98a5e)])!;
}

function cactusGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.28, 0.34, 2.7, 7);
  trunk.translate(0, 1.35, 0);
  parts.push(colored(trunk, 0x4f7a3f));
  for (const side of [-1, 1]) {
    const arm = new THREE.CylinderGeometry(0.15, 0.17, 1.1, 6);
    arm.translate(0, 0.55, 0);
    arm.rotateZ(side * Math.PI / 2.6);
    arm.translate(side * 0.42, 1.6, 0);
    parts.push(colored(arm, 0x4f7a3f));
  }
  return mergeGeometries(parts)!;
}

function towerGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

function makeWindowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 128);
  const palette = ['#59f7ff', '#ff59c7', '#ffc857', '#b9c8ff', '#f5f7fa'];
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      if (Math.random() < 0.42) {
        g.fillStyle = palette[Math.floor(Math.random() * palette.length)];
        g.globalAlpha = 0.55 + Math.random() * 0.45;
        g.fillRect(x, y, 4, 5);
      }
    }
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function streetlightGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.08, 0.12, 7.4, 6);
  pole.translate(0, 3.7, 0);
  parts.push(colored(pole, 0x2a2e38));
  const arm = new THREE.BoxGeometry(0.09, 0.09, 1.7);
  arm.translate(0, 7.3, -0.75);
  parts.push(colored(arm, 0x2a2e38));
  const head = new THREE.BoxGeometry(0.5, 0.16, 0.85);
  head.translate(0, 7.22, -1.45);
  parts.push(colored(head, 0xffd9a0));
  return mergeGeometries(parts)!;
}

// ---------------------------------------------------------------- renderer

interface Pool {
  mesh: THREE.InstancedMesh;
  cap: number;
}

const PROP_WINDOW_BEHIND = 160;
const PROP_WINDOW_AHEAD = 760;

export class EnvironmentRenderer {
  readonly group = new THREE.Group();
  private theme: ThemeDef;
  private readonly scene: THREE.Scene;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly sky: THREE.Mesh;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly ground: THREE.Mesh;
  private water: THREE.Mesh | null = null;
  private readonly pools: Pool[] = [];
  private firstChunk = Number.NaN;
  private lastChunk = Number.NaN;
  private curRoad: RoadSystem | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly col = new THREE.Color();
  private readonly sp: SpinePoint = { x: 0, z: 0, heading: 0 };

  constructor(scene: THREE.Scene, theme: ThemeId, seed: number) {
    this.scene = scene;
    this.theme = THEMES[theme];
    this.seed = seed;

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uHorizon: { value: new THREE.Color(this.theme.sky.horizon) },
        uMid: { value: new THREE.Color(this.theme.sky.mid) },
        uZenith: { value: new THREE.Color(this.theme.sky.zenith) },
        uSunDir: { value: new THREE.Vector3(...this.theme.sky.sunDir) },
        uSunColor: { value: new THREE.Color(this.theme.sky.sunColor) },
        uSunI: { value: this.theme.sky.sunI },
        uStars: { value: this.theme.sky.stars ? 1 : 0 },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 24, 12), this.skyMat);
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2800, 2800),
      new THREE.MeshStandardMaterial({ color: this.theme.ground, roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.06;
    this.group.add(this.ground);

    if (this.theme.water !== undefined) {
      // right-side ocean band, a touch ABOVE the ground plane so it shows
      // (the exposed ground strip between road and water reads as beach)
      this.water = new THREE.Mesh(
        new THREE.PlaneGeometry(1700, 3600),
        new THREE.MeshStandardMaterial({
          color: this.theme.water,
          roughness: 0.18,
          metalness: 0.65,
        }),
      );
      this.water.rotation.x = -Math.PI / 2;
      this.water.position.y = -0.02;
      this.group.add(this.water);
    }

    this.hemi = new THREE.HemisphereLight(
      this.theme.hemi.sky, this.theme.hemi.ground, this.theme.hemi.intensity,
    );
    this.sun = new THREE.DirectionalLight(this.theme.sun.color, this.theme.sun.intensity);
    this.sun.position.set(
      this.theme.sky.sunDir[0] * 300,
      this.theme.sky.sunDir[1] * 300,
      this.theme.sky.sunDir[2] * 300,
    );
    this.group.add(this.hemi, this.sun);

    this.buildPools(theme);
    this.applyAtmosphere();
  }

  private seed: number;

  get look(): RoadLook {
    return this.theme.road;
  }

  get themeId(): ThemeId {
    return this.theme.id;
  }

  get themeName(): string {
    return this.theme.name;
  }

  private applyAtmosphere(): void {
    this.scene.fog = new THREE.Fog(this.theme.fog.color, this.theme.fog.near, this.theme.fog.far);
    this.scene.background = new THREE.Color(this.theme.fog.color);
  }

  /** Rebuild everything for a new theme (dev T-key / M5 menus). */
  setTheme(theme: ThemeId): void {
    this.theme = THEMES[theme];
    const u = this.skyMat.uniforms;
    (u.uHorizon.value as THREE.Color).setHex(this.theme.sky.horizon);
    (u.uMid.value as THREE.Color).setHex(this.theme.sky.mid);
    (u.uZenith.value as THREE.Color).setHex(this.theme.sky.zenith);
    (u.uSunDir.value as THREE.Vector3).set(...this.theme.sky.sunDir);
    (u.uSunColor.value as THREE.Color).setHex(this.theme.sky.sunColor);
    u.uSunI.value = this.theme.sky.sunI;
    u.uStars.value = this.theme.sky.stars ? 1 : 0;
    (this.ground.material as THREE.MeshStandardMaterial).color.setHex(this.theme.ground);
    this.hemi.color.setHex(this.theme.hemi.sky);
    this.hemi.groundColor.setHex(this.theme.hemi.ground);
    this.hemi.intensity = this.theme.hemi.intensity;
    this.sun.color.setHex(this.theme.sun.color);
    this.sun.intensity = this.theme.sun.intensity;
    this.sun.position.set(
      this.theme.sky.sunDir[0] * 300,
      this.theme.sky.sunDir[1] * 300,
      this.theme.sky.sunDir[2] * 300,
    );
    for (const p of this.pools) {
      p.mesh.visible = false; // rebuilt below
      this.group.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    this.pools.length = 0;
    this.firstChunk = Number.NaN;
    this.buildPools(theme);
    this.applyAtmosphere();
  }

  private addPool(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number): Pool {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.group.add(mesh);
    const pool = { mesh, cap };
    this.pools.push(pool);
    return pool;
  }

  private buildPools(theme: ThemeId): void {
    const vmat = (): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    if (theme === 'coastal') {
      this.pools.push(this.addPool(palmGeometry(), vmat(), 48), this.addPool(rockGeometry(), vmat(), 28));
    } else if (theme === 'neon') {
      const winTex = makeWindowTexture();
      const towerMat = new THREE.MeshStandardMaterial({
        color: 0x141824,
        roughness: 0.6,
        emissive: 0xffffff,
        emissiveMap: winTex,
        emissiveIntensity: 1.5,
      });
      const lightMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.7,
        emissive: 0xffd9a0,
        emissiveIntensity: 1.6,
      });
      this.pools.push(this.addPool(towerGeometry(), towerMat, 56), this.addPool(streetlightGeometry(), lightMat, 40));
    } else {
      this.pools.push(this.addPool(mesaGeometry(), vmat(), 16), this.addPool(rockGeometry(), vmat(), 28), this.addPool(cactusGeometry(), vmat(), 56));
    }
  }

  update(road: RoadSystem, pS: number, camX: number, camZ: number): void {
    this.curRoad = road;
    // followers recenter on the camera
    this.sky.position.set(camX, 0, camZ);
    this.ground.position.set(camX, -0.06, camZ);
    if (this.water) {
      road.sample(pS + 60, this.sp);
      const rx = Math.cos(this.sp.heading);
      const rz = Math.sin(this.sp.heading);
      this.water.position.set(this.sp.x + rx * 950, -0.02, this.sp.z + rz * 950);
    }

    const fc = Math.floor((pS - PROP_WINDOW_BEHIND) / CHUNK_LEN);
    const lc = Math.floor((pS + PROP_WINDOW_AHEAD) / CHUNK_LEN);
    if (fc === this.firstChunk && lc === this.lastChunk) return;
    this.firstChunk = fc;
    this.lastChunk = lc;

    const half = road.roadHalf;
    for (const p of this.pools) {
      p.mesh.count = 0;
      p.mesh.visible = false;
    }
    if (this.theme.id === 'coastal') this.fillCoastal(fc, lc, half);
    else if (this.theme.id === 'neon') this.fillNeon(fc, lc, half);
    else this.fillDesert(fc, lc, half);

    for (const p of this.pools) {
      p.mesh.instanceMatrix.needsUpdate = true;
      if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
      p.mesh.visible = true;
    }
  }

  private place(poolIdx: number, s: number, lat: number, sx: number, sy: number, sz: number, rotY: number, tint?: number): void {
    const p = this.pools[poolIdx];
    if (p.mesh.count >= p.cap || this.curRoad === null) return;
    this.curRoad.sample(s, this.sp);
    const rx = Math.cos(this.sp.heading);
    const rz = Math.sin(this.sp.heading);
    this.pos.set(this.sp.x + rx * lat, 0, this.sp.z + rz * lat);
    this.q.setFromAxisAngle(UP, rotY - this.sp.heading);
    this.scl.set(sx, sy, sz);
    this.m.compose(this.pos, this.q, this.scl);
    p.mesh.setMatrixAt(p.mesh.count, this.m);
    if (tint !== undefined) {
      this.col.setHex(tint);
      p.mesh.setColorAt(p.mesh.count, this.col);
    }
    p.mesh.count++;
  }

  private fillCoastal(fc: number, lc: number, half: number): void {
    // pools: 0 palms, 1 rocks
    for (let ci = fc; ci <= lc; ci++) {
      const base = ci * CHUNK_LEN;
      const nPalm = 7 + Math.floor(hashRng(ci, this.seed ^ 0xa1) * 4);
      for (let k = 0; k < nPalm; k++) {
        const r0 = hashRng(ci * 97 + k, this.seed ^ 0xa2);
        const r1 = hashRng(ci * 97 + k, this.seed ^ 0xa3);
        const r2 = hashRng(ci * 97 + k, this.seed ^ 0xa4);
        const side = r1 < 0.5 ? -1 : 1;
        const sc = 0.8 + r2 * 0.7;
        this.place(0, base + r0 * CHUNK_LEN, side * (half + 5 + r2 * 16), sc, sc * (0.9 + r0 * 0.35), sc, r0 * Math.PI * 2);
      }
      const nRock = 3 + Math.floor(hashRng(ci, this.seed ^ 0xa5) * 3);
      for (let k = 0; k < nRock; k++) {
        const r0 = hashRng(ci * 89 + k, this.seed ^ 0xa6);
        const r1 = hashRng(ci * 89 + k, this.seed ^ 0xa7);
        const side = r1 < 0.5 ? -1 : 1;
        const sc = 0.7 + r0 * 1.6;
        this.place(1, base + r0 * CHUNK_LEN, side * (half + 9 + r1 * 24), sc, sc * 0.8, sc, r1 * Math.PI * 2);
      }
    }
  }

  private fillNeon(fc: number, lc: number, half: number): void {
    // pools: 0 towers, 1 streetlights
    for (let ci = fc; ci <= lc; ci++) {
      const base = ci * CHUNK_LEN;
      const nTower = 9 + Math.floor(hashRng(ci, this.seed ^ 0xb1) * 5);
      for (let k = 0; k < nTower; k++) {
        const r0 = hashRng(ci * 97 + k, this.seed ^ 0xb2);
        const r1 = hashRng(ci * 97 + k, this.seed ^ 0xb3);
        const r2 = hashRng(ci * 97 + k, this.seed ^ 0xb4);
        const side = r1 < 0.5 ? -1 : 1;
        this.place(0, base + r0 * CHUNK_LEN, side * (half + 12 + r2 * 70), 12 + r2 * 12, 16 + r2 * 48, 12 + r0 * 12, r0 * Math.PI / 2);
      }
      // streetlights every 36 m, alternating sides
      let idx = 0;
      for (let s = base + 18; s < base + CHUNK_LEN; s += 36) {
        const side = idx++ % 2 === 0 ? 1 : -1;
        this.place(1, s, side * (half + 1.6), 1, 1, 1, side > 0 ? 0 : Math.PI);
      }
    }
  }

  private fillDesert(fc: number, lc: number, half: number): void {
    // pools: 0 mesas, 1 rocks, 2 cacti
    for (let ci = fc; ci <= lc; ci++) {
      const base = ci * CHUNK_LEN;
      const nMesa = 2 + Math.floor(hashRng(ci, this.seed ^ 0xc1) * 2);
      for (let k = 0; k < nMesa; k++) {
        const r0 = hashRng(ci * 97 + k, this.seed ^ 0xc2);
        const r1 = hashRng(ci * 97 + k, this.seed ^ 0xc3);
        const r2 = hashRng(ci * 97 + k, this.seed ^ 0xc4);
        const side = r1 < 0.5 ? -1 : 1;
        const w = 28 + r2 * 55;
        this.place(0, base + r0 * CHUNK_LEN, side * (half + 55 + r2 * 100), w, 14 + r0 * 30, w * (0.8 + r1 * 0.4), r0);
      }
      const nRock = 4 + Math.floor(hashRng(ci, this.seed ^ 0xc5) * 3);
      for (let k = 0; k < nRock; k++) {
        const r0 = hashRng(ci * 89 + k, this.seed ^ 0xc6);
        const r1 = hashRng(ci * 89 + k, this.seed ^ 0xc7);
        const side = r1 < 0.5 ? -1 : 1;
        const sc = 0.8 + r0 * 2.2;
        this.place(1, base + r0 * CHUNK_LEN, side * (half + 8 + r1 * 30), sc, sc * 0.8, sc, r1 * Math.PI * 2);
      }
      const nCac = 9 + Math.floor(hashRng(ci, this.seed ^ 0xc8) * 5);
      for (let k = 0; k < nCac; k++) {
        const r0 = hashRng(ci * 83 + k, this.seed ^ 0xc9);
        const r1 = hashRng(ci * 83 + k, this.seed ^ 0xca);
        const r2 = hashRng(ci * 83 + k, this.seed ^ 0xcb);
        const side = r1 < 0.5 ? -1 : 1;
        const sc = 0.7 + r2 * 0.9;
        this.place(2, base + r0 * CHUNK_LEN, side * (half + 4 + r2 * 34), sc, sc * (0.9 + r0 * 0.4), sc, r0 * Math.PI * 2);
      }
    }
  }

  dispose(): void {
    this.sky.geometry.dispose();
    this.skyMat.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    if (this.water) {
      this.water.geometry.dispose();
      (this.water.material as THREE.Material).dispose();
    }
    for (const p of this.pools) {
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
