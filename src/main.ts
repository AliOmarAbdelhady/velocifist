// VELOCIFIST — M0 bootstrap: overlay → loop wiring (sim step ↔ interpolated render).

import { createLoop } from './core/loop';
import { PlaceholderVehicle, MULE_TUNE } from './sim/vehicle';
import { createKeyboard } from './input/keyboard';
import { GameScene } from './render/scene';
import { DevHud } from './render/devHud';

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
  const vehicle = new PlaceholderVehicle(MULE_TUNE);
  const keyboard = createKeyboard();
  const gameScene = new GameScene();
  const hud = new DevHud();

  // Previous-step state for render interpolation (alpha blending between sim states).
  let prevX = 0;
  let prevHeading = 0;

  const loop = createLoop({
    step(dt) {
      keyboard.update(dt);
      prevX = vehicle.x;
      prevHeading = vehicle.heading;
      vehicle.step(dt, keyboard.intent);
    },
    render(alpha, frameDt) {
      const x = prevX + (vehicle.x - prevX) * alpha;
      const heading = prevHeading + (vehicle.heading - prevHeading) * alpha;
      gameScene.update({ x, heading, speed: vehicle.speed }, frameDt, vehicle.distance, MULE_TUNE.vMax);
      hud.update(frameDt, gameScene.renderer, vehicle.speed, vehicle.x);
    },
  });

  loop.start();
}
