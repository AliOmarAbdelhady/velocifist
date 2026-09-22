// Final grade pass (M6, PLAN §12 "one LUT final pass"): the scene renders
// into a linear RT, then a fullscreen quad applies tint/lift/saturation grade
// per theme, vignette, speed-edge chromatic aberration and subtle grain.
// Off entirely on the Low preset (direct render). One extra draw call.

import * as THREE from 'three';
import type { ThemeId } from '../sim/road';

export interface GradeParams {
  saturation: number;
  gain: number;
  lift: number;
  tintShadow: [number, number, number];
  tintHigh: [number, number, number];
  vignette: number;
  grain: number;
}

/** Per-theme look (pure data — tested for sane ranges). */
export const GRADE_PRESETS: Record<ThemeId, GradeParams> = {
  coastal: {
    saturation: 1.06, gain: 1.02, lift: 0.0,
    tintShadow: [0.96, 0.97, 1.06], tintHigh: [1.04, 0.99, 0.94],
    vignette: 0.3, grain: 0.012,
  },
  neon: {
    saturation: 1.18, gain: 1.0, lift: 0.004,
    tintShadow: [0.92, 0.99, 1.12], tintHigh: [0.97, 1.0, 1.08],
    vignette: 0.44, grain: 0.016,
  },
  desert: {
    saturation: 1.1, gain: 1.04, lift: 0.006,
    tintShadow: [1.0, 0.96, 0.98], tintHigh: [1.07, 1.01, 0.88],
    vignette: 0.26, grain: 0.012,
  },
};

/** Chromatic-aberration strength from speed fraction (pure — tested). */
export function chromaAmount(speedFrac: number): number {
  const f = Math.min(1, Math.max(0, speedFrac));
  return 0.0006 + f * f * 0.0042;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec3 uTintS;
  uniform vec3 uTintH;
  uniform float uSat;
  uniform float uGain;
  uniform float uLift;
  uniform float uVig;
  uniform float uGrain;
  uniform float uChroma;
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 c = vUv - 0.5;
    float r2 = dot(c, c);
    float ca = uChroma * (0.4 + r2 * 2.4);
    vec3 col;
    col.r = texture2D(tDiffuse, vUv + c * ca).r;
    col.g = texture2D(tDiffuse, vUv).g;
    col.b = texture2D(tDiffuse, vUv - c * ca).b;

    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    col *= mix(vec3(1.0), uTintS, (1.0 - luma) * 0.8);
    col *= mix(vec3(1.0), uTintH, luma * 0.8);
    col = mix(vec3(luma), col, uSat);
    col = col * uGain + uLift;

    col *= 1.0 - uVig * smoothstep(0.22, 1.15, r2 * 2.3);
    col += (hash(vUv * 913.0 + uTime) - 0.5) * uGrain;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class GradePass {
  private rt: THREE.WebGLRenderTarget | null = null;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  private enabled = true;
  private samples = 0;
  private w = 1;
  private h = 1;
  private time = 0;
  private quad!: THREE.Mesh;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uTintS: { value: new THREE.Vector3(1, 1, 1) },
        uTintH: { value: new THREE.Vector3(1, 1, 1) },
        uSat: { value: 1 },
        uGain: { value: 1 },
        uLift: { value: 0 },
        uVig: { value: 0.3 },
        uGrain: { value: 0.012 },
        uChroma: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geo, this.mat);
    this.quadScene.add(this.quad);
    this.setTheme('coastal');
  }

  setEnabled(on: boolean, samples = 0): void {
    if (this.enabled === on && this.samples === samples) return;
    this.enabled = on;
    this.samples = samples;
    this.rebuild();
  }

  setSize(pixelW: number, pixelH: number): void {
    if (this.w === pixelW && this.h === pixelH) return;
    this.w = pixelW;
    this.h = pixelH;
    if (this.rt) this.rt.setSize(pixelW, pixelH);
  }

  setTheme(theme: ThemeId): void {
    const p = GRADE_PRESETS[theme] ?? GRADE_PRESETS.coastal;
    (this.mat.uniforms.uTintS.value as THREE.Vector3).set(...p.tintShadow);
    (this.mat.uniforms.uTintH.value as THREE.Vector3).set(...p.tintHigh);
    this.mat.uniforms.uSat.value = p.saturation;
    this.mat.uniforms.uGain.value = p.gain;
    this.mat.uniforms.uLift.value = p.lift;
    this.mat.uniforms.uVig.value = p.vignette;
    this.mat.uniforms.uGrain.value = p.grain;
  }

  /** Render scene through the grade (or direct when disabled). */
  render(scene: THREE.Scene, camera: THREE.Camera, frameDt: number, speedFrac: number): void {
    if (!this.enabled || !this.rt) {
      this.renderer.render(scene, camera);
      return;
    }
    this.time += frameDt;
    this.mat.uniforms.uTime.value = this.time;
    this.mat.uniforms.uChroma.value = chromaAmount(speedFrac);

    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.mat.uniforms.tDiffuse.value = this.rt.texture;
    this.renderer.render(this.quadScene, this.quadCam);
  }

  private rebuild(): void {
    this.rt?.dispose();
    this.rt = this.enabled
      ? new THREE.WebGLRenderTarget(this.w, this.h, {
          samples: this.samples,
          depthBuffer: true,
        })
      : null;
  }

  dispose(): void {
    this.rt?.dispose();
    this.rt = null;
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}
