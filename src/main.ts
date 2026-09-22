// VELOCIFIST — bootstrap (M2 flow + camera-loss recovery):
// START → camera explainer → (optional) camera + calibration wizard → drive
// with the input arbiter merging hands (primary) and keyboard (fallback).
// If the camera dies mid-run: overlay offers Retry (calibration is persisted,
// no re-wizard needed) or continuing on keyboard.

import { createLoop } from './core/loop';
import { Car } from './sim/car';
import { CAR_TUNES } from './sim/carTunes';
import { TrafficSystem } from './sim/traffic';
import { RoadSystem, type ThemeId } from './sim/road';
import { DifficultyDirector } from './sim/director';
import { createKeyboard } from './input/keyboard';
import { InputArbiter } from './input/arbiter';
import { HandTracker } from './input/handTracker';
import { GameScene } from './render/scene';
import { DevHud } from './render/devHud';
import { PipRenderer } from './render/pip';
import { CalibrationWizard } from './ui/calibrationWizard';
import { CAM_MODES } from './render/cameraRig';

const overlay = document.getElementById('overlay')!;
const camchoice = document.getElementById('camchoice')!;
const camlost = document.getElementById('camlost')!;
const camlostReason = document.getElementById('camlostReason')!;
const pipwrap = document.getElementById('pipwrap')!;
const pipMount = document.getElementById('pipMount')!;
const wizardRoot = document.getElementById('wizard')!;

const THEME_ORDER: ThemeId[] = ['coastal', 'neon', 'desert'];
const urlTheme = new URLSearchParams(location.search).get('theme') as ThemeId | null;
let theme: ThemeId = urlTheme && THEME_ORDER.includes(urlTheme) ? urlTheme : 'coastal';

overlay.addEventListener(
  'click',
  () => {
    overlay.classList.add('hidden');
    camchoice.classList.remove('hidden');
  },
  { once: true },
);

document.getElementById('btnKb')!.addEventListener('click', () => {
  camchoice.classList.add('hidden');
  boot(null);
});

document.getElementById('btnCam')!.addEventListener('click', () => {
  camchoice.classList.add('hidden');
  void startWithCamera();
});

async function startWithCamera(): Promise<void> {
  const tracker = new HandTracker();
  // start() resolves only when the worker is genuinely READY (or classified error)
  await tracker.start();
  if (tracker.info.phase !== 'READY') {
    const why = tracker.info.error ?? tracker.info.phase;
    tracker.stop();
    showCamLost(
      why,
      () => void startWithCamera(),
      () => boot(null, `camera unavailable — ${why}. Keyboard mode.`),
    );
    return;
  }
  pipwrap.classList.remove('hidden');
  let pip = new PipRenderer(document.getElementById('pip') as HTMLCanvasElement, tracker);

  if (!tracker.solver.calibrated) {
    wizardRoot.classList.remove('hidden');
    pipMount.appendChild(pipwrap);
    const wizard = new CalibrationWizard(tracker, pip, {
      root: wizardRoot,
      title: document.getElementById('wizardTitle') as HTMLElement,
      body: document.getElementById('wizardBody') as HTMLElement,
      progress: document.getElementById('wizardBar') as HTMLElement,
    });
    await wizard.run();
    document.body.appendChild(pipwrap); // PiP back to the corner
  }

  bootWithRecovery(tracker, pip);
}

function showCamLost(reason: string, onRetry: () => void, onKeyboard: () => void): void {
  camlostReason.textContent = reason;
  camlost.classList.remove('hidden');
  document.getElementById('btnRetry')!.onclick = (): void => {
    camlost.classList.add('hidden');
    onRetry();
  };
  document.getElementById('btnKb2')!.onclick = (): void => {
    camlost.classList.add('hidden');
    onKeyboard();
  };
}

function bootWithRecovery(initialTracker: HandTracker, initialPip: PipRenderer): void {
  let tracker: HandTracker | null = initialTracker;
  let pip: PipRenderer | null = initialPip;

  tracker.onLost = (reason: string): void => {
    camlostReason.textContent = reason;
    camlost.classList.remove('hidden');
  };

  document.getElementById('btnRetry')!.onclick = async (): Promise<void> => {
    camlost.classList.add('hidden');
    tracker?.stop();
    const nt = new HandTracker();
    await nt.start(); // calib is persisted → no re-wizard
    if (nt.info.phase !== 'READY') {
      camlostReason.textContent = nt.info.error ?? nt.info.phase;
      camlost.classList.remove('hidden');
      tracker = null;
      pip = null;
      pipwrap.classList.add('hidden');
      return;
    }
    nt.onLost = (reason2: string): void => {
      camlostReason.textContent = reason2;
      camlost.classList.remove('hidden');
    };
    tracker = nt;
    pip = new PipRenderer(document.getElementById('pip') as HTMLCanvasElement, nt);
    pipwrap.classList.remove('hidden');
  };
  document.getElementById('btnKb2')!.onclick = (): void => {
    camlost.classList.add('hidden');
    tracker?.stop();
    tracker = null;
    pip = null;
    pipwrap.classList.add('hidden');
  };

  startLoop(() => tracker, () => pip);
}

function boot(tracker: HandTracker | null, note?: string): void {
  startLoop(() => tracker, () => null, note);
}

function startLoop(
  getTracker: () => HandTracker | null,
  getPip: () => PipRenderer | null,
  note?: string,
): void {
  // world: seeded curved spine + themed environment (non-repeating per run)
  const runSeed = (Date.now() & 0x7fffffff) >>> 0;
  const road = new RoadSystem({ seed: runSeed, theme });
  const director = new DifficultyDirector(runSeed);

  let car = new Car(CAR_TUNES[0]);
  car.guide = road;
  const keyboard = createKeyboard();
  const arbiter = new InputArbiter();
  const gameScene = new GameScene(CAR_TUNES[0], road, theme, runSeed);
  const hud = new DevHud();
  const traffic = new TrafficSystem(
    { seed: runSeed, laneCount: road.laneCount, laneWidth: road.laneWidth },
    road,
  );
  let nearMissTotal = 0;
  let crashTotal = 0;
  let coneHits = 0;
  if (note) hud.note(note);

  const switchCar = (index: number): void => {
    const old = car;
    car = new Car(CAR_TUNES[index]);
    car.guide = road;
    car.x = old.x;
    car.z = old.z;
    car.heading = old.heading;
    car.u = old.u;
    gameScene.setCarTune(CAR_TUNES[index]);
  };

  const cycleTheme = (): void => {
    theme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
    gameScene.setTheme(theme);
    hud.note(`theme → ${theme} (visuals only — zone layout keeps the run's seed)`);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyC') gameScene.cycleCamera();
    else if (e.code === 'KeyT') cycleTheme();
    else if (e.code === 'Digit1') switchCar(0);
    else if (e.code === 'Digit2') switchCar(1);
    else if (e.code === 'Digit3') switchCar(2);
  };
  window.addEventListener('keydown', onKey);

  let px = car.x;
  let pz = car.z;
  let ph = car.heading;

  const loop = createLoop({
    step(dt) {
      keyboard.update(dt);
      const t = performance.now() / 1000;
      const tracker = getTracker();
      const handIntent = tracker ? tracker.solver.intent : null;
      const handConf = tracker ? tracker.solver.state.confidence : 0;
      arbiter.update(handIntent, handConf, keyboard.intent, t);
      px = car.x;
      pz = car.z;
      ph = car.heading;
      car.step(dt, arbiter.intent);
      traffic.update(dt, car, px, pz);
      director.tick(dt);
      for (const c of traffic.takeCrashes()) {
        crashTotal++;
        director.registerCrash();
        void c;
      }
      for (const nm of traffic.takeNearMisses()) {
        if (nm.tier === 'INCHES' || nm.tier === 'VERY_CLOSE' || nm.tier === 'NEAR') nearMissTotal++;
      }
      // floating origin: pure +z translation, exact
      const dz = road.maybeRebase(car.z);
      if (dz !== 0) {
        car.z += dz;
        pz += dz;
        traffic.shiftWorld(dz);
        gameScene.rig.rebase(dz);
      }
    },
    render(alpha, frameDt) {
      const tracker = getTracker();
      const pip = getPip();
      const pose = {
        x: px + (car.x - px) * alpha,
        z: pz + (car.z - pz) * alpha,
        heading: ph + (car.heading - ph) * alpha,
      };
      coneHits += gameScene.update(pose, car, traffic, frameDt, performance.now() / 1000);
      pip?.draw();
      const pS = traffic.playerS;
      const chunk = Math.floor(pS / 256);
      const onc = road.oncomingAt(pS);
      const zone = onc > 0 ? 'ONCOMING ×2' : road.chunkFeature(chunk).construction ? 'CONSTRUCTION' : 'clear';
      const st = tracker?.solver.state;
      hud.update(frameDt, gameScene.renderer, car.u, car.x, {
        carName: car.tune.name,
        gear: car.gear,
        rpmNorm: car.rpmNorm,
        betaDeg: (car.beta * 180) / Math.PI,
        latG: car.ayLast / 9.81,
        camMode: CAM_MODES[gameScene.rig.mode],
        input: tracker
          ? `${arbiter.source} ${st ? st.status : ''} ${tracker.info.latencyMs.toFixed(0)}ms ${tracker.info.delegate}`
          : arbiter.source,
        traffic: `${nearMissTotal} near-miss · ${crashTotal} crashes · ${traffic.agents.filter((a) => a.active).length} cars`,
        world: `${gameScene.themeName} · s ${pS.toFixed(0)} · chunk ${chunk} · ${zone} · gen ${road.maxBuildMs.toFixed(2)}ms${coneHits > 0 ? ` · cones ${coneHits}` : ''}`,
      });
    },
  });

  loop.start();
}
