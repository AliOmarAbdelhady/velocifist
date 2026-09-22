// M0 placeholder scene: endless straight road with a procedurally drawn asphalt texture
// (zero image assets), guardrails, a box "mule" car and a chase-style camera with
// speed-widening FOV (the NFS recipe's M0 sketch — full spring arm lands in M1).
//
// Conventions (locked in M0, keep for M1+):
//   - world x = screen right (camera sits at +z behind the car, looking toward -z)
//   - the sim car travels toward -z; the renderer keeps the car at z=0 and scrolls
//     the road texture by `distance` instead (no float-precision drift)
//   - car mesh rotation.y = -heading

import * as THREE from 'three';

export interface RenderSnapshot {
  x: number;
  heading: number;
  speed: number;
}

const ROAD_W = 24; // 4 lanes × 6 m
const ROAD_LEN = 640;
const TILE_M = 24; // texture tile covers 24 m of road length

function makeRoadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256; // 24 m × 24 m tile
  const g = c.getContext('2d')!;

  // asphalt base with speckle noise
  g.fillStyle = '#3c4046';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 55 + Math.random() * 26;
    g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }

  const mToPx = 256 / ROAD_W;
  // solid edge lines
  g.fillStyle = '#d8dce2';
  g.fillRect(1.0 * mToPx, 0, 3, 256);
  g.fillRect(23.0 * mToPx - 3, 0, 3, 256);
  // dashed lane separators (3 m dash / 9 m gap): lanes at 6, 12, 18 m
  g.fillStyle = '#c9ced6';
  for (const laneM of [6, 12, 18]) {
    for (let k = 0; k < 2; k++) {
      g.fillRect(laneM * mToPx - 1.5, k * 128, 3, 32);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, ROAD_LEN / TILE_M);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly car: THREE.Group;
  private readonly roadTex: THREE.CanvasTexture;
  private camX = 0;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('app')!.appendChild(this.renderer.domElement);

    const sky = new THREE.Color(0x9db8d2); // cool dusk haze placeholder
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 80, 460);

    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x3a3f46, 1.1);
    const sun = new THREE.DirectionalLight(0xfff1dd, 1.8);
    sun.position.set(-60, 90, 40);
    this.scene.add(hemi, sun);

    // road
    this.roadTex = makeRoadTexture();
    this.roadTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, ROAD_LEN),
      new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.94, metalness: 0 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.z = -ROAD_LEN / 2 + 40; // extend ahead, a little behind
    this.scene.add(road);

    // ground skirts
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2c3430, roughness: 1 });
    for (const side of [-1, 1]) {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, ROAD_LEN), groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(side * (ROAD_W / 2 + 40), -0.02, -ROAD_LEN / 2 + 40);
      this.scene.add(ground);
    }

    // guardrails
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb7bcc4, roughness: 0.5, metalness: 0.6 });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, ROAD_LEN), railMat);
      rail.position.set(side * (ROAD_W / 2), 0.45, -ROAD_LEN / 2 + 40);
      this.scene.add(rail);
    }

    this.car = this.buildCar();
    this.scene.add(this.car);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.3,
      900,
    );
    this.camera.position.set(0, 3.2, 8);

    window.addEventListener('resize', this.onResize);
  }

  private buildCar(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.55, 4.6),
      new THREE.MeshStandardMaterial({ color: 0xd8321e, roughness: 0.32, metalness: 0.75 }),
    );
    body.position.y = 0.55;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.42, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.14, metalness: 0.4 }),
    );
    cabin.position.set(0, 1.0, 0.25);
    group.add(body, cabin);

    const wheelGeo = new THREE.BoxGeometry(0.35, 0.65, 0.65);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x101013, roughness: 0.9 });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const wheel = new THREE.Mesh(wheelGeo, wheelMat);
        wheel.position.set(sx * 0.95, 0.33, sz * 1.5);
        group.add(wheel);
      }
    }
    return group;
  }

  /** Advance visuals + draw. Call once per rendered frame (not per sim step). */
  update(s: RenderSnapshot, frameDt: number, distance: number, vMax: number): void {
    this.car.position.set(s.x, 0, 0);
    this.car.rotation.y = -s.heading;

    // road scroll: one tile = TILE_M metres of travel
    this.roadTex.offset.y = (distance / TILE_M) % 1;

    // chase camera sketch: lag on x, look-ahead, speed-widening FOV
    const targetX = s.x * 0.85;
    this.camX += (targetX - this.camX) * Math.min(1, 6 * frameDt);
    const speedFrac = Math.min(1, s.speed / vMax);
    this.camera.fov = 50 + 28 * speedFrac;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(this.camX, 3.2, 8);
    this.camera.lookAt(this.camX + s.heading * 6, 1.2, -12);

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
