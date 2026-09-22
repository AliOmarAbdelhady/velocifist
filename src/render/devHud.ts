// Benchmark harness HUD (ADR-006): FPS / frame ms / draw calls / triangles plus
// live vehicle telemetry (speed, gear, slip, lateral g) and session state.
// DOM-based: crisp text, zero GPU cost. Updates 4×/s.

import type { WebGLRenderer } from 'three';

export interface HudInfo {
  carName: string;
  gear: number;
  rpmNorm: number;
  betaDeg: number;
  latG: number;
  camMode: string;
  input: string;
  traffic: string;
}

export class DevHud {
  private readonly el: HTMLElement;
  private acc = 0;
  private emaMs = 16.7;
  private noteText = '';

  constructor() {
    this.el = document.getElementById('devhud')!;
    this.el.hidden = false;
  }

  note(msg: string): void {
    this.noteText = msg;
  }

  update(frameDt: number, renderer: WebGLRenderer, speedMs: number, x: number, info: HudInfo): void {
    const ms = frameDt * 1000;
    this.emaMs = this.emaMs * 0.9 + ms * 0.1;
    this.acc += frameDt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const r = renderer.info.render;
    this.el.textContent =
      `fps  ${Math.round(1000 / this.emaMs)}   frame ${this.emaMs.toFixed(1)} ms\n` +
      `draw ${r.calls}   tris ${(r.triangles / 1000).toFixed(1)} k\n` +
      `spd  ${(speedMs * 3.6).toFixed(0)} km/h   x ${x.toFixed(2)} m\n` +
      `${info.carName}  g${info.gear}  rpm ${(info.rpmNorm * 100).toFixed(0)}%\n` +
      `β ${info.betaDeg.toFixed(1)}°   lat ${info.latG.toFixed(2)} g   cam ${info.camMode}\n` +
      `in   ${info.input}\n` +
      `trf  ${info.traffic}\n` +
      `cars 1/2/3 · cam C${this.noteText ? `\n${this.noteText}` : ''}`;
  }
}
