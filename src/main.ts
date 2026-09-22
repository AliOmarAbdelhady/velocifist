// VELOCIFIST — bootstrap (M2 flow + camera-loss recovery):
// START → camera explainer → (optional) camera + calibration wizard → drive
// with the input arbiter merging hands (primary) and keyboard (fallback).
// If the camera dies mid-run: overlay offers Retry (calibration is persisted,
// no re-wizard needed) or continuing on keyboard.

import { createLoop } from './core/loop';
import { Car } from './sim/car';
import { CAR_TUNES } from './sim/carTunes';
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
    boot(null, `camera unavailable — ${why}. Keyboard mode (retry via reload).`);
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
  let car = new Car(CAR_TUNES[0]);
  const keyboard = createKeyboard();
  const arbiter = new InputArbiter();
  const gameScene = new GameScene(CAR_TUNES[0]);
  const hud = new DevHud();
  if (note) hud.note(note);

  const switchCar = (index: number): void => {
    const old = car;
    car = new Car(CAR_TUNES[index]);
    car.x = old.x;
    car.z = old.z;
    car.heading = old.heading;
    car.u = old.u;
    gameScene.setCarTune(CAR_TUNES[index]);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyC') gameScene.cycleCamera();
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
    },
    render(alpha, frameDt) {
      const tracker = getTracker();
      const pip = getPip();
      const pose = {
        x: px + (car.x - px) * alpha,
        z: pz + (car.z - pz) * alpha,
        heading: ph + (car.heading - ph) * alpha,
      };
      gameScene.update(pose, car, frameDt);
      pip?.draw();
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
      });
    },
  });

  loop.start();
}
