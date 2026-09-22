// FX system (M6, PLAN §12): pooled GPU particles + camera-space speed lines.
// - sparks: additive points, gravity, short life — seeded at crash contacts
// - smoke: normal-blended points that grow and fade — damage state + tires
// - speed lines: instanced streak quads in a tube around the camera,
//   recycling toward the viewer ∝ speed (visible above ~120 km/h)
// Zero per-frame allocation: typed-array pools, swap-remove compaction.

import * as THREE from 'three';
import type { HealthState } from '../sim/damage';
import { smokeRate } from './carView';

const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / max(1.0, -mv.z));
    gl_Position = projectionMatrix * mv;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 t = texture2D(uTex, gl_PointCoord);
    gl_FragColor = vec4(vColor, t.a * vAlpha);
  }
`;

function softDotTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface ParticlePool {
  points: THREE.Points;
  pos: Float32Array; // xyz per particle
  vel: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  size: Float32Array; // current
  size0: Float32Array;
  grow: Float32Array; // m/s growth
  alpha0: Float32Array;
  color: Float32Array; // rgb per particle
  n: number; // alive count
  cap: number;
  emitAcc: number;
  alphaArr: Float32Array | null; // typed-array view of the aAlpha attribute
}

function makePool(cap: number, additive: boolean, tex: THREE.Texture): ParticlePool {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(cap * 3);
  const size = new Float32Array(cap);
  const alpha = new Float32Array(cap);
  const color = new Float32Array(cap * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex } },
    vertexShader: PARTICLE_VERT,
    fragmentShader: PARTICLE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return {
    points,
    pos,
    vel: new Float32Array(cap * 3),
    life: new Float32Array(cap),
    maxLife: new Float32Array(cap),
    size,
    size0: new Float32Array(cap),
    grow: new Float32Array(cap),
    alpha0: new Float32Array(cap),
    color,
    n: 0,
    cap,
    emitAcc: 0,
    alphaArr: null,
  };
}

function poolSpawn(
  p: ParticlePool, i: number,
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number,
  life: number, size: number, grow: number, alpha: number,
  r: number, g: number, b: number,
): void {
  p.pos[i * 3] = x;
  p.pos[i * 3 + 1] = y;
  p.pos[i * 3 + 2] = z;
  p.vel[i * 3] = vx;
  p.vel[i * 3 + 1] = vy;
  p.vel[i * 3 + 2] = vz;
  p.life[i] = life;
  p.maxLife[i] = life;
  p.size[i] = size;
  p.size0[i] = size;
  p.grow[i] = grow;
  p.alpha0[i] = alpha;
  p.color[i * 3] = r;
  p.color[i * 3 + 1] = g;
  p.color[i * 3 + 2] = b;
}

function poolUpdate(p: ParticlePool, dt: number, gravity: number, drag: number): void {
  p.alphaArr ??= p.points.geometry.getAttribute('aAlpha').array as Float32Array;
  let i = 0;
  while (i < p.n) {
    p.life[i] -= dt;
    if (p.life[i] <= 0) {
      // swap-remove
      const last = p.n - 1;
      if (i !== last) {
        p.pos[i * 3] = p.pos[last * 3];
        p.pos[i * 3 + 1] = p.pos[last * 3 + 1];
        p.pos[i * 3 + 2] = p.pos[last * 3 + 2];
        p.vel[i * 3] = p.vel[last * 3];
        p.vel[i * 3 + 1] = p.vel[last * 3 + 1];
        p.vel[i * 3 + 2] = p.vel[last * 3 + 2];
        p.life[i] = p.life[last];
        p.maxLife[i] = p.maxLife[last];
        p.size[i] = p.size[last];
        p.size0[i] = p.size0[last];
        p.grow[i] = p.grow[last];
        p.alpha0[i] = p.alpha0[last];
        p.color[i * 3] = p.color[last * 3];
        p.color[i * 3 + 1] = p.color[last * 3 + 1];
        p.color[i * 3 + 2] = p.color[last * 3 + 2];
      }
      p.n--;
      continue;
    }
    p.vel[i * 3 + 1] += gravity * dt;
    const damp = Math.max(0, 1 - drag * dt);
    p.vel[i * 3] *= damp;
    p.vel[i * 3 + 1] *= damp;
    p.vel[i * 3 + 2] *= damp;
    p.pos[i * 3] += p.vel[i * 3] * dt;
    p.pos[i * 3 + 1] += p.vel[i * 3 + 1] * dt;
    p.pos[i * 3 + 2] += p.vel[i * 3 + 2] * dt;
    p.size[i] = p.size0[i] + p.grow[i] * (p.maxLife[i] - p.life[i]);
    p.alphaArr![i] = p.alpha0[i] * Math.min(1, (p.life[i] / p.maxLife[i]) * 2);
    i++;
  }
  const geo = p.points.geometry;
  geo.setDrawRange(0, p.n);
  geo.getAttribute('position').needsUpdate = true;
  geo.getAttribute('aSize').needsUpdate = true;
  geo.getAttribute('aAlpha').needsUpdate = true;
  geo.getAttribute('aColor').needsUpdate = true;
}

const STREAK_COUNT = 56;
const STREAK_MIN_Z = -46;
const STREAK_SPAN = 42;

export class FXSystem {
  readonly group = new THREE.Group();
  private readonly tex = softDotTexture();
  private sparks: ParticlePool;
  private smoke: ParticlePool;
  private state: HealthState = 'PRISTINE';
  private smokeAcc = 0;
  private tireAcc = 0;
  private streaks: THREE.InstancedMesh;
  private streakData: Float32Array; // [angle, radius, z] per streak
  private streakMat: THREE.MeshBasicMaterial;
  private streaksOn = true;
  private readonly dummy = new THREE.Object3D();
  private readonly qz = new THREE.Quaternion();
  private readonly qx = new THREE.Quaternion();

  constructor(sparkCap = 320, smokeCap = 200) {
    this.sparks = makePool(sparkCap, true, this.tex);
    this.smoke = makePool(smokeCap, false, this.tex);
    this.group.add(this.sparks.points, this.smoke.points);

    const geo = new THREE.PlaneGeometry(0.035, 5.5);
    this.streakMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    this.streaks = new THREE.InstancedMesh(geo, this.streakMat, STREAK_COUNT);
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.streakData = new Float32Array(STREAK_COUNT * 3);
    for (let i = 0; i < STREAK_COUNT; i++) this.rerollStreak(i, Math.random() * STREAK_SPAN);
    this.qx.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  }

  /** Speed lines are camera-space: parent the streak mesh to the camera. */
  attach(camera: THREE.Camera): void {
    camera.add(this.streaks);
  }

  setBudgets(sparkCap: number, smokeCap: number, streaksOn: boolean): void {
    if (sparkCap !== this.sparks.cap) {
      this.group.remove(this.sparks.points);
      this.sparks.points.geometry.dispose();
      (this.sparks.points.material as THREE.Material).dispose();
      this.sparks = makePool(sparkCap, true, this.tex);
      this.group.add(this.sparks.points);
    }
    if (smokeCap !== this.smoke.cap) {
      this.group.remove(this.smoke.points);
      this.smoke.points.geometry.dispose();
      (this.smoke.points.material as THREE.Material).dispose();
      this.smoke = makePool(smokeCap, false, this.tex);
      this.group.add(this.smoke.points);
    }
    this.streaksOn = streaksOn;
  }

  setDamageState(state: HealthState): void {
    this.state = state;
  }

  /** Spark burst at a world contact point (crash impulse ∝ count/power). */
  burstSparks(x: number, y: number, z: number, impulse: number): void {
    const n = Math.min(40, Math.round(6 + impulse * 1.2));
    for (let k = 0; k < n; k++) {
      const i = this.sparks.n;
      if (i >= this.sparks.cap) break;
      this.sparks.n++;
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 2.6;
      const sp = (1.5 + Math.random() * 5) * Math.min(1, impulse / 14);
      poolSpawn(
        this.sparks, i,
        x + (Math.random() - 0.5) * 0.6,
        y + Math.random() * 0.5,
        z + (Math.random() - 0.5) * 0.6,
        Math.cos(a) * sp, up, Math.sin(a) * sp,
        0.25 + Math.random() * 0.4,
        0.09 + Math.random() * 0.08,
        -0.05, 0.95,
        1.0, 0.72 + Math.random() * 0.2, 0.3,
      );
    }
  }

  /** Damage smoke from the car — call once per frame with the hood anchor. */
  emitDamage(dt: number, x: number, y: number, z: number, vx: number, vz: number): void {
    const rate = smokeRate(this.state);
    if (rate <= 0) {
      this.smokeAcc = 0;
      return;
    }
    this.smokeAcc += rate * dt;
    const dark = this.state === 'CRITICAL' || this.state === 'WRECKED';
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      const i = this.smoke.n;
      if (i >= this.smoke.cap) break;
      this.smoke.n++;
      poolSpawn(
        this.smoke, i,
        x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3,
        vx * 0.25 + (Math.random() - 0.5) * 0.7,
        1.1 + Math.random() * 1.2,
        vz * 0.25 + (Math.random() - 0.5) * 0.7,
        1.1 + Math.random() * 0.9,
        0.55 + Math.random() * 0.3, 1.6, dark ? 0.34 : 0.16,
        dark ? 0.16 : 0.52, dark ? 0.16 : 0.52, dark ? 0.18 : 0.55,
      );
    }
  }

  /** Tire smoke — rear-wheel white puffs ∝ slip intensity (0..1). */
  emitTire(dt: number, x: number, y: number, z: number, intensity: number, vx: number, vz: number): void {
    if (intensity <= 0) {
      this.tireAcc = 0;
      return;
    }
    this.tireAcc += 26 * intensity * dt;
    while (this.tireAcc >= 1) {
      this.tireAcc -= 1;
      const i = this.smoke.n;
      if (i >= this.smoke.cap) break;
      this.smoke.n++;
      poolSpawn(
        this.smoke, i,
        x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.4,
        vx * 0.2 + (Math.random() - 0.5) * 0.5,
        0.7 + Math.random() * 0.8,
        vz * 0.2 + (Math.random() - 0.5) * 0.5,
        0.7 + Math.random() * 0.5,
        0.5, 2.2, 0.22,
        0.75, 0.75, 0.78,
      );
    }
  }

  /** Big wreck moment: spark shower + dark plume. */
  wreckBurst(x: number, z: number): void {
    this.burstSparks(x, 0.6, z, 30);
  }

  update(dt: number, speed: number): void {
    poolUpdate(this.sparks, dt, -22, 0.6);
    poolUpdate(this.smoke, dt, 0.35, 1.4);

    // speed lines: recycle toward the camera ∝ speed
    const v = Math.abs(speed);
    // visible from ~100 km/h, strong by 250 (visual QA: old curve was sub-perceptual)
    const op = this.streaksOn ? Math.min(0.6, Math.max(0, (v - 28) / 42) ** 2 * 0.85) : 0;
    this.streaks.visible = op > 0.02;
    if (this.streaks.visible) {
      this.streakMat.opacity = op;
      const dz = v * 1.45 * dt;
      for (let i = 0; i < STREAK_COUNT; i++) {
        let z = this.streakData[i * 3 + 2] + dz;
        if (z > -2.5) {
          z -= STREAK_SPAN;
          this.rerollStreak(i, 0);
        }
        this.streakData[i * 3 + 2] = z;
        this.dummy.position.set(
          Math.cos(this.streakData[i * 3]) * this.streakData[i * 3 + 1],
          Math.sin(this.streakData[i * 3]) * this.streakData[i * 3 + 1],
          z,
        );
        this.qz.setFromAxisAngle(FXSystem.ZAXIS, this.streakData[i * 3] + Math.PI / 2);
        this.dummy.quaternion.copy(this.qz).multiply(this.qx);
        this.dummy.updateMatrix();
        this.streaks.setMatrixAt(i, this.dummy.matrix);
      }
      this.streaks.instanceMatrix.needsUpdate = true;
    }
  }

  private static readonly ZAXIS = new THREE.Vector3(0, 0, 1);

  private rerollStreak(i: number, zOffset: number): void {
    this.streakData[i * 3] = Math.random() * Math.PI * 2;
    this.streakData[i * 3 + 1] = 2.0 + Math.random() * 3.4;
    this.streakData[i * 3 + 2] = STREAK_MIN_Z + zOffset;
  }

  /** Floating-origin shift (M4): particles live in world space. */
  rebase(dz: number): void {
    for (const p of [this.sparks, this.smoke]) {
      for (let i = 0; i < p.n; i++) p.pos[i * 3 + 2] += dz;
      (p.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.sparks.points.geometry.dispose();
    this.smoke.points.geometry.dispose();
    (this.sparks.points.material as THREE.Material).dispose();
    (this.smoke.points.material as THREE.Material).dispose();
    this.streaks.geometry.dispose();
    this.streakMat.dispose();
    this.tex.dispose();
    this.streaks.removeFromParent();
  }
}
