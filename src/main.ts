// VELOCIFIST — M1 bootstrap: real bicycle-model car, spring-arm camera rig,
// cone slalom course, dev car switching (1/2/3) and camera cycling (C).

import { createLoop } from './core/loop';
import { Car } from './sim/car';
import { CAR_TUNES } from './sim/carTunes';
import { createKeyboard } from './input/keyboard';
import { GameScene } from './render/scene';
import { DevHud } from './render/devHud';
import { CAM_MODES } from './render/cameraRig';

const overlay = document.getElementById('overlay')!;
overlay.addEventListener(
  'click',
  () => {
    overlay.style.display = 'none';
    boot();
  },
  { once: true },
);

function boot(): void {
  let car = new Car(CAR_TUNES[0]);
  const keyboard = createKeyboard();
  const gameScene = new GameScene(CAR_TUNES[0]);
  const hud = new DevHud();

  const switchCar = (index: number): void => {
    const old = car;
    car = new Car(CAR_TUNES[index]);
    // carry pose over so switching mid-run doesn't teleport the car
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

  // previous-step pose for render interpolation
  let px = car.x;
  let pz = car.z;
  let ph = car.heading;

  const loop = createLoop({
    step(dt) {
      keyboard.update(dt);
      px = car.x;
      pz = car.z;
      ph = car.heading;
      car.step(dt, keyboard.intent);
    },
    render(alpha, frameDt) {
      const pose = {
        x: px + (car.x - px) * alpha,
        z: pz + (car.z - pz) * alpha,
        heading: ph + (car.heading - ph) * alpha,
      };
      gameScene.update(pose, car, frameDt);
      hud.update(frameDt, gameScene.renderer, car.u, car.x, {
        carName: car.tune.name,
        gear: car.gear,
        rpmNorm: car.rpmNorm,
        betaDeg: (car.beta * 180) / Math.PI,
        latG: car.ayLast / 9.81,
        camMode: CAM_MODES[gameScene.rig.mode],
      });
    },
  });

  loop.start();
}
