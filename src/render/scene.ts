// M1 scene: the car now genuinely travels through the world; road/rails/ground
// are follow planes (the repeating road texture stays world-anchored via the
// odometer-driven offset — seamless endless road with zero float drift), cones
// are real world objects, and the camera is the spring-arm rig.
// NOTE: no world rebasing yet — visible at |z| > ~10 km; lands with the M4 streamer.

import * as THREE from 'three';
import type { Car, CarTune } from '../sim/car';
import type { TrafficSystem } from '../sim/traffic';
import { CarView, type CarPose } from './carView';
import { CameraRig } from './cameraRig';
import { Cones } from './cones';
import { TrafficRenderer } from './trafficRender';

const ROAD_W = 24;
const ROAD_LEN = 640;
const TILE_M = 24;

function makeRoadTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256; // 24 m × 24 m tile
  const g = c.getContext('2d')!;

  g.fillStyle = '#3c4046';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 55 + Math.random() * 26;
    g.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }

  const mToPx = 256 / ROAD_W;
  g.fillStyle = '#d8dce2';
  g.fillRect(1.0 * mToPx, 0, 3, 256);
  g.fillRect(23.0 * mToPx - 3, 0, 3, 256);
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
  readonly rig: CameraRig;
  private readonly carView: CarView;
  private readonly cones = new Cones();
  private readonly trafficView = new TrafficRenderer();
  private readonly road: THREE.Mesh;
  private readonly roadTex: THREE.CanvasTexture;
  private readonly followers: THREE.Object3D[] = [];

  constructor(tune: CarTune) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('app')!.appendChild(this.renderer.domElement);

    const sky = new THREE.Color(0x9db8d2);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 80, 460);

    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x3a3f46, 1.1);
    const sun = new THREE.DirectionalLight(0xfff1dd, 1.8);
    sun.position.set(-60, 90, 40);
    this.scene.add(hemi, sun);

    // road + ground + rails: follow planes (world anchoring via texture offset)
    this.roadTex = makeRoadTexture();
    this.roadTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, ROAD_LEN),
      new THREE.MeshStandardMaterial({ map: this.roadTex, roughness: 0.94, metalness: 0 }),
    );
    this.road.rotation.x = -Math.PI / 2;
    this.scene.add(this.road);

    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2c3430, roughness: 1 });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0xb7bcc4,
      roughness: 0.5,
      metalness: 0.6,
    });
    for (const side of [-1, 1]) {
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, ROAD_LEN), groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(side * (ROAD_W / 2 + 40), -0.02, 0);
      this.scene.add(ground);
      this.followers.push(ground);

      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, ROAD_LEN), railMat);
      rail.position.set(side * (ROAD_W / 2), 0.45, 0);
      this.scene.add(rail);
      this.followers.push(rail);
    }

    this.carView = new CarView(tune);
    this.scene.add(this.carView.group);
    this.scene.add(this.cones.object);
    this.scene.add(this.trafficView.group);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.3,
      900,
    );
    this.rig = new CameraRig(this.camera);

    window.addEventListener('resize', this.onResize);
  }

  setCarTune(tune: CarTune): void {
    this.carView.setTune(tune);
  }

  cycleCamera(): void {
    this.rig.cycle();
  }

  update(pose: CarPose, car: Car, traffic: TrafficSystem | null, frameDt: number, timeSec: number): void {
    this.carView.update(
      pose,
      car.u,
      car.steer,
      car.axLast,
      car.ayLast,
      frameDt,
    );

    // follow planes recenter on the car; the texture offset keeps the asphalt
    // pattern pinned to world space (odometer = distance travelled)
    const centerZ = pose.z - ROAD_LEN / 2 + 60;
    this.road.position.z = centerZ;
    for (const f of this.followers) f.position.z = centerZ;
    this.roadTex.offset.y = (car.distance / TILE_M) % 1;

    this.cones.update(pose.z);
    if (traffic) this.trafficView.sync(traffic.agents, timeSec);

    this.rig.update(
      frameDt,
      { x: pose.x, z: pose.z, heading: pose.heading, u: car.u, steer: car.steer, ayLast: car.ayLast },
      car.tune.vMax,
    );

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.cones.dispose();
    this.carView.dispose();
    this.renderer.dispose();
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
