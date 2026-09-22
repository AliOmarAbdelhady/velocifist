// Benchmark harness HUD (ADR-006): FPS / frame ms / draw calls / triangles / speed.
// DOM-based (PLAN §5.4): crisp text, zero GPU cost. Updates 4×/s.

import type { WebGLRenderer } from 'three';

export class DevHud {
  private readonly el: HTMLElement;
  private acc = 0;
  private emaMs = 16.7;

  constructor() {
    this.el = document.getElementById('devhud')!;
    this.el.hidden = false;
  }

  update(frameDt: number, renderer: WebGLRenderer, speedMs: number, x: number): void {
    const ms = frameDt * 1000;
    this.emaMs = this.emaMs * 0.9 + ms * 0.1;
    this.acc += frameDt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const info = renderer.info.render;
    this.el.textContent =
      `fps  ${Math.round(1000 / this.emaMs)}   frame ${this.emaMs.toFixed(1)} ms\n` +
      `draw ${info.calls}   tris ${(info.triangles / 1000).toFixed(1)} k\n` +
      `spd  ${(speedMs * 3.6).toFixed(0)} km/h   x ${x.toFixed(2)} m`;
  }
}
