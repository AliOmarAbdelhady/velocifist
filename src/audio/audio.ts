// Procedural WebAudio (M6, PLAN §13): 100% synthesis, zero audio files.
// ENGINE: per-cylinder ignition pulse train (PeriodicWave at firing
// frequency — infinite RPM resolution) + crank sub, through load-dependent
// waveshaper distortion and resonant band-shaping; per-car profiles (V8 GT /
// turbo V10 hyper / big-block muscle). Turbo whine + blow-off on the Vipera.
// BEDS: wind ∝ v², road rumble off-road, slip-driven tire squeal.
// ONE-SHOTS (pooled voices): panned doppler near-miss whoosh, layered crash
// (thump + crunch + metal ring ∝ impulse), wreck cut. Master bus runs
// through a compressor. All continuous nodes are built once, pre-started,
// and only parameter-automated per frame (no allocation, no GC churn).
// Decision point (PLAN): if synthesis quality disappoints in playtests,
// the engine layer alone can be swapped for a licensed CC0 sample loop —
// the rest of the graph stays.

import type { Car } from '../sim/car';
import type { CarTune } from '../sim/car';

// ------------------------------------------------------------ pure helpers

export function firingFrequency(rpm: number, cylinders: number): number {
  return (rpm / 60) * (cylinders / 2);
}

export function engineRpm(rpmNorm: number, idleRpm: number, maxRpm: number): number {
  const f = rpmNorm < 0 ? 0 : rpmNorm > 1 ? 1 : rpmNorm;
  return idleRpm + (maxRpm - idleRpm) * f;
}

export interface EngineProfile {
  cylinders: number;
  idleRpm: number;
  maxRpm: number;
  /** lowpass brightness scale */
  brightness: number;
  /** waveshaper drive 1..3 */
  drive: number;
  turbo: boolean;
  subGain: number;
  intakeGain: number;
}

export const ENGINE_PROFILES: Record<string, EngineProfile> = {
  'falcone-gt': { cylinders: 8, idleRpm: 900, maxRpm: 7400, brightness: 1.0, drive: 1.6, turbo: false, subGain: 0.5, intakeGain: 0.16 },
  'vipera-rs': { cylinders: 10, idleRpm: 1050, maxRpm: 8600, brightness: 1.25, drive: 1.2, turbo: true, subGain: 0.32, intakeGain: 0.2 },
  'bruto-widebody': { cylinders: 8, idleRpm: 680, maxRpm: 6200, brightness: 0.8, drive: 2.4, turbo: false, subGain: 0.72, intakeGain: 0.12 },
};

export function profileFor(id: string): EngineProfile {
  return ENGINE_PROFILES[id] ?? ENGINE_PROFILES['falcone-gt'];
}

export interface WhooshParams {
  dur: number;
  f0: number;
  f1: number;
  gain: number;
}

/** Near-miss doppler sweep from closing speed (m/s). */
export function whooshParams(closing: number): WhooshParams {
  const x = Math.min(1, Math.max(0, (closing - 2) / 9)); // ADR-012 cruise closing band
  return {
    dur: 0.2 + 0.16 * x,
    f0: 2400 + 900 * x,
    f1: 420 - 120 * x,
    gain: 0.1 + 0.38 * x,
  };
}

export interface CrashGains {
  thump: number;
  crunch: number;
  ring: number;
}

/** Layered-crash gains from impulse (closing m/s). */
export function crashGains(impulse: number): CrashGains {
  const x = Math.min(1, Math.max(0, (impulse - 2) / 26));
  return {
    thump: 0.25 + 0.75 * x,
    crunch: 0.18 + 0.82 * x,
    ring: 0.45 * x * x,
  };
}

// ------------------------------------------------------------------ helpers

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function makeDistortionCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive);
  }
  return curve;
}

function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function ignitionWave(ctx: AudioContext): PeriodicWave {
  const n = 24;
  const real = new Float32Array(new ArrayBuffer(n * 4));
  const imag = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 1; i < n; i++) imag[i] = Math.pow(1 / i, 0.55);
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

interface OneShotVoice {
  input: GainNode;
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  busy: false | number; // ctx.time when it frees
}

// ------------------------------------------------------------------ engine

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private profile = profileFor('falcone-gt');

  // engine chain
  private oscFire!: OscillatorNode;
  private oscSub!: OscillatorNode;
  private oscTurbo!: OscillatorNode;
  private shaper!: WaveShaperNode;
  private subGainNode!: GainNode;
  private engPre!: GainNode; // pre-distortion level = load
  private engLP!: BiquadFilterNode;
  private engGain!: GainNode;
  private intakeGain!: GainNode;
  private turboGain!: GainNode;
  // beds
  private windGain!: GainNode;
  private windLP!: BiquadFilterNode;
  private squealGain!: GainNode;
  private rumbleGain!: GainNode;
  // one-shot pools
  private whooshVoices: OneShotVoice[] = [];
  private crashVoices: OneShotVoice[] = [];

  private volume = 0.8;
  private running = false;
  private lastThrottle = 0;
  private lastThrottleT = 0;
  private blipT = -1;
  private blipWasRunning = false;
  private lastGear = 1;
  private gearT = 0;

  static create(): GameAudio | null {
    if (typeof AudioContext === 'undefined') return null;
    return new GameAudio();
  }

  private constructor() {}

  /** Must be called from (or after) a user gesture to actually hear audio. */
  init(): boolean {
    if (this.ctx) return true;
    try {
      this.ctx = new AudioContext();
    } catch {
      return false;
    }
    const ctx = this.ctx;
    this.noise = makeNoiseBuffer(ctx);

    // master bus: gain → compressor → out
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.16;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume * this.volume;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // ---- engine voice ----
    this.oscFire = ctx.createOscillator();
    this.oscFire.setPeriodicWave(ignitionWave(ctx));
    this.oscSub = ctx.createOscillator();
    this.oscSub.type = 'sine';
    this.oscTurbo = ctx.createOscillator();
    this.oscTurbo.type = 'sine';

    const shaper = ctx.createWaveShaper();
    shaper.curve = makeDistortionCurve(this.profile.drive);
    shaper.oversample = '2x';
    this.shaper = shaper;
    this.engPre = ctx.createGain();
    this.engPre.gain.value = 0.35;

    this.engLP = ctx.createBiquadFilter();
    this.engLP.type = 'lowpass';
    this.engLP.frequency.value = 900;
    this.engLP.Q.value = 0.9;
    const engPeak = ctx.createBiquadFilter();
    engPeak.type = 'peaking';
    engPeak.frequency.value = 220;
    engPeak.gain.value = 5;
    engPeak.Q.value = 1.1;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;

    const fireGain = ctx.createGain();
    fireGain.gain.value = 0.5;
    const subGain = ctx.createGain();
    subGain.gain.value = this.profile.subGain;
    this.subGainNode = subGain;
    this.oscFire.connect(fireGain).connect(this.engPre);
    this.oscSub.connect(subGain).connect(this.engPre);
    this.engPre.connect(shaper).connect(this.engLP).connect(engPeak).connect(this.engGain);
    this.engGain.connect(this.master);

    // intake hiss (noise → bandpass, throttle-scaled)
    const intake = ctx.createBufferSource();
    intake.buffer = this.noise;
    intake.loop = true;
    const intakeBP = ctx.createBiquadFilter();
    intakeBP.type = 'bandpass';
    intakeBP.frequency.value = 800;
    intakeBP.Q.value = 0.8;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    intake.connect(intakeBP).connect(this.intakeGain).connect(this.engLP);
    intake.start();

    // turbo (Vipera)
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.oscTurbo.connect(this.turboGain).connect(this.engLP);

    this.oscFire.start();
    this.oscSub.start();
    this.oscTurbo.start();

    // ---- beds ----
    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    this.windLP = ctx.createBiquadFilter();
    this.windLP.type = 'lowpass';
    this.windLP.frequency.value = 400;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windLP).connect(this.windGain).connect(this.master);
    wind.start();

    const squeal = ctx.createBufferSource();
    squeal.buffer = this.noise;
    squeal.loop = true;
    squeal.playbackRate.value = 0.7;
    const squealBP = ctx.createBiquadFilter();
    squealBP.type = 'bandpass';
    squealBP.frequency.value = 950;
    squealBP.Q.value = 7;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    squeal.connect(squealBP).connect(this.squealGain).connect(this.master);
    squeal.start();

    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    rumble.playbackRate.value = 0.4;
    const rumbleLP = ctx.createBiquadFilter();
    rumbleLP.type = 'lowpass';
    rumbleLP.frequency.value = 110;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(rumbleLP).connect(this.rumbleGain).connect(this.master);
    rumble.start();

    // ---- one-shot voice pools ----
    this.whooshVoices = this.makeVoices(6, 'bandpass');
    this.crashVoices = this.makeVoices(4, 'lowpass');

    // autoplay policy: resume at the first gesture wherever it lands
    const resume = (): void => {
      void this.ctx?.resume();
    };
    document.addEventListener('pointerdown', resume, { once: true, capture: true });
    document.addEventListener('keydown', resume, { once: true, capture: true });
    return true;
  }

  private makeVoices(count: number, type: BiquadFilterType): OneShotVoice[] {
    const ctx = this.ctx!;
    const voices: OneShotVoice[] = [];
    for (let i = 0; i < count; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = 1000;
      filter.Q.value = 1;
      const input = ctx.createGain();
      input.gain.value = 0;
      const panner = ctx.createStereoPanner();
      input.connect(filter).connect(panner).connect(this.master);
      voices.push({ input, filter, panner, busy: false });
    }
    return voices;
  }

  /** Swap engine character on car switch (garage / dev keys). */
  retune(tune: CarTune): void {
    this.profile = profileFor(tune.id);
    this.lastGear = 1;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.subGainNode.gain.setTargetAtTime(this.profile.subGain, t, 0.05);
    this.shaper.curve = makeDistortionCurve(this.profile.drive);
    if (!this.profile.turbo) this.turboGain.gain.setTargetAtTime(0, t, 0.05);
  }

  setVolume(v: number): void {
    this.volume = clamp(v, 0, 1);
    if (this.ctx) this.master.gain.value = this.volume * this.volume;
  }

  /** Engine + beds on/off (run start, results screen, wreck). */
  setRunning(on: boolean): void {
    this.running = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(on ? 0.32 : 0, t, 0.12);
    if (!on) {
      this.windGain.gain.setTargetAtTime(0, t, 0.3);
      this.squealGain.gain.setTargetAtTime(0, t, 0.05);
      this.rumbleGain.gain.setTargetAtTime(0, t, 0.2);
      this.intakeGain.gain.setTargetAtTime(0, t, 0.1);
      this.turboGain.gain.setTargetAtTime(0, t, 0.05);
    }
  }

  /** Garage flourish: brief rev on car select (engine falls quiet after). */
  revBlip(): void {
    this.blipT = 0;
    this.blipWasRunning = this.running;
    if (!this.running) this.setRunning(true);
  }

  get latencyMs(): number | null {
    if (!this.ctx) return null;
    const base = this.ctx.baseLatency ?? 0;
    const out = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    return (base + out) * 1000;
  }

  /** Per-frame parameter automation. Call from render at display rate. */
  updateEngine(car: Car, dt: number): void {
    if (!this.ctx || !this.running) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const p = this.profile;
    const tc = 0.04;

    // rev blip overrides rpm briefly (garage)
    let rpmNorm = car.rpmNorm;
    let throttle = car.throttleIn;
    if (this.blipT >= 0) {
      this.blipT += dt;
      const bt = this.blipT;
      if (bt > 1.1) {
        this.blipT = -1;
        if (!this.blipWasRunning) this.setRunning(false);
      } else {
        rpmNorm = bt < 0.12 ? (bt / 0.12) * 0.75 : Math.max(0.15, 0.75 * (1 - (bt - 0.12) / 0.98));
        throttle = bt < 0.14 ? 0.9 : 0.25;
      }
    }
    const rpm = engineRpm(rpmNorm, p.idleRpm, p.maxRpm);
    const fire = firingFrequency(rpm, p.cylinders);
    this.oscFire.frequency.setTargetAtTime(fire, t, tc);
    this.oscSub.frequency.setTargetAtTime(Math.max(24, rpm / 60), t, tc);
    this.oscTurbo.frequency.setTargetAtTime(900 + rpmNorm * 6800, t, tc);

    this.engPre.gain.setTargetAtTime(0.28 + 0.6 * throttle, t, tc);
    this.engLP.frequency.setTargetAtTime(
      300 + rpmNorm * 3400 * p.brightness + throttle * 700,
      t,
      tc,
    );
    this.intakeGain.gain.setTargetAtTime(p.intakeGain * (0.25 + 0.75 * throttle) * (0.4 + 0.6 * rpmNorm), t, tc);
    if (p.turbo) {
      this.turboGain.gain.setTargetAtTime(0.006 + 0.03 * throttle * rpmNorm, t, tc);
      // blow-off: sharp throttle lift at boost
      const now = performance.now() / 1000;
      if (this.lastThrottle - throttle > 0.45 && now - this.lastThrottleT < 0.12 && rpmNorm > 0.45) {
        this.blowOff();
      }
      if (Math.abs(this.lastThrottle - throttle) > 0.001) this.lastThrottleT = now;
      this.lastThrottle = throttle;
    }

    // gear shift: tiny torque-cut blip sells the gearbox
    if (car.gear !== this.lastGear) {
      this.lastGear = car.gear;
      this.gearT = 0.09;
    }
    if (this.gearT > 0) {
      this.gearT -= dt;
      this.engPre.gain.setTargetAtTime(0.08, t, 0.015);
    }

    const v = Math.abs(car.u);
    const vf = Math.min(1, v / car.tune.vCruise);
    this.windGain.gain.setTargetAtTime(vf * vf * 0.4, t, 0.1);
    this.windLP.frequency.setTargetAtTime(280 + v * 9, t, 0.1);

    const squeal = Math.max(0, car.rearSlip - 0.72) * (v > 4 ? 1 : 0);
    this.squealGain.gain.setTargetAtTime(Math.min(0.35, squeal * 1.3), t, 0.05);

    const rumble = car.offRoadLast ? Math.min(0.4, 0.1 + vf * 0.45) : 0;
    this.rumbleGain.gain.setTargetAtTime(rumble, t, 0.08);
  }

  /** Panned doppler whoosh — side is signed metres to the agent. */
  whoosh(side: number, closing: number, oncoming: boolean): void {
    if (!this.ctx) return;
    const w = whooshParams(closing);
    const voice = this.grabVoice(this.whooshVoices);
    if (!voice) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    voice.panner.pan.setValueAtTime(clamp(side / 3, -1, 1) * (oncoming ? 1 : 0.8), t);
    voice.filter.frequency.setValueAtTime(w.f0, t);
    voice.filter.frequency.exponentialRampToValueAtTime(Math.max(60, w.f1), t + w.dur);
    voice.filter.Q.value = 1.4;
    this.fireNoise(voice, w.dur + 0.08, w.gain * (oncoming ? 1.25 : 1));
  }

  /** Layered crash ∝ impulse. */
  crash(impulse: number): void {
    if (!this.ctx) return;
    const g = crashGains(impulse);
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // thump: sine drop 55→28 Hz
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(58, t);
    thump.frequency.exponentialRampToValueAtTime(26, t + 0.22);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.65 * g.thump, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    thump.connect(thumpGain).connect(this.master);
    thump.start(t);
    thump.stop(t + 0.32);

    // crunch: filtered noise burst
    const voice = this.grabVoice(this.crashVoices);
    if (voice) {
      voice.panner.pan.setValueAtTime(0, t);
      voice.filter.frequency.setValueAtTime(1400, t);
      voice.filter.frequency.exponentialRampToValueAtTime(240, t + 0.28);
      this.fireNoise(voice, 0.34, 0.55 * g.crunch);
    }

    // metal ring: detuned inharmonic partials
    if (g.ring > 0.02) {
      for (const f0 of [743, 1187, 1831]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = f0 * (0.97 + Math.random() * 0.06);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.16 * g.ring, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.55 + Math.random() * 0.3);
        osc.connect(og).connect(this.master);
        osc.start(t);
        osc.stop(t + 0.95);
      }
    }
  }

  /** Wreck: engine cut + heavy impact + fade. */
  wreck(): void {
    if (!this.ctx) return;
    this.crash(28);
    this.setRunning(false);
  }

  private blowOff(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const voice = this.grabVoice(this.whooshVoices);
    if (!voice) return;
    voice.panner.pan.setValueAtTime(0, t);
    voice.filter.frequency.setValueAtTime(3200, t);
    voice.filter.frequency.exponentialRampToValueAtTime(700, t + 0.32);
    voice.filter.Q.value = 2.2;
    this.fireNoise(voice, 0.36, 0.2);
  }

  private grabVoice(pool: OneShotVoice[]): OneShotVoice | null {
    if (!this.ctx) return null;
    const now = this.ctx.currentTime;
    for (const v of pool) {
      if (v.busy === false || (v.busy as number) <= now) {
        v.busy = false;
        return v;
      }
    }
    return null;
  }

  private fireNoise(voice: OneShotVoice, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.3;
    voice.input.gain.cancelScheduledValues(t);
    voice.input.gain.setValueAtTime(0.0001, t);
    voice.input.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t + 0.02);
    voice.input.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(voice.input);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    voice.busy = t + dur + 0.05;
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
