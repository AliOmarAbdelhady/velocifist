// M6 scene: streamed world (M4) + hero car + FX + final grade pass.
// The car genuinely travels; the road streams chunks from the sim-side
// RoadSystem (render reads, sim owns); the floating-origin rebase is applied
// by main (pure +z translation, exact — fx particles shift with it).

import * as THREE from 'three';
import type { Car, CarTune } from '../sim/car';
import type { TrafficSystem } from '../sim/traffic';
import { RoadSystem, type Projection, type ThemeId } from '../sim/road';
import { CarView, type CarPose } from './carView';
import { CameraRig } from './cameraRig';
import { Cones } from './cones';
import { TrafficRenderer } from './trafficRender';
import { RoadRibbon } from './roadRender';
import { EnvironmentRenderer, THEMES } from './environment';
import { FXSystem } from './fx';
import { GradePass } from './grade';
import type { QualityPreset } from '../core/quality';
import type { ComfortView } from '../core/motion';

/** Cheap theme-matched env map: equirect gradient + sun blob → PMREM. */
function buildEnvMap(
  renderer: THREE.WebGLRenderer,
  pmrem: THREE.PMREMGenerator,
  theme: ThemeId,
): THREE.Texture {
  const def = THEMES[theme];
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 96);
  grad.addColorStop(0, `#${new THREE.Color(def.sky.zenith).getHexString()}`);
  grad.addColorStop(0.55, `#${new THREE.Color(def.sky.mid).getHexString()}`);
  grad.addColorStop(1, `#${new THREE.Color(def.sky.horizon).getHexString()}`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 96);
  g.fillStyle = `#${new THREE.Color(def.ground).getHexString()}`;
  g.fillRect(0, 96, 256, 32);
  // sun blob (mirror-rich hot spot for the car paint)
  const [sx, sy, szDir] = def.sky.sunDir;
  const px = (Math.atan2(sx, -szDir) / (Math.PI * 2) + 0.5) * 256;
  const py = 48 - sy * 44;
  const sun = g.createRadialGradient(px, py, 1, px, py, 26);
  sun.addColorStop(0, `#${new THREE.Color(def.sky.sunColor).getHexString()}`);
  sun.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, 256, 96);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose();
  return rt.texture;
}

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly rig: CameraRig;
  readonly fx = new FXSystem();
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly carView: CarView;
  private readonly cones = new Cones();
  private readonly trafficView = new TrafficRenderer();
  private readonly env: EnvironmentRenderer;
  private readonly ribbon: RoadRibbon;
  private readonly grade: GradePass;
  private readonly pmrem: THREE.PMREMGenerator;
  private envMap: THREE.Texture | null = null;
  private theme: ThemeId;
  private road: RoadSystem;
  private readonly proj: Projection = { s: 0, lat: 0 };
  private smokeAccAnchors = { x: 0, z: 0 };
  /** M9 comfort state (last applied — speed lines re-gate on change) */
  private comfort: ComfortView = { reduced: false, shake: true, speedLines: true };
  private lastPreset: QualityPreset | null = null;

  constructor(tune: CarTune, road: RoadSystem, theme: ThemeId, seed: number) {
    this.road = road;
    this.theme = theme;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    document.getElementById('app')!.appendChild(this.renderer.domElement);

    this.env = new EnvironmentRenderer(this.scene, theme, seed);
    this.ribbon = new RoadRibbon(
      this.env.look,
      Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
    );
    this.scene.add(this.env.group, this.ribbon.group);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.applyEnvMap(theme);

    this.carView = new CarView(tune);
    this.carView.setNight(theme === 'neon');
    this.scene.add(this.carView.group);
    this.scene.add(this.cones.object);
    this.scene.add(this.trafficView.group);
    this.scene.add(this.fx.group);

    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.3,
      1000,
    );
    this.scene.add(this.camera); // camera hosts the speed-line streaks
    this.fx.attach(this.camera);
    this.rig = new CameraRig(this.camera);

    this.grade = new GradePass(this.renderer);
    this.grade.setTheme(theme);
    this.syncGradeSize();

    window.addEventListener('resize', this.onResize);
  }

  private applyEnvMap(theme: ThemeId): void {
    const next = buildEnvMap(this.renderer, this.pmrem, theme);
    this.envMap?.dispose();
    this.envMap = next;
    this.scene.environment = next;
    this.scene.environmentIntensity = theme === 'neon' ? 0.5 : 1.0;
  }

  setCarTune(tune: CarTune): void {
    this.carView.setTune(tune);
    this.carView.setNight(this.theme === 'neon');
  }

  /** Point the scene at a fresh world (retry: new seed, same renderer). */
  setRoad(road: RoadSystem): void {
    this.road = road;
  }

  cycleCamera(): void {
    this.rig.cycle();
  }

  /** Visual theme swap (dev T-key). Zone layout belongs to the sim. */
  setTheme(theme: ThemeId): void {
    this.theme = theme;
    this.env.setTheme(theme);
    this.ribbon.setLook(this.env.look);
    this.grade.setTheme(theme);
    this.applyEnvMap(theme);
    this.carView.setNight(theme === 'neon');
  }

  get themeName(): string {
    return this.env.themeName;
  }

  /** Quality preset application (auto-scaler / manual). */
  applyQuality(preset: QualityPreset): void {
    this.lastPreset = preset;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.dprCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.grade.setEnabled(preset.gradePass, preset.msaa);
    this.fx.setBudgets(preset.sparkCap, preset.smokeCap, preset.speedLines && this.comfort.speedLines);
    this.syncGradeSize();
  }

  /** M9 comfort: reduced-motion resolution + shake/streak toggles. */
  setComfort(comfort: ComfortView): void {
    this.comfort = comfort;
    this.rig.setComfort(comfort.reduced, comfort.shake);
    if (this.lastPreset) {
      this.fx.setBudgets(
        this.lastPreset.sparkCap,
        this.lastPreset.smokeCap,
        this.lastPreset.speedLines && comfort.speedLines,
      );
    }
  }

  /** Damage-state plumbing into car + FX presentation. */
  setDamageState(state: 'PRISTINE' | 'DAMAGED' | 'CRITICAL' | 'WRECKED'): void {
    this.carView.setDamageState(state);
    this.fx.setDamageState(state);
  }

  /** Floating-origin shift: world-space FX particles move with the world. */
  rebase(dz: number): void {
    this.fx.rebase(dz);
  }

  /** @returns construction cones knocked over by the car this frame */
  update(pose: CarPose, car: Car, traffic: TrafficSystem | null, frameDt: number, timeSec: number): number {
    this.road.project(pose.x, pose.z, this.proj);
    const pS = this.proj.s;

    this.ribbon.update(this.road, pS);
    this.env.update(this.road, pS, pose.x, pose.z);
    const coneHits = this.cones.update(this.road, pS, car);

    this.carView.update(pose, car, frameDt);
    if (traffic) this.trafficView.sync(traffic.agents, timeSec);

    // ---- FX: damage smoke from the hood, tire smoke at the rear axle ----
    const fwdX = Math.sin(pose.heading);
    const fwdZ = -Math.cos(pose.heading);
    const l = car.tune.bodyDims[2];
    this.smokeAccAnchors.x = pose.x - fwdX * l * 0.26;
    this.smokeAccAnchors.z = pose.z - fwdZ * l * 0.26;
    this.fx.emitDamage(frameDt, this.smokeAccAnchors.x, 0.72, this.smokeAccAnchors.z, fwdX * car.u, fwdZ * car.u);
    const slip = car.rearSlip;
    const v = Math.abs(car.u);
    if (slip > 0.8 && v > 8) {
      this.fx.emitTire(
        frameDt,
        pose.x + fwdX * l * 0.3,
        0.22,
        pose.z + fwdZ * l * 0.3,
        Math.min(1, (slip - 0.8) * 5) * Math.min(1, v / 30),
        fwdX * car.u,
        fwdZ * car.u,
      );
    }
    this.fx.update(frameDt, v);

    this.rig.update(
      frameDt,
      { x: pose.x, z: pose.z, heading: pose.heading, u: car.u, steer: car.steer, ayLast: car.ayLast },
      car.tune.vMax,
    );

    this.grade.render(this.scene, this.camera, frameDt, Math.min(1, v / car.tune.vMax));
    return coneHits;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.cones.dispose();
    this.ribbon.dispose();
    this.env.dispose();
    this.carView.dispose();
    this.fx.dispose();
    this.grade.dispose();
    this.envMap?.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }

  private syncGradeSize(): void {
    const dpr = this.renderer.getPixelRatio();
    this.grade.setSize(
      Math.round(window.innerWidth * dpr),
      Math.round(window.innerHeight * dpr),
    );
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.syncGradeSize();
  };
}
