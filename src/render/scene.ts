// M4 scene: the real streamed world — curved road ribbon + themed
// environment + construction cones + instanced traffic + the spring-arm rig.
// The car genuinely travels; the road streams chunks from the sim-side
// RoadSystem (render reads, sim owns); the floating-origin rebase is applied
// by main (pure +z translation, exact).

import * as THREE from 'three';
import type { Car, CarTune } from '../sim/car';
import type { TrafficSystem } from '../sim/traffic';
import { RoadSystem, type Projection, type ThemeId } from '../sim/road';
import { CarView, type CarPose } from './carView';
import { CameraRig } from './cameraRig';
import { Cones } from './cones';
import { TrafficRenderer } from './trafficRender';
import { RoadRibbon } from './roadRender';
import { EnvironmentRenderer } from './environment';

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly rig: CameraRig;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly carView: CarView;
  private readonly cones = new Cones();
  private readonly trafficView = new TrafficRenderer();
  private readonly env: EnvironmentRenderer;
  private readonly ribbon: RoadRibbon;
  private readonly road: RoadSystem;
  private readonly proj: Projection = { s: 0, lat: 0 };

  constructor(tune: CarTune, road: RoadSystem, theme: ThemeId, seed: number) {
    this.road = road;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    document.getElementById('app')!.appendChild(this.renderer.domElement);

    this.env = new EnvironmentRenderer(this.scene, theme, seed);
    this.ribbon = new RoadRibbon(
      this.env.look,
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    );
    this.scene.add(this.env.group, this.ribbon.group);

    this.carView = new CarView(tune);
    this.scene.add(this.carView.group);
    this.scene.add(this.cones.object);
    this.scene.add(this.trafficView.group);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.3,
      1000,
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

  /** Visual theme swap (dev T-key / M5 env select). The road's zone layout
   *  belongs to the sim and persists — a full theme change is a new run. */
  setTheme(theme: ThemeId): void {
    this.env.setTheme(theme);
    this.ribbon.setLook(this.env.look);
  }

  get themeName(): string {
    return this.env.themeName;
  }

  /** @returns construction cones knocked over by the car this frame */
  update(pose: CarPose, car: Car, traffic: TrafficSystem | null, frameDt: number, timeSec: number): number {
    this.road.project(pose.x, pose.z, this.proj);
    const pS = this.proj.s;

    this.ribbon.update(this.road, pS);
    this.env.update(this.road, pS, pose.x, pose.z);
    const coneHits = this.cones.update(this.road, pS, car);

    this.carView.update(
      pose,
      car.u,
      car.steer,
      car.axLast,
      car.ayLast,
      frameDt,
    );
    if (traffic) this.trafficView.sync(traffic.agents, timeSec);

    this.rig.update(
      frameDt,
      { x: pose.x, z: pose.z, heading: pose.heading, u: car.u, steer: car.steer, ayLast: car.ayLast },
      car.tune.vMax,
    );

    this.renderer.render(this.scene, this.camera);
    return coneHits;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.cones.dispose();
    this.ribbon.dispose();
    this.env.dispose();
    this.carView.dispose();
    this.renderer.dispose();
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
