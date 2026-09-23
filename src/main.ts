// VELOCIFIST — bootstrap + run lifecycle (M5):
// START → GARAGE → camera choice → (calibration) → RUN → WRECK → RESULTS
// → RETRY (R / Enter — instant, same input mode) or garage (G).
// EASY-FIRST (ADR-008): assists always on, relaxed traffic, no death pacing.

import { createLoop, type Loop } from './core/loop';
import { Car, type CarTune } from './sim/car';
import { CAR_TUNES } from './sim/carTunes';
import { TrafficSystem } from './sim/traffic';
import { RoadSystem, type ThemeId } from './sim/road';
import { DifficultyDirector, densityAt } from './sim/director';
import { ScoringSystem } from './sim/scoring';
import { DamageSystem } from './sim/damage';
import { createKeyboard } from './input/keyboard';
import { InputArbiter } from './input/arbiter';
import { HandTracker } from './input/handTracker';
import { GameScene } from './render/scene';
import { DevHud } from './render/devHud';
import { PipRenderer } from './render/pip';
import { CalibrationWizard } from './ui/calibrationWizard';
import { GameHud } from './ui/hud';
import { ResultsScreen } from './ui/results';
import { Garage } from './ui/garage';
import { PersistenceService, type GameSettings } from './persist/local';
import { CAM_MODES } from './render/cameraRig';
import { GameAudio } from './audio/audio';
import { QualityManager } from './core/quality';
import { DemoHands } from './input/demoHands';
import { EventDirector, EVENT_LABEL } from './sim/events';
import { TelemetryRecorder, type RunTelemetry } from './core/telemetry';
import { forwardAssist, applyAssist, type AssistView } from './sim/assist';
import { resolveReducedMotion, deriveComfort, prefersReducedMotion } from './core/motion';
import { OptionsPanel } from './ui/options';
import { GamepadInput, RemoteInput, ManualMerge, normalizeRelayUrl } from './input/devices';
import { ASSIST_LEVELS, type AssistParams, type AssistLevel } from './sim/assist';
import { VersusPanel } from './ui/versus';
import { VersusSession, type VsOutcome } from './net/session';
import type { TrackerLike } from './render/pip';
import type { SpinePoint } from './sim/road';

const overlay = document.getElementById('overlay')!;
const camchoice = document.getElementById('camchoice')!;
const camlost = document.getElementById('camlost')!;
const camlostReason = document.getElementById('camlostReason')!;
const pipwrap = document.getElementById('pipwrap')!;
const pipMount = document.getElementById('pipMount')!;
const wizardRoot = document.getElementById('wizard')!;

const THEME_ORDER: ThemeId[] = ['coastal', 'neon', 'desert'];
const urlTheme = new URLSearchParams(location.search).get('theme') as ThemeId | null;
const pinnedTheme: ThemeId | null = urlTheme && THEME_ORDER.includes(urlTheme) ? urlTheme : null;
let nextTheme: ThemeId = pinnedTheme ?? 'coastal';

const persist = new PersistenceService();

// ?pipdemo=1 — synthetic hands drive the real pipeline (AR demo / E2E)
const pipdemo = new URLSearchParams(location.search).has('pipdemo');
let demoHands: DemoHands | null = null;

// Procedural audio (M6): created once, resumed on the first user gesture.
const audio = GameAudio.create();
audio?.setVolume(persist.settings.volume);

// Physical controllers (M12/ADR-013): PS4 gamepad + phone remote, merged
// with the keyboard into one manual intent (most-recent activity wins).
const gamepad = new GamepadInput();
const remote = new RemoteInput();
const manual = new ManualMerge();

function connectRemote(url: string): void {
  remote.connect(normalizeRelayUrl(url, location.protocol));
}
// relay-hosted game (scripts/remote-relay.mjs --serve) auto-connects; the
// ?relay=host:port param does it for games served elsewhere
if ((window as { __VFC_RELAY?: boolean }).__VFC_RELAY) {
  connectRemote(location.host); // page protocol picks ws vs wss
} else {
  const rp = new URLSearchParams(location.search).get('relay');
  if (rp) connectRemote(rp);
}

// ------------------------------------------------------- M9 settings plumbing

const PIP_BASE_W = 330;
const PIP_BASE_H = 248;

let getTrackerFn: (() => TrackerLike | null) | null = null;
let getPipFn: (() => PipRenderer | null) | null = null;

function applyPipLayout(s: GameSettings): void {
  pipwrap.classList.remove('pip-tl', 'pip-tr', 'pip-bl', 'pip-br');
  pipwrap.classList.add(`pip-${s.pipCorner}`);
  const canvas = document.getElementById('pip');
  if (canvas instanceof HTMLCanvasElement) {
    canvas.style.width = `${Math.round(PIP_BASE_W * s.pipScale)}px`;
    canvas.style.height = `${Math.round(PIP_BASE_H * s.pipScale)}px`;
  }
}

/** Push persisted steering settings into a (possibly new) tracker's solver. */
function applyTrackerSettings(tracker: TrackerLike | null): void {
  const s = persist.settings;
  tracker?.solver.setSensitivity(s.sensitivity);
  tracker?.solver.setOneHanded(s.oneHanded);
}

function comfortFromSettings() {
  const s = persist.settings;
  const reduced = resolveReducedMotion(s.reducedMotion, prefersReducedMotion());
  return deriveComfort(reduced, s.shake, s.speedLines);
}

const options = new OptionsPanel(persist, {
  onSettings: (s, changed) => {
    if (changed === '' || changed === 'pipCorner' || changed === 'pipScale') applyPipLayout(s);
    if (changed === '' || changed === 'sensitivity' || changed === 'oneHanded')
      applyTrackerSettings(getTrackerFn?.() ?? null);
    if (changed === '' || changed === 'volume') audio?.setVolume(s.volume);
    if (changed === '' || changed === 'quality') currentGame?.quality.setMode(s.quality);
    if (
      changed === '' ||
      changed === 'shake' ||
      changed === 'speedLines' ||
      changed === 'reducedMotion'
    )
      currentGame?.scene.setComfort(comfortFromSettings());
    if (changed === '' || changed === 'driverAid')
      currentGame?.setAssistLevel(persist.settings.driverAid);
  },
  onRecalibrate: () => void recalibrateHands(),
  connectRemote: (url) => connectRemote(url),
  remoteStatus: () => ({ status: remote.status, latencyMs: remote.latencyMs }),
  getTracker: () => getTrackerFn?.() ?? null,
  audioLatencyMs: () => audio?.latencyMs ?? null,
  setVolume: (v) => audio?.setVolume(v),
});

function toggleOptions(): void {
  if (!wizardRoot.classList.contains('hidden')) return; // wizard is modal
  if (options.isOpen) {
    options.close();
    currentGame?.setPaused(false);
  } else {
    currentGame?.setPaused(true);
    options.open();
  }
}

document.getElementById('btnOptions')!.addEventListener('click', () => toggleOptions());
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyO') toggleOptions();
  else if (e.code === 'Escape' && options.isOpen) toggleOptions();
});

applyPipLayout(persist.settings);

// ------------------------------------------------- ADR-018 versus lobby
// invite-code 1v1 ghost race: the panel owns the VersusSession until the
// config is agreed, then hands it to a versus-mode Game (same loop, seeded
// world, ghost opponent). peerjs itself loads lazily inside MatchLink.
const versusCountdownEl = document.getElementById('countdown')!;
const hudVersusEl = document.getElementById('hudVersus')!;
let versusSession: VersusSession | null = null;
let currentGame: Game | null = null; // hoisted: the versus callbacks close over it

const versusPanel = new VersusPanel(
  persist.settings.car,
  (session) => {
    versusSession = session;
    const tune = CAR_TUNES.find((t) => t.id === persist.settings.car) ?? CAR_TUNES[0];
    currentGame?.dispose();
    getTrackerFn = null;
    getPipFn = null;
    currentGame = new Game(() => null, () => null, tune, undefined, session);
  },
  () => {
    versusSession = null;
    versusPanelReset();
    showGarage();
  },
);
// break the panel↔flow cycle for rematch resets (declared after use is fine:
// it only runs on user interaction)
function versusPanelReset(): void {
  versusPanel.reset();
}
document.getElementById('btnGarageVs')!.addEventListener('click', () => {
  document.getElementById('garage')!.classList.add('hidden');
  versusPanel.open();
});

// PWA (M10): offline-after-first-visit. Production only — dev/preview servers
// don't need a cache and HMR would fight it. Relative path keeps the scope
// correct on GitHub Pages sub-paths and custom domains alike. The page primes
// the SW cache with the assets it already loaded (they predate activation).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js').then(() =>
      navigator.serviceWorker.ready.then((reg) => {
        const urls = [location.href];
        for (const r of performance.getEntriesByType('resource')) {
          const size = (r as PerformanceResourceTiming).transferSize ?? 0;
          if (size > 0 && r.name.startsWith(location.origin)) urls.push(r.name);
        }
        reg.active?.postMessage({ type: 'prime', urls });
      }),
    );
  });
}

// ---------------------------------------------------------------- game shell

type Phase = 'driving' | 'wrecked' | 'results';

class Game {
  readonly scene: GameScene;
  readonly themeName: string;
  private readonly devhud = new DevHud();
  private readonly hud = new GameHud();
  private readonly resultsScreen = new ResultsScreen();
  private readonly keyboard = createKeyboard();
  private readonly arbiter = new InputArbiter();
  readonly quality: QualityManager;
  private readonly onRetryClick = (): void => this.retry();
  private readonly onGarageClick = (): void => {
    if (this.versus) {
      this.leaveVersus();
      return;
    }
    this.toGarage();
  };

  private loop: Loop | null = null;
  private road: RoadSystem;
  private traffic: TrafficSystem;
  private car: Car;
  private scoring: ScoringSystem;
  private damage: DamageSystem;
  private director: DifficultyDirector;
  private theme: ThemeId;
  private phase: Phase = 'driving';
  private runT = 0;
  private paused = false;
  private densityTimer = 0;
  private px = 0;
  private pz = 0;
  private ph = 0;
  private nearMissTotal = 0;
  private crashTotal = 0;
  private coneHits = 0;
  private lastHandStatus = '';
  private handGlow: HTMLElement | null = null;
  private readonly assistView: AssistView = { brake: 0, ttc: Infinity };
  /** player's own brake BEFORE the assist blended in (chip gating) */
  private playerBrakePreAssist = 0;
  private readonly events: EventDirector;
  private readonly telemetry: TelemetryRecorder;
  private runTelemetry: RunTelemetry | null = null;
  /** dev backdoor (?smash=1): ghost truck that re-arms ahead after each hit */
  private smashAgent: import('./sim/trafficTypes').TrafficAgent | null = null;
  /** dev backdoor (?instantwreck=1): results/export E2E without a chase */
  private instantWreck = false;
  /** ADR-018 versus: terminal verdict from the session, once */
  private vsOutcome: { won: boolean; outcome: VsOutcome } | null = null;
  /** opponent left while the results screen was open (hint already swapped) */
  private vsGoneHandled = false;

  constructor(
    private readonly getTracker: () => TrackerLike | null,
    private readonly getPip: () => PipRenderer | null,
    tune: CarTune,
    note?: string,
    private readonly versus: VersusSession | null = null,
    private readonly devices: {
      gamepad: GamepadInput;
      remote: RemoteInput;
      manual: ManualMerge;
    } = { gamepad, remote, manual },
  ) {
    this.theme = pinnedTheme ?? nextTheme;
    if (!pinnedTheme) {
      nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(nextTheme) + 1) % THEME_ORDER.length];
    }
    // ADR-018: a versus race runs the agreed seed — identical worlds
    const runSeed = this.versus?.startSeed ?? ((Date.now() & 0x7fffffff) >>> 0);
    this.road = new RoadSystem({ seed: runSeed, theme: this.theme });
    this.director = new DifficultyDirector(runSeed);
    this.events = new EventDirector(runSeed);
    this.car = new Car(tune);
    this.car.guide = this.road;
    this.telemetry = new TelemetryRecorder(this.car, this.theme, runSeed);
    this.traffic = new TrafficSystem(
      { seed: runSeed, laneCount: this.road.laneCount, laneWidth: this.road.laneWidth },
      this.road,
    );
    // ADR-012: the road is ALIVE from frame one — corridor pre-populated
    // around the player, no empty-start seconds at cruise speeds
    this.traffic.warmup(tune.bodyDims[0] / 2, tune.bodyDims[2] / 2);
    // dev/E2E backdoor (?smash=1): a slow truck in the player's lane 80 m
    // ahead — guarantees a heavy contact to exercise the M6 crash chain
    // (sparks, smoke, crash audio, wreck, results) deterministically.
    if (new URLSearchParams(location.search).has('smash')) {
      const a = this.traffic.agents[0];
      Object.assign(a, {
        active: true, id: 999, family: 5, lane: 1,
        s: 80, lat: 0, dir: 1,
        speed: 6, desiredSpeed: 6, state: 'CRUISE',
        x: 0, z: -80, heading: 0, passCounted: false, hadContact: false,
      });
      this.smashAgent = a;
    }
    this.instantWreck = new URLSearchParams(location.search).has('instantwreck');
    this.scoring = new ScoringSystem();
    this.damage = new DamageSystem(tune.healthMax);
    this.scene = new GameScene(tune, this.road, this.theme, runSeed);
    this.themeName = this.scene.themeName;
    this.quality = new QualityManager(persist.settings.quality, (_level, preset) => {
      this.scene.applyQuality(preset);
    });
    this.scene.applyQuality(this.quality.preset);
    this.scene.setComfort(comfortFromSettings());
    this.setAssistLevel(persist.settings.driverAid);
    if (this.versus) {
      // ghost opponent in THEIR car, versus HUD + countdown, results buttons
      const ghostTune = CAR_TUNES.find((t) => t.id === this.versus!.opponentCarId) ?? tune;
      this.scene.showGhost(ghostTune);
      hudVersusEl.classList.remove('hidden');
      versusCountdownEl.classList.remove('hidden');
      this.versus.onFinish = (won, outcome) => {
        this.vsOutcome = { won, outcome };
        if (this.phase === 'driving') this.enterVersusResults();
      };
      document.getElementById('btnRetryRun')!.classList.add('hidden');
      document.getElementById('btnVsRematch')!.classList.remove('hidden');
      document.getElementById('btnVsLeave')!.classList.remove('hidden');
      document.getElementById('btnVsRematch')!.addEventListener('click', this.onVsRematch);
      document.getElementById('btnVsLeave')!.addEventListener('click', this.onVsLeave);
      document.getElementById('btnVsQuit')!.classList.remove('hidden');
      document.getElementById('btnVsQuit')!.addEventListener('click', this.onVsLeave);
    }
    audio?.retune(tune);
    audio?.setRunning(true);
    this.scene.setDamageState('PRISTINE');
    if (note) this.devhud.note(note);

    window.addEventListener('keydown', this.onKey);
    document.getElementById('btnRetryRun')!.addEventListener('click', this.onRetryClick);
    document.getElementById('btnToGarage')!.addEventListener('click', this.onGarageClick);
    this.hud.show(true);
    this.loop = createLoop({
      step: (dt) => this.step(dt),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    });
    this.loop.start();
  }

  /** M9: freeze the sim while the options overlay is open (render continues). */
  setPaused(on: boolean): void {
    this.paused = on;
  }

  /** ADR-013: driver-aid level (light default / full / off) */
  setAssistLevel(level: AssistLevel): void {
    this.assistParams = ASSIST_LEVELS[level] ?? ASSIST_LEVELS.light;
  }
  private assistParams: AssistParams | null = ASSIST_LEVELS.light;

  private step(dt: number): void {
    if (this.paused) return;
    this.keyboard.update(dt);
    this.devices.gamepad.update();
    this.devices.remote.update();
    const t = performance.now() / 1000;
    const tracker = this.getTracker();
    const handIntent = tracker ? tracker.solver.intent : null;
    const handConf = tracker ? tracker.solver.state.confidence : 0;
    // keyboard + PS4 pad + phone remote → one manual intent
    const manualIntent = this.devices.manual.update(
      this.keyboard.intent,
      this.devices.gamepad.intent,
      this.devices.remote.intent,
      t,
    );
    this.arbiter.update(handIntent, handConf, manualIntent, t);

    this.px = this.car.x;
    this.pz = this.car.z;
    this.ph = this.car.heading;

    if (this.phase === 'results') {
      // background stays alive but the run is over
      this.traffic.update(dt, this.car, this.px, this.pz);
      return;
    }

    // dev backdoor: once the ghost truck has been hit (KNOCKED) or passed,
    // re-arm it 150 m ahead in prime collision condition
    if (
      this.smashAgent &&
      (this.smashAgent.state === 'KNOCKED' || this.smashAgent.s < this.traffic.playerS - 25)
    ) {
      Object.assign(this.smashAgent, {
        active: true, s: this.traffic.playerS + 150, lat: 0, dir: 1,
        speed: 6, desiredSpeed: 6, state: 'CRUISE', signal: 0,
        passCounted: false, hadContact: false,
        nmTracked: false, nmWasAhead: false, nmMinClearance: 99,
        knockedTimer: 0,
      });
    }

    const wrecked = this.phase === 'wrecked';
    let intent = wrecked
      ? { steer: this.arbiter.intent.steer * 0.4, throttle: 0, brake: 0.35 }
      : this.arbiter.intent;
    // versus: nobody moves before GO (the world stays alive behind the gate)
    const vsRace = this.versus?.race ?? null;
    if (vsRace && vsRace.phase === 'countdown') {
      intent = { steer: 0, throttle: 0, brake: 0.4 };
    }

    // EASY (M7): forward-collision mitigation coaxes the brakes when a
    // closing agent is in the player's path — never steers, never slams
    this.playerBrakePreAssist = intent.brake;
    if (!wrecked && this.assistParams) {
      applyAssist(
        intent,
        forwardAssist(
          this.car, intent, this.traffic.agents,
          this.traffic.playerS, this.traffic.playerLat,
          this.assistParams, this.assistView,
        ),
      );
    } else {
      this.assistView.brake = 0;
      this.assistView.ttc = Infinity;
    }

    this.car.step(dt, intent);
    this.traffic.update(dt, this.car, this.px, this.pz);

    // ADR-018: 15 Hz pose stream (road-frame — rebase-proof) + race clock
    if (this.versus) {
      this.road.sample(this.traffic.playerS, VS_SPINE);
      let hRel = this.car.heading - VS_SPINE.heading;
      while (hRel > Math.PI) hRel -= 2 * Math.PI;
      while (hRel < -Math.PI) hRel += 2 * Math.PI;
      this.versus.sendPose(
        this.traffic.playerS, this.traffic.playerLat, hRel, this.car.u, this.car.distance,
        performance.now() / 1000,
      );
      this.versus.tick(dt, this.car.distance);
    }

    // ---- events: main owns the drain order (scoring + damage both feed) ----
    const crashes = this.traffic.takeCrashes();
    const nearMisses = this.traffic.takeNearMisses();
    const passes = this.traffic.takePasses();
    this.runT += dt;
    this.director.tick(dt);
    this.scoring.update(dt, this.car);
    this.scoring.onNearMisses(nearMisses);
    this.scoring.onPasses(passes);
    this.scoring.onCrashes(crashes.length);
    this.nearMissTotal += nearMisses.length;
    this.crashTotal += crashes.length;
    for (const c of crashes) this.director.registerCrash();
    for (const c of crashes) {
      audio?.crash(c.impulse);
      this.devices.remote.sendRumble(); // phone buzzes on impact
      this.scene.fx.burstSparks(c.x, 0.55, c.z, c.impulse);
    }
    for (const nm of nearMisses) {
      audio?.whoosh(nm.side, nm.closingSpeed, nm.oncoming);
    }

    const impulses = crashes.map((c) => c.impulse);
    const events = this.damage.update(
      dt,
      impulses,
      this.scoring.flowRegenClamped(dt, this.damage.health, this.damage.healthMax),
    );
    this.car.powerScale = this.damage.powerScale;
    this.scene.setDamageState(this.damage.state);
    for (const ev of events) {
      if (ev.kind === 'WRECK') {
        audio?.wreck();
        this.scene.fx.wreckBurst(this.car.x, this.car.z);
      }
    }

    if (this.damage.wrecked && !wrecked && this.phase === 'driving') {
      this.phase = 'wrecked';
      if (this.versus) this.versus.localWreck(); // instant loss (ADR-018)
    }
    if (this.phase === 'wrecked' && this.damage.wreckTimer > 2.2) {
      if (this.versus) {
        this.enterVersusResults();
        return;
      }
      this.phase = 'results';
      audio?.setRunning(false);
      this.hud.show(false);
      this.runTelemetry = this.telemetry.finish(this.runT, this.scoring, this.damage);
      this.resultsScreen.show(this.scoring, this.car, this.themeName, this.runT, persist, this.runTelemetry);
      return;
    }

    // gentle live density (EASY: relaxed ramp only)
    this.densityTimer += dt;
    if (this.densityTimer >= 1) {
      this.densityTimer = 0;
      this.traffic.setDensity(densityAt(this.runT));
    }

    if (this.instantWreck && this.runT > 1.5 && this.phase === 'driving') {
      this.damage.update(dt, [80], 0); // scripted wreck (dev backdoor)
    }

    // M8 variety director: survivable set-pieces + readable toasts.
    // Mercy (2 early crashes) pauses the schedule.
    const ev = this.events.tick(dt, this.traffic, this.road, {
      s: this.traffic.playerS,
      lat: this.traffic.playerLat,
      u: this.car.u,
      halfW: this.car.tune.bodyDims[0] / 2,
      halfL: this.car.tune.bodyDims[2] / 2,
    }, this.director.state.runTime < this.director.state.mercyUntil);
    if (ev) this.hud.notify(EVENT_LABEL[ev], 'pass');
    this.telemetry.sample(dt, this.scoring, this.damage, this.assistView.brake);

    // floating origin: pure +z translation, exact
    const dz = this.road.maybeRebase(this.car.z);
    if (dz !== 0) {
      this.car.z += dz;
      this.pz += dz;
      this.traffic.shiftWorld(dz);
      this.scene.rig.rebase(dz);
      this.scene.rebase(dz);
    }
  }

  private render(alpha: number, frameDt: number): void {
    const tracker = this.getTracker();
    const pip = this.getPip();
    const pose = {
      x: this.px + (this.car.x - this.px) * alpha,
      z: this.pz + (this.car.z - this.pz) * alpha,
      heading: this.ph + (this.car.heading - this.ph) * alpha,
    };
    this.coneHits += this.scene.update(pose, this.car, this.traffic, frameDt, performance.now() / 1000);
    if (this.versus) {
      if (this.phase === 'results' && this.versus.opponentGone && !this.vsGoneHandled) {
        this.vsGoneHandled = true;
        this.applyVersusResultChrome();
      }
      const rem = this.versus.remote;
      if (rem && this.versus.remoteAgeSec < 3) {
        this.scene.updateGhost(rem.s, rem.lat, rem.hRel, rem.u, frameDt);
      }
      const race = this.versus.race;
      if (race) {
        if (race.phase === 'countdown') {
          versusCountdownEl.classList.remove('hidden');
          versusCountdownEl.textContent = String(Math.max(1, Math.ceil(race.countdown)));
          hudVersusEl.textContent = 'GET READY';
        } else {
          if (race.phase === 'racing' && race.time < 1.0) {
            versusCountdownEl.classList.remove('hidden');
            versusCountdownEl.textContent = 'GO';
          } else {
            versusCountdownEl.classList.add('hidden');
          }
          const gap = race.gap;
          hudVersusEl.textContent =
            race.phase === 'racing' || race.phase === 'finished'
              ? `${race.position}${race.position === 1 ? 'st' : 'nd'} · ${gap >= 0 ? '+' : ''}${Math.round(gap)} m` +
                (this.versus.pingMs !== null ? ` · ${Math.round(this.versus.pingMs)} ms` : '')
              : '';
        }
      }
    }
    pip?.draw();
    audio?.updateEngine(this.car, frameDt);
    this.quality.observeFrame(frameDt * 1000);
    if (this.phase !== 'results') {
      this.hud.update(this.car, this.scoring, this.damage);
      this.hud.setAssist(
        this.assistView.brake > 0.05 && this.assistView.brake > this.playerBrakePreAssist + 0.03
          ? this.assistView.brake
          : 0,
      );
      this.updateHandGlow(tracker);
    }

    const pS = this.traffic.playerS;
    const chunk = Math.floor(pS / 256);
    const onc = this.road.oncomingAt(pS);
    const zone = onc > 0 ? 'ONCOMING ×2' : this.road.chunkFeature(chunk).construction ? 'CONSTRUCTION' : 'clear';
    const st = tracker?.solver.state;
    this.devhud.update(frameDt, this.scene.renderer, this.car.u, this.car.x, {
      carName: this.car.tune.name,
      gear: this.car.gear,
      rpmNorm: this.car.rpmNorm,
      betaDeg: (this.car.beta * 180) / Math.PI,
      latG: this.car.ayLast / 9.81,
      camMode: CAM_MODES[this.scene.rig.mode],
      input: tracker
        ? `${this.arbiter.source}${this.devices.manual.source ? `(${this.devices.manual.source})` : ''}${this.devices.remote.status === 'open' ? ` · phone ${this.devices.remote.latencyMs.toFixed(0)}ms` : ''}${this.devices.gamepad.connected ? ' · pad' : ''} ${st ? st.status : ''} ${tracker.info.latencyMs.toFixed(0)}ms ${tracker.info.delegate} · aid ${this.assistView.brake.toFixed(2)} · t${this.car.throttleIn.toFixed(2)} b${this.car.brakeIn.toFixed(2)}`
        : `${this.arbiter.source}${this.devices.manual.source ? `(${this.devices.manual.source})` : ''}${this.devices.remote.status === 'open' ? ` · phone ${this.devices.remote.latencyMs.toFixed(0)}ms` : ''}${this.devices.gamepad.connected ? ' · pad' : ''} · aid ${this.assistView.brake.toFixed(2)} · t${this.car.throttleIn.toFixed(2)} b${this.car.brakeIn.toFixed(2)}`,
      traffic: `${this.nearMissTotal} near-miss · ${this.crashTotal} crashes · ${this.traffic.agents.filter((a) => a.active).length} cars · events ${this.events.history.length}${this.events.history.length ? ` (last ${this.events.history[this.events.history.length - 1]})` : ''}`,
      world: `${this.themeName} · s ${pS.toFixed(0)} · chunk ${chunk} · ${zone} · gen ${this.road.maxBuildMs.toFixed(2)}ms${this.coneHits > 0 ? ` · cones ${this.coneHits}` : ''}`,
      quality: `${this.quality.mode === 'auto' ? 'auto' : 'pinned'} ${this.quality.level} · ema ${this.quality.emaMs.toFixed(1)} ms`,
      audio: audio
        ? `engine ${this.car.tune.id} · latency ${audio.latencyMs !== null ? `${audio.latencyMs.toFixed(1)} ms` : 'n/a'} · vol ${(persist.settings.volume * 100).toFixed(0)}%`
        : 'unavailable',
    });
  }

  /** Screen-edge glow + status toast tied to hand-tracking health (AR). */
  private updateHandGlow(tracker: { solver: { state: { status: string } } } | null): void {
    if (!this.handGlow) this.handGlow = document.getElementById('handGlow');
    const el = this.handGlow;
    if (!el) return;
    const status = tracker?.solver.state.status ?? 'NO_CAMERA';
    if (status !== this.lastHandStatus) {
      if (this.lastHandStatus === 'HANDS_LOST' && status !== 'HANDS_LOST') {
        this.hud.notify('HANDS BACK', 'pass');
      } else if (status === 'HANDS_LOST' && this.phase === 'driving') {
        this.hud.notify('HANDS LOST — holding the car', 'near');
      }
      this.lastHandStatus = status;
    }
    const cls =
      status === 'TRACKING' ? 'glow-hands'
      : status === 'HANDS_LOST' || status === 'NO_CAMERA' ? 'glow-lost'
      : 'glow-partial';
    if (!el.classList.contains(cls)) {
      el.classList.remove('glow-hands', 'glow-partial', 'glow-lost');
      el.classList.add(cls);
    }
  }

  private onKey = (e: KeyboardEvent): void => {
    if (options.isOpen) return; // options owns the keyboard while open
    if (e.code === 'KeyC') this.scene.cycleCamera();
    else if (e.code === 'KeyT') this.cycleTheme();
    else if (e.code === 'KeyQ') this.cycleQuality();
    else if (e.code === 'Digit1') this.switchCar(0);
    else if (e.code === 'Digit2') this.switchCar(1);
    else if (e.code === 'Digit3') this.switchCar(2);
    else if (this.phase === 'results' && !this.versus && (e.code === 'KeyR' || e.code === 'Enter')) {
      this.retry();
    } else if (this.phase === 'results' && this.versus && (e.code === 'KeyR' || e.code === 'Enter')) {
      // versus "again" = leave to the garage (REMATCH needs the opponent;
      // R must ALWAYS work — a dead host must never trap the player)
      this.leaveVersus();
    } else if (this.phase === 'results' && e.code === 'KeyG') {
      if (this.versus) this.leaveVersus();
      else this.toGarage();
    }
  };

  private switchCar = (index: number): void => {
    const tune = CAR_TUNES[index];
    if (!tune || !persist.progress.unlocks.includes(tune.id) || this.phase === 'results') return;
    const old = this.car;
    this.car = new Car(tune);
    this.car.guide = this.road;
    this.car.x = old.x;
    this.car.z = old.z;
    this.car.heading = old.heading;
    this.car.u = old.u;
    this.scene.setCarTune(tune);
    this.damage = new DamageSystem(tune.healthMax);
    this.scene.setDamageState('PRISTINE');
    audio?.retune(tune);
  };

  private cycleTheme = (): void => {
    const cur = THEME_ORDER.indexOf(this.theme);
    this.theme = THEME_ORDER[(cur + 1) % THEME_ORDER.length];
    this.scene.setTheme(this.theme);
    this.devhud.note(`theme → ${this.theme} (visuals only — zone layout keeps the run's seed)`);
  };

  private cycleQuality = (): void => {
    this.quality.cycle();
    this.devhud.note(`quality → ${this.quality.mode === 'auto' ? `auto (${this.quality.level})` : this.quality.level}`);
  };

  private retry(): void {
    const tune = this.car.tune;
    this.dispose();
    launch(tune, this.getTracker, this.getPip);
  }

  private toGarage(): void {
    this.dispose();
    showGarage();
  }

  /** ADR-018: versus verdict → shared results screen with VICTORY/DEFEAT */
  private enterVersusResults(): void {
    if (this.phase === 'results') return;
    this.phase = 'results';
    audio?.setRunning(false);
    this.hud.show(false);
    versusCountdownEl.classList.add('hidden');
    this.runTelemetry = this.telemetry.finish(this.runT, this.scoring, this.damage);
    const oc = this.vsOutcome;
    const how = describeVsOutcome(oc?.outcome);
    this.resultsScreen.show(
      this.scoring, this.car, this.themeName, this.runT, persist, this.runTelemetry,
      oc ? { title: oc.won ? 'VICTORY' : 'DEFEAT', line: `${how} · ${(this.traffic.playerS / 1000).toFixed(2)} km driven` } : null,
    );
    this.applyVersusResultChrome();
  }

  /** versus results: role-correct hint; rematch dies with the opponent */
  private applyVersusResultChrome(): void {
    const vs = this.versus;
    if (!vs) return;
    const hint = document.getElementById('resultsHint')!;
    const rematch = document.getElementById('btnVsRematch')!;
    if (vs.opponentGone) {
      rematch.classList.add('hidden');
      hint.textContent = 'opponent left — R or ENTER — back to garage for a new match';
    } else if (vs.isHost) {
      hint.textContent = 'REMATCH — race again (new world) · R — back to garage';
    } else {
      hint.textContent = 'REMATCH — ask the host to race again · R — back to garage';
    }
  }

  private readonly onVsRematch = (): void => {
    if (!this.versus) return;
    // host reseeds + restarts both sides; guest asks (host auto-accepts)
    if (this.versus.isHost) this.versus.sendRematch();
    else this.versus.requestRematch();
  };

  private readonly onVsLeave = (): void => this.leaveVersus();

  private leaveVersus(): void {
    this.versus?.leave();
    versusSession = null;
    versusPanelReset();
    this.dispose();
    showGarage();
  }

  dispose(): void {
    this.loop?.stop();
    this.loop = null;
    // versus chrome off (a rematch re-shows it in the next Game)
    document.getElementById('btnRetryRun')!.classList.remove('hidden');
    document.getElementById('btnVsRematch')!.classList.add('hidden');
    document.getElementById('btnVsLeave')!.classList.add('hidden');
    document.getElementById('btnVsRematch')!.removeEventListener('click', this.onVsRematch);
    document.getElementById('btnVsLeave')!.removeEventListener('click', this.onVsLeave);
    document.getElementById('btnVsQuit')!.classList.add('hidden');
    document.getElementById('btnVsQuit')!.removeEventListener('click', this.onVsLeave);
    hudVersusEl.classList.add('hidden');
    versusCountdownEl.classList.add('hidden');
    this.scene.hideGhost();
    audio?.setRunning(false);
    this.resultsScreen.hide();
    this.hud.show(false);
    this.scene.dispose();
    window.removeEventListener('keydown', this.onKey);
    document.getElementById('btnRetryRun')!.removeEventListener('click', this.onRetryClick);
    document.getElementById('btnToGarage')!.removeEventListener('click', this.onGarageClick);
  }
}

// -------------------------------------------------------------------- flow

const garage = new Garage(
  persist,
  (tune) => chooseInput(tune),
  () => overlay.classList.remove('hidden'),
);

function showGarage(): void {
  garage.show(persist.settings.car);
}

function chooseInput(tune: CarTune): void {
  audio?.init();
  if (pipdemo) {
    demoHands = new DemoHands();
    demoHands.start();
    applyTrackerSettings(demoHands);
    pipwrap.classList.remove('hidden');
    const pip = new PipRenderer(document.getElementById('pip') as HTMLCanvasElement, demoHands);
    launch(tune, () => demoHands, () => pip, 'pip demo — synthetic hands drive the real pipeline');
    return;
  }
  audio?.retune(tune);
  audio?.revBlip();
  camchoice.classList.remove('hidden');
  const onCam = (): void => {
    camchoice.classList.add('hidden');
    void startWithCamera(tune);
  };
  const onKb = (): void => {
    camchoice.classList.add('hidden');
    launch(tune, null, null);
  };
  const bCam = document.getElementById('btnCam')!;
  const bKb = document.getElementById('btnKb')!;
  bCam.addEventListener('click', onCam, { once: true });
  bKb.addEventListener('click', onKb, { once: true });
}

async function startWithCamera(tune: CarTune): Promise<void> {
  const tracker = new HandTracker();
  // start() resolves only when the worker is genuinely READY (or classified error)
  await tracker.start();
  if (tracker.info.phase !== 'READY') {
    const why = tracker.info.error ?? tracker.info.phase;
    tracker.stop();
    showCamLost(
      why,
      () => void startWithCamera(tune),
      () => launch(tune, null, null, `camera unavailable — ${why}. Keyboard mode.`),
    );
    return;
  }
  applyTrackerSettings(tracker);
  pipwrap.classList.remove('hidden');
  const pip = new PipRenderer(document.getElementById('pip') as HTMLCanvasElement, tracker);

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

  bootWithRecovery(tune, tracker, pip);
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

function bootWithRecovery(tune: CarTune, initialTracker: HandTracker, initialPip: PipRenderer): void {
  let tracker: HandTracker | null = initialTracker;
  let pip: PipRenderer | null = initialPip;

  const onLost = (reason: string): void => {
    camlostReason.textContent = reason;
    camlost.classList.remove('hidden');
  };
  initialTracker.onLost = onLost;

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
    nt.onLost = onLost;
    tracker = nt;
    applyTrackerSettings(nt);
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

  launch(tune, () => tracker, () => pip);
}

function launch(
  tune: CarTune,
  getTracker: (() => TrackerLike | null) | null,
  getPip: (() => PipRenderer | null) | null,
  note?: string,
): void {
  currentGame?.dispose();
  getTrackerFn = getTracker;
  getPipFn = getPip;
  currentGame = new Game(
    getTracker ?? (() => null),
    getPip ?? (() => null),
    tune,
    note,
  );
}

/** M9 options → recalibrate: park the run, replay the wizard, resume. */
async function recalibrateHands(): Promise<void> {
  const tracker = getTrackerFn?.() ?? null;
  if (!(tracker instanceof HandTracker)) {
    // demo/keyboard: nothing to recalibrate — resume immediately
    currentGame?.setPaused(false);
    return;
  }
  currentGame?.setPaused(true);
  const pip =
    getPipFn?.() ?? new PipRenderer(document.getElementById('pip') as HTMLCanvasElement, tracker);
  wizardRoot.classList.remove('hidden');
  pipwrap.classList.remove('hidden');
  pipMount.appendChild(pipwrap);
  const wizard = new CalibrationWizard(tracker, pip, {
    root: wizardRoot,
    title: document.getElementById('wizardTitle') as HTMLElement,
    body: document.getElementById('wizardBody') as HTMLElement,
    progress: document.getElementById('wizardBar') as HTMLElement,
  });
  await wizard.run();
  document.body.appendChild(pipwrap); // PiP back to its corner
  wizardRoot.classList.add('hidden');
  currentGame?.setPaused(false);
}

const VS_SPINE: SpinePoint = { x: 0, z: 0, heading: 0 };

function describeVsOutcome(outcome: VsOutcome | undefined): string {
  switch (outcome) {
    case 'win-distance': return 'first to the finish';
    case 'loss-distance': return 'opponent got there first';
    case 'win-wreck': return 'opponent wrecked';
    case 'loss-wreck': return 'you wrecked';
    case 'win-disconnect': return 'opponent disconnected';
    case 'loss-disconnect': return 'you disconnected';
    default: return 'race over';
  }
}

overlay.addEventListener(
  'click',
  () => {
    audio?.init();
    overlay.classList.add('hidden');
    showGarage();
  },
  { once: true },
);
