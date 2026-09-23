// Hero car visuals (M6): procedural supercar bodies per archetype —
// extruded side profiles with beveled edges, greenhouse glass, spoked rims,
// emissive light bars, archetype extras (Vipera wing / Bruto scoop / Falcone
// ducktail), blob shadow, and damage-state presentation (sooty paint, loose
// bumper wobble, dying lights). Parts are merged per material → ~16 draws.
// Conventions: car faces −z; group.rotation.y = −heading (PILL 009).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Car, CarTune } from '../sim/car';
import type { HealthState } from '../sim/damage';

export interface CarPose {
  x: number;
  z: number;
  heading: number;
}

const WHEEL_R = 0.34;

/** Visual presentation per health state — pure mapping (tested). */
export interface DamageVisual {
  /** paint brightness multiplier (soot) */
  paintMul: number;
  /** paint roughness */
  rough: number;
  /** front bumper rest tilt, rad */
  bumperTilt: number;
  /** wobble amplitude around the tilt, rad */
  wobble: number;
  /** headlight intensity fraction */
  lightFrac: number;
}

export function damageVisual(state: HealthState): DamageVisual {
  switch (state) {
    case 'PRISTINE': return { paintMul: 1, rough: 0.3, bumperTilt: 0, wobble: 0, lightFrac: 1 };
    case 'DAMAGED': return { paintMul: 0.88, rough: 0.45, bumperTilt: 0.05, wobble: 0.015, lightFrac: 0.55 };
    case 'CRITICAL': return { paintMul: 0.6, rough: 0.68, bumperTilt: 0.13, wobble: 0.035, lightFrac: 0.18 };
    case 'WRECKED': return { paintMul: 0.42, rough: 0.85, bumperTilt: 0.2, wobble: 0, lightFrac: 0 };
  }
}

/** Smoke emission rate per state, particles/sec (pure — tested). */
export function smokeRate(state: HealthState): number {
  switch (state) {
    case 'PRISTINE': return 0;
    case 'DAMAGED': return 3;
    case 'CRITICAL': return 10;
    case 'WRECKED': return 26;
  }
}

type ProfilePt = [number, number]; // [frac of l toward nose, frac of h]

/** Side profiles (rear-bottom → over the roof → nose-bottom), x = toward nose.
 *  Archetype silhouettes: GT long-hood wedge / hyper teardrop / muscle box. */
const PROFILES: Record<string, ProfilePt[]> = {
  'falcone-gt': [
    [-0.50, 0.32], [-0.48, 0.62], [-0.44, 0.78], [-0.30, 0.84], [-0.16, 0.80],
    [-0.02, 0.55], [0.10, 0.48], [0.30, 0.52], [0.44, 0.50], [0.50, 0.36],
    [0.50, 0.16], [0.30, 0.12], [0.10, 0.10], [-0.10, 0.10], [-0.30, 0.10], [-0.50, 0.12],
  ],
  'vipera-rs': [
    [-0.50, 0.38], [-0.47, 0.60], [-0.40, 0.66], [-0.28, 0.70], [-0.16, 0.92],
    [-0.06, 1.0], [0.06, 0.98], [0.18, 0.72], [0.34, 0.52], [0.46, 0.40], [0.50, 0.26],
    [0.50, 0.14], [0.30, 0.10], [0.10, 0.08], [-0.10, 0.08], [-0.30, 0.08], [-0.50, 0.10],
  ],
  'bruto-widebody': [
    [-0.50, 0.44], [-0.49, 0.72], [-0.46, 0.82], [-0.20, 0.84], [-0.12, 1.0],
    [0.04, 1.0], [0.12, 0.78], [0.30, 0.74], [0.48, 0.68], [0.50, 0.46],
    [0.50, 0.18], [0.30, 0.14], [0.10, 0.12], [-0.10, 0.12], [-0.30, 0.12], [-0.50, 0.14],
  ],
};

export function profileFor(id: string): ProfilePt[] {
  return PROFILES[id] ?? PROFILES['falcone-gt'];
}

/** Greenhouse (glass) profile — inset canopy over the cabin region. */
function greenhouseProfile(id: string): ProfilePt[] {
  const p = profileFor(id);
  // take the upper run between the first local min and the windshield foot:
  // simple robust slice — points above 0.62·max in the rear half
  const upper = p.filter(([fx, fy]) => fy > 0.62 && fx < 0.2);
  if (upper.length < 2) {
    return [
      [-0.3, 0.8], [-0.1, 0.95], [0.1, 0.8], [0.1, 0.5], [-0.3, 0.5],
    ];
  }
  const nose = p.find(([fx]) => fx > 0.2 && fx < 0.5);
  const pts: ProfilePt[] = upper.map(([fx, fy]) => [fx, fy]);
  if (nose) pts.push([nose[0] * 0.92, nose[1] * 1.02]);
  pts.push([pts[pts.length - 1][0], 0.5], [upper[0][0], 0.5]);
  return pts;
}

/** Merge mixed geometry kinds: extrudes are non-indexed, boxes/cylinders are
 *  indexed — normalize everything to non-indexed or mergeGeometries bails. */
function mergeMix(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(normalized)!;
  for (const g of normalized) g.dispose();
  return merged;
}

function extrudeProfile(pts: ProfilePt[], wFrac: number, l: number, h: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0] * l, pts[0][1] * h);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0] * l, pts[i][1] * h);
  shape.closePath();
  const depth = wFrac;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.022,
    bevelSegments: 2,
    curveSegments: 4,
  });
  // profile.x = toward nose; extrusion runs along old +z. After rotateY(π/2)
  // old +x → −z (nose forward), old +z → +x (width) — then center it.
  geo.rotateY(Math.PI / 2);
  geo.translate(-depth / 2, 0, 0);
  return geo;
}

function spokeRimTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0c0d10';
  g.fillRect(0, 0, 128, 128);
  g.translate(64, 64);
  for (let i = 0; i < 10; i++) {
    g.rotate((Math.PI * 2) / 10);
    g.fillStyle = '#b9bdc4';
    g.beginPath();
    g.moveTo(-5, 0);
    g.lineTo(-3.2, -58);
    g.lineTo(3.2, -58);
    g.lineTo(5, 0);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#d8dce2';
  g.beginPath();
  g.arc(0, 0, 13, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#2a2c31';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(0, 0, 60, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

let blobTex: THREE.Texture | null = null;
function blobShadowTexture(): THREE.Texture {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.5)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}

export class CarView {
  readonly group = new THREE.Group();
  private bodyGroup = new THREE.Group();
  private bumperGroup = new THREE.Group();
  private frontPivots: THREE.Group[] = [];
  private wheelMeshes: THREE.Mesh[] = [];
  private roll = 0;
  private pitch = 0;
  private wheelSpin = 0;
  private wobbleT = 0;
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private paintMat!: THREE.MeshPhysicalMaterial;
  private headMat!: THREE.MeshStandardMaterial;
  private tailMat!: THREE.MeshStandardMaterial;
  private night = false;
  private visual = damageVisual('PRISTINE');
  private wreckPose = { roll: 0, pitch: 0 };
  private baseColor = new THREE.Color();
  private sootColor = new THREE.Color(0x2c2e33);

  constructor(private tune: CarTune) {
    this.build();
  }

  /** Exhaust anchor in car-local space (FX seeds smoke/sparks there). */
  get exhaustAnchorLocal(): THREE.Vector3 {
    return new THREE.Vector3(0, 0.32, this.tune.bodyDims[2] * 0.48);
  }

  private build(): void {
    const [w, h, l] = this.tune.bodyDims;
    const id = this.tune.id;
    this.baseColor.setHex(this.tune.color);

    // ---- paint-colored parts (body + archetype extras), merged ----
    const paintParts: THREE.BufferGeometry[] = [extrudeProfile(profileFor(id), w * 0.94, l, h)];
    if (id === 'vipera-rs') {
      const wing = new THREE.BoxGeometry(w * 0.96, 0.035, 0.34);
      wing.translate(0, h * 0.98 + 0.24, l * 0.40);
      paintParts.push(wing);
    } else if (id === 'falcone-gt') {
      const duck = new THREE.BoxGeometry(w * 0.9, 0.05, 0.22);
      duck.rotateX(-0.16);
      duck.translate(0, h * 0.84, l * 0.44);
      paintParts.push(duck);
    }
    this.paintMat = new THREE.MeshPhysicalMaterial({
      color: this.baseColor.clone(),
      roughness: this.visual.rough,
      metalness: 0.6,
      envMapIntensity: 1.2,
      // ADR-016 realism: clearcoat = the wet-look lacquer layer real car
      // paint has; costs one BRDF branch, sells the "supercar" instantly
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    });
    const paintMesh = new THREE.Mesh(mergeMix(paintParts), this.paintMat);
    this.bodyGroup.add(paintMesh);
    this.geometries.push(paintMesh.geometry);
    this.materials.push(this.paintMat);

    // ---- dark trim: skirts, diffuser, mirrors, scoop (vipera pylons) ----
    const trimParts: THREE.BufferGeometry[] = [];
    const skirt = new THREE.BoxGeometry(w * 0.99, 0.1, l * 0.55);
    skirt.translate(0, 0.14, 0);
    trimParts.push(skirt);
    const diffuser = new THREE.BoxGeometry(w * 0.9, 0.14, 0.3);
    diffuser.translate(0, 0.16, l * 0.46);
    trimParts.push(diffuser);
    // ADR-016 realism: front splitter blade + rear-deck vents + side blades
    const splitter = new THREE.BoxGeometry(w * 0.92, 0.05, 0.42);
    splitter.translate(0, 0.08, -l * 0.48);
    trimParts.push(splitter);
    for (const sx of [-1, 1]) {
      const vent = new THREE.BoxGeometry(0.3, 0.05, 0.26);
      vent.rotateX(-0.15);
      vent.translate(sx * w * 0.3, h * 0.8, l * 0.3);
      trimParts.push(vent);
      const blade = new THREE.BoxGeometry(0.05, 0.13, l * 0.3);
      blade.translate(sx * (w / 2 - 0.01), 0.3, l * 0.08);
      trimParts.push(blade);
      const mirror = new THREE.BoxGeometry(0.16, 0.05, 0.07);
      mirror.translate(sx * (w * 0.5 + 0.05), h * 0.72, -l * 0.06);
      trimParts.push(mirror);
    }
    if (id === 'vipera-rs') {
      for (const sx of [-1, 1]) {
        const pylon = new THREE.BoxGeometry(0.04, 0.26, 0.14);
        pylon.translate(sx * w * 0.36, h * 0.86, l * 0.40);
        trimParts.push(pylon);
      }
    } else if (id === 'bruto-widebody') {
      const scoop = new THREE.BoxGeometry(w * 0.3, 0.08, 0.55);
      scoop.translate(0, h * 0.76, -l * 0.22);
      trimParts.push(scoop);
    }
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.6, metalness: 0.4 });
    const trimMesh = new THREE.Mesh(mergeMix(trimParts), trimMat);
    this.bodyGroup.add(trimMesh);
    this.geometries.push(trimMesh.geometry);
    this.materials.push(trimMat);

    // ---- glass greenhouse ----
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0b0e14,
      roughness: 0.08,
      metalness: 0.9,
      envMapIntensity: 1.6,
    });
    const glassGeo = extrudeProfile(greenhouseProfile(id), w * 0.8, l, h);
    const glass = new THREE.Mesh(glassGeo, glassMat);
    this.bodyGroup.add(glass);
    this.geometries.push(glassGeo);
    this.materials.push(glassMat);

    // ---- front bumper (separate group: damage wobbles it) ----
    const bumperGeo = new THREE.BoxGeometry(w * 0.96, 0.16, 0.34);
    bumperGeo.translate(0, 0.2, -l * 0.5 + 0.1);
    const headL = new THREE.BoxGeometry(w * 0.2, 0.05, 0.05);
    headL.translate(-w * 0.28, h * 0.58, -l * 0.5 + 0.02);
    const headR = headL.clone();
    headR.translate(w * 0.56, 0, 0);
    this.headMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0c,
      emissive: 0xcfe6ff,
      emissiveIntensity: 0,
      roughness: 0.3,
    });
    const bumperMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.6, metalness: 0.4 });
    const bumper = new THREE.Mesh(bumperGeo, bumperMat);
    const heads = new THREE.Mesh(mergeMix([headL, headR]), this.headMat);
    this.bumperGroup.add(bumper, heads);
    this.bodyGroup.add(this.bumperGroup);
    this.geometries.push(bumperGeo, heads.geometry);
    this.materials.push(bumperMat, this.headMat);

    // ---- tail light bar + exhaust ----
    this.tailMat = new THREE.MeshStandardMaterial({
      color: 0x1a0505,
      emissive: 0xff2418,
      emissiveIntensity: 1.2,
      roughness: 0.4,
    });
    const tailGeo = new THREE.BoxGeometry(w * 0.82, 0.045, 0.04);
    tailGeo.translate(0, h * 0.62, l * 0.5 - 0.01);
    const tail = new THREE.Mesh(tailGeo, this.tailMat);
    this.bodyGroup.add(tail);
    this.geometries.push(tailGeo);
    this.materials.push(this.tailMat);

    const tipMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.85 });
    const tipGeos: THREE.BufferGeometry[] = [];
    // tipCount 2 → ±0.11; 4 → ±0.13/±0.30 (Bruto quad exit)
    const xs = id === 'bruto-widebody' ? [-0.3, -0.13, 0.13, 0.3] : [-0.11, 0.11];
    for (const tx of xs) {
      const tip = new THREE.CylinderGeometry(0.05, 0.05, 0.14, 10, 1, true);
      tip.rotateX(Math.PI / 2);
      tip.translate(tx * w, 0.24, l * 0.49);
      tipGeos.push(tip);
    }
    const tips = new THREE.Mesh(mergeMix(tipGeos), tipMat);
    this.bodyGroup.add(tips);
    this.geometries.push(tips.geometry);
    this.materials.push(tipMat);
    this.group.add(this.bodyGroup);

    // ---- wheels: single cylinder per wheel; spoke texture lives on the
    // side caps (material groups: side / top cap / bottom cap) so the rims
    // visibly spin with the tire ----
    const rimTex = spokeRimTexture();
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.32, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x0e0f12, roughness: 0.92 });
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: rimTex,
      roughness: 0.35,
      metalness: 0.8,
    });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * (w / 2 - 0.1), WHEEL_R, sz * (l / 2 - 0.78));
        const wheel = new THREE.Mesh(wheelGeo, [tireMat, rimMat, rimMat]);
        pivot.add(wheel);
        this.group.add(pivot);
        this.wheelMeshes.push(wheel);
        if (sz < 0) this.frontPivots.push(pivot); // front = −z
      }
    }
    this.geometries.push(wheelGeo);
    this.materials.push(tireMat, rimMat);

    // ---- blob shadow ----
    const shadowGeo = new THREE.PlaneGeometry(w + 1.1, l + 0.9);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.02;
    shadow.renderOrder = 2;
    this.group.add(shadow);
    this.geometries.push(shadowGeo);
    this.materials.push(shadowMat);
  }

  setTune(tune: CarTune): void {
    this.dispose();
    this.bodyGroup = new THREE.Group();
    this.bumperGroup = new THREE.Group();
    this.frontPivots = [];
    this.wheelMeshes = [];
    this.tune = tune;
    this.visual = damageVisual('PRISTINE');
    this.build();
    this.applyDamagePaint();
  }

  setNight(night: boolean): void {
    this.night = night;
  }

  setDamageState(state: HealthState): void {
    const v = damageVisual(state);
    if (v === this.visual) return;
    this.visual = v;
    this.applyDamagePaint();
    if (state === 'WRECKED') {
      this.wreckPose.roll = (Math.random() - 0.5) * 0.1;
      this.wreckPose.pitch = 0.05 + Math.random() * 0.04;
    } else {
      this.wreckPose.roll = 0;
      this.wreckPose.pitch = 0;
    }
  }

  private applyDamagePaint(): void {
    this.paintMat.color.copy(this.baseColor).lerp(this.sootColor, 1 - this.visual.paintMul);
    this.paintMat.roughness = this.visual.rough;
  }

  update(pose: CarPose, car: Car, dt: number): void {
    this.group.position.set(pose.x, 0, pose.z);
    this.group.rotation.y = -pose.heading;

    // spring-damped roll/pitch (accel-derived) + fixed wreck askew
    const rollT = Math.max(-0.09, Math.min(0.09, -car.ayLast * 0.0045));
    const pitchT = Math.max(-0.05, Math.min(0.05, car.axLast * 0.004));
    this.roll += (rollT - this.roll) * Math.min(1, 6 * dt);
    this.pitch += (pitchT - this.pitch) * Math.min(1, 6 * dt);
    this.bodyGroup.rotation.z = this.roll + this.wreckPose.roll;
    this.bodyGroup.rotation.x = this.pitch + this.wreckPose.pitch;

    // loose bumper wobble (damage states)
    this.wobbleT += dt;
    const drive = Math.min(1, Math.abs(car.ayLast) / 5);
    this.bumperGroup.rotation.x =
      this.visual.bumperTilt + this.visual.wobble * drive * Math.sin(this.wobbleT * 13);

    // wheels: roll with speed; front pair steers with the road-wheel angle
    this.wheelSpin += (car.u / WHEEL_R) * dt;
    for (const wheel of this.wheelMeshes) wheel.rotation.x = this.wheelSpin;
    for (const pivot of this.frontPivots) pivot.rotation.y = -car.steer;

    // lights: night headlights (damage dims them), brake-light bar
    const head = this.night ? this.visual.lightFrac * 2.6 : this.visual.lightFrac * 0.25;
    const flicker = this.visual.lightFrac > 0 && this.visual.lightFrac < 0.4
      ? 0.6 + 0.4 * (Math.sin(this.wobbleT * 31) > 0.6 ? 1 : 0.15)
      : 1;
    this.headMat.emissiveIntensity = head * flicker;
    this.tailMat.emissiveIntensity =
      (this.visual.lightFrac > 0 ? 1.2 : 0.15) + car.brakeIn * 2.6;
  }

  dispose(full = true): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries = [];
    this.materials = [];
    if (full) this.group.clear();
  }
}
