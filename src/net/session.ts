// VersusSession (ADR-018): owns one match end-to-end — the BusLink (MQTT
// over WSS), the VersusRace state machine, and the message glue between
// them. The lobby UI and the Game both talk to the session; network
// callbacks are dispatched by session STATE so the same link survives the
// lobby → race → results → rematch transitions without rewiring.
//
// Bus semantics vs WebRTC: there is no "connection" to the opponent — both
// sides just publish on their topic. The GUEST therefore repeats hello every
// second until the host's start arrives (self-healing against a lost first
// message or a host that hasn't created the match yet), and a 20 s join
// timeout reports "no match with that code".

import { BusLink } from './bus';
import { VersusRace, type VsOutcome } from './versus';
export type { VsOutcome };
import type { VsMsg } from './protocol';

export type SessionState = 'connecting' | 'lobby' | 'countdown' | 'racing' | 'finished' | 'dead';

export interface RemotePose {
  /** road-frame arclength + lateral (rebase-proof, ADR-018) */
  s: number;
  lat: number;
  /** heading relative to the spine heading at s */
  hRel: number;
  u: number;
  /** opponent odometer, m (the race metric) */
  d: number;
}

export interface VersusStartConfig {
  seed: number;
  target: number;
}

export const VS_TARGET_M = 5000;

/** e2e/testing hook: ?vstarget= shortens the race distance (min 200 m). */
function vsTargetFromUrl(): number {
  try {
    const t = Number(new URLSearchParams(location.search).get('vstarget'));
    return t >= 200 && t <= 50000 ? t : VS_TARGET_M;
  } catch {
    return VS_TARGET_M;
  }
}

export class VersusSession {
  readonly isHost: boolean;
  readonly code: string;
  state: SessionState = 'connecting';
  race: VersusRace | null = null;
  opponentName = 'Player 2';
  opponentCarId = 'falcone-gt';
  /** what WE tell the opponent (set by the lobby from the garage pick) */
  myCarId = 'falcone-gt';
  pingMs: number | null = null;
  /** status text the lobby/result UI renders verbatim */
  statusText = 'connecting…';
  remote: RemotePose | null = null;
  remoteAgeSec = Infinity;

  private link: BusLink | null = null;
  private waitHintTimer: ReturnType<typeof setTimeout> | null = null;
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private joinTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPoseAt = 0;
  private seed = 0;
  private target = vsTargetFromUrl();

  /** lobby: the code is out / we're on the relay */
  onLobby: () => void = () => {};
  /** the race config is agreed — launch the Game (both sides) */
  onStart: (cfg: VersusStartConfig) => void = () => {};
  /** terminal verdict — show the versus result screen */
  onFinish: (won: boolean, outcome: VsOutcome) => void = () => {};
  /** anything visual changed (status, ping, state) */
  onChanged: () => void = () => {};

  private constructor(isHost: boolean, code: string) {
    this.isHost = isHost;
    this.code = code;
  }

  static async host(code: string, brokerUrl?: string): Promise<VersusSession> {
    const s = new VersusSession(true, code);
    s.link = await BusLink.create(code, true, s.callbacks(), brokerUrl);
    return s;
  }

  static async join(code: string, brokerUrl?: string): Promise<VersusSession> {
    const s = new VersusSession(false, code);
    s.link = await BusLink.create(code, false, s.callbacks(), brokerUrl);
    return s;
  }

  private callbacks() {
    return {
      onReady: () => {
        this.state = 'lobby';
        this.statusText = this.isHost
          ? 'share your code — waiting for an opponent…'
          : 'joining…';
        this.onLobby();
        this.onChanged();
        if (this.isHost) {
          this.waitHintTimer = setTimeout(() => {
            if (this.state === 'lobby') {
              this.statusText = 'still waiting — if it stalls, create a new code';
              this.onChanged();
            }
          }, 45000);
        } else {
          // no match by this code? say so instead of waiting forever
          this.joinTimeoutTimer = setTimeout(() => {
            if (this.state === 'lobby') {
              this.state = 'dead';
              this.statusText = 'no match with that code right now — ask for a fresh code';
              this.onChanged();
            }
          }, 20000);
        }
      },
      onPeerConnected: () => {
        // bus: guest-side only — the channel is open, start knocking
        if (this.state !== 'lobby' || this.isHost) return;
        this.startHelloRepeat();
      },
      onMessage: (msg: VsMsg) => this.handle(msg),
      onPing: (ms: number) => {
        this.pingMs = ms;
        this.onChanged();
      },
      onPeerClosed: () => {
        if (this.state === 'finished' || this.state === 'dead') return;
        this.race?.remoteLeft();
        this.settle();
        if ((this.state as SessionState) !== 'finished') {
          this.state = 'dead';
          this.statusText = 'opponent left';
          this.onChanged();
        }
      },
      onFail: (reason: string) => {
        this.state = 'dead';
        this.statusText = reason;
        this.onChanged();
      },
    };
  }

  private startHelloRepeat(): void {
    if (this.helloTimer !== null) return;
    const hello = (): void => this.send({ t: 'hello', name: 'Player 2', carId: this.myCarId });
    hello();
    this.helloTimer = setInterval(hello, 1000);
  }

  private stopHelloRepeat(): void {
    if (this.helloTimer !== null) {
      clearInterval(this.helloTimer);
      this.helloTimer = null;
    }
    if (this.joinTimeoutTimer !== null) {
      clearTimeout(this.joinTimeoutTimer);
      this.joinTimeoutTimer = null;
    }
  }

  private handle(msg: VsMsg): void {
    switch (msg.t) {
      case 'hello':
        this.opponentName = msg.name || 'Player 2';
        this.opponentCarId = msg.carId || 'falcone-gt';
        if (this.isHost && this.state === 'lobby') {
          // host answers + immediately proposes the race (auto-start arcade flow)
          if (this.waitHintTimer !== null) {
            clearTimeout(this.waitHintTimer);
            this.waitHintTimer = null;
          }
          this.statusText = 'opponent connected';
          this.send({ t: 'hello', name: 'Host', carId: this.myCarId });
          this.beginRace((Date.now() & 0x7fffffff) >>> 0, this.target, true);
        }
        this.onChanged();
        break;
      case 'start':
        if (!this.isHost && (this.state === 'lobby' || this.state === 'finished')) {
          this.stopHelloRepeat();
          this.beginRace(msg.seed, msg.target, false);
        }
        break;
      case 'pose':
        this.remote = { s: msg.p[0], lat: msg.p[1], hRel: msg.p[2], u: msg.p[3], d: msg.p[4] };
        this.remoteAgeSec = 0;
        break;
      case 'finish':
        this.race?.remoteFinish();
        this.settle();
        break;
      case 'wrecked':
        this.race?.remoteWrecked();
        this.settle();
        break;
      case 'rematch':
        // guest wants to go again — host decides; auto-accept keeps it simple
        if (this.isHost && this.state === 'finished') {
          this.sendRematch();
        }
        break;
      case 'bye':
        this.race?.remoteLeft();
        this.settle();
        break;
      default:
        break;
    }
  }

  /** HOST: create a fresh race and tell the guest (or relay a rematch). */
  beginRace(seed: number, target: number, notify: boolean): void {
    this.seed = seed;
    this.target = target;
    this.race = new VersusRace(target);
    this.remote = null;
    this.remoteAgeSec = Infinity;
    this.state = 'countdown';
    this.statusText = 'get ready…';
    this.stopHelloRepeat();
    if (notify) this.send({ t: 'start', seed, target, goIn: 3.2 });
    this.onStart({ seed, target });
    this.onChanged();
  }

  /** HOST results screen: reseed and run it again. */
  sendRematch(): void {
    if (!this.isHost || this.state !== 'finished') return;
    this.beginRace((Date.now() & 0x7fffffff) >>> 0, this.target, true);
  }

  /** GUEST results screen: ask the host for a rematch. */
  requestRematch(): void {
    if (this.isHost || this.state !== 'finished') return;
    this.send({ t: 'rematch' });
    this.statusText = 'asking the host for a rematch…';
    this.onChanged();
  }

  sendPose(s: number, lat: number, hRel: number, u: number, d: number, nowSec: number): void {
    if (nowSec - this.lastPoseAt < 1 / 15) return; // 15 Hz stream
    this.lastPoseAt = nowSec;
    this.send({ t: 'pose', p: [s, lat, hRel, u, d] });
  }

  sendLocalFinish(): void {
    this.send({ t: 'finish', d: this.race?.localDist ?? 0, rt: this.race?.time ?? 0 });
  }

  sendLocalWreck(): void {
    this.send({ t: 'wrecked' });
  }

  /** advance the race (call from the Game step). */
  tick(dt: number, localDist: number): VersusRace | null {
    this.remoteAgeSec += dt;
    const race = this.race;
    if (!race || this.state === 'finished' || this.state === 'dead') return race;
    race.tick(dt, localDist, this.remote?.d ?? 0, this.remoteAgeSec);
    this.settle();
    return race;
  }

  localWreck(): void {
    this.race?.localWreck();
    this.settle();
  }

  /** after any verdict-setting event: latch the terminal state once. */
  private settle(): void {
    const race = this.race;
    if (this.state === 'finished' || this.state === 'dead') return;
    if (race && race.phase === 'finished' && race.outcome) {
      if (race.outcome === 'win-distance') this.sendLocalFinish();
      if (race.outcome === 'loss-wreck') this.sendLocalWreck();
      this.state = 'finished';
      this.statusText = race.won ? 'you win' : 'you lose';
      this.onFinish(race.won, race.outcome);
      this.onChanged();
    }
  }

  private send(msg: VsMsg): void {
    this.link?.send(msg);
  }

  /** world seed of the CURRENT/last agreed race (Game consumes it) */
  get startSeed(): number {
    return this.seed;
  }

  leave(): void {
    if (this.waitHintTimer !== null) {
      clearTimeout(this.waitHintTimer);
      this.waitHintTimer = null;
    }
    this.stopHelloRepeat();
    const wasTerminal = this.state === 'finished' || this.state === 'dead';
    this.state = 'dead';
    if (!wasTerminal) this.send({ t: 'bye' });
    this.link?.close();
    this.link = null;
    this.onChanged();
  }
}
