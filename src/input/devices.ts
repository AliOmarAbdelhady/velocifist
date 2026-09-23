// Physical controllers (M12/ADR-013): PlayStation DualShock 4 (and any
// standard-mapped gamepad) via the Gamepad API, and the phone remote via a
// local WebSocket relay (scripts/remote-relay.mjs). Each source produces a
// DriverIntent; main merges them with the keyboard into ONE manual intent
// (most-recent-activity wins) which the arbiter plays against the hands.

import type { DriverIntent } from '../sim/intent';

const DEADZONE = 0.12;

/**
 * Normalize anything the user types into a relay WebSocket URL (pure — tested).
 * '192.168.1.3:8443' → ws:// or wss:// depending on the PAGE's protocol: an
 * https page (the production site) can never open ws:// — mixed content is
 * blocked — so insecure schemes are upgraded to wss when the page is https.
 */
export function normalizeRelayUrl(input: string, pageProtocol: string): string {
  let u = input.trim().replace(/\/$/, '');
  if (/^wss?:\/\//.test(u)) {
    // keep an explicit scheme, but https pages cannot use ws://
  } else if (/^https?:\/\//.test(u)) {
    u = (u.startsWith('https') ? 'wss://' : 'ws://') + u.replace(/^https?:\/\//, '');
  } else {
    u = (pageProtocol === 'https:' ? 'wss://' : 'ws://') + u;
  }
  if (pageProtocol === 'https:' && u.startsWith('ws://')) {
    u = 'wss://' + u.slice('ws://'.length);
  }
  return u;
}

/** Map a standard-mapped gamepad to intent (pure — tested). */
export function gamepadIntent(
  pad: { axes: readonly number[]; buttons: readonly { value: number; pressed: boolean }[] },
): DriverIntent {
  const steerAxis = pad.axes[0] ?? 0;
  const mag = Math.min(1, Math.max(0, Math.abs(steerAxis) - DEADZONE) / (1 - DEADZONE));
  // cubic curve: fine control near centre, full lock at the stick extremes
  const steer = Math.sign(steerAxis) * mag * mag * mag;
  // DualShock 4 (standard mapping in Chrome/Edge): 0=✕ 1=○ 2=□ 6=L2 7=R2.
  // Analog triggers preferred; buttons as digital fallback.
  const r2 = pad.buttons[7]?.value ?? 0;
  const l2 = pad.buttons[6]?.value ?? 0;
  const throttle = Math.max(r2, pad.buttons[0]?.pressed ? 1 : 0);
  const brake = Math.max(l2, pad.buttons[1]?.pressed || pad.buttons[2]?.pressed ? 1 : 0);
  return { steer, throttle, brake };
}

export class GamepadInput {
  readonly intent: DriverIntent = { steer: 0, throttle: 0, brake: 0 };
  /** index of the gamepad we locked onto (-1 = none yet) */
  private locked = -1;

  get connected(): boolean {
    return this.locked >= 0 && this.pad() !== null;
  }

  private pad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.locked >= 0) return pads[this.locked];
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]) {
        this.locked = i;
        return pads[i];
      }
    }
    return null;
  }

  /** Call once per sim step. Safe when no pad is present. */
  update(): void {
    const pad = this.pad();
    if (!pad) {
      this.intent.steer = 0;
      this.intent.throttle = 0;
      this.intent.brake = 0;
      return;
    }
    const next = gamepadIntent(pad);
    this.intent.steer = next.steer;
    this.intent.throttle = next.throttle;
    this.intent.brake = next.brake;
  }
}

export type RemoteStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

/**
 * Phone remote: receives {t:'i',s,th,br} input frames from the relay and
 * sends pings for the latency readout. Input decays to zero if the phone
 * goes quiet (screen lock, WiFi hiccup) so the car never sticks on.
 */
export class RemoteInput {
  readonly intent: DriverIntent = { steer: 0, throttle: 0, brake: 0 };
  status: RemoteStatus = 'idle';
  latencyMs = 0;
  onRumble: (() => void) | null = null;
  private ws: WebSocket | null = null;
  private lastMsgAt = 0;
  private pingId = 0;
  private pingSentAt = 0;
  private pingTimer: number | null = null;
  private readonly decayMs: number;

  constructor(decayMs = 500) {
    this.decayMs = decayMs;
  }

  connect(url: string): void {
    this.disconnect();
    this.status = 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.status = 'error';
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.status = 'open';
      this.lastMsgAt = performance.now();
      this.pingTimer = window.setInterval(() => this.ping(), 700);
    };
    ws.onclose = () => {
      this.status = 'closed';
      this.stopPing();
    };
    ws.onerror = () => {
      this.status = 'error';
      this.stopPing();
    };
    ws.onmessage = (ev) => {
      this.lastMsgAt = performance.now();
      let m: { t?: string; s?: number; th?: number; br?: number; id?: number };
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m.t === 'i') {
        this.intent.steer = Math.max(-1, Math.min(1, m.s ?? 0));
        this.intent.throttle = Math.max(0, Math.min(1, m.th ?? 0));
        this.intent.brake = Math.max(0, Math.min(1, m.br ?? 0));
      } else if (m.t === 'pong' && typeof m.id === 'number') {
        if (m.id === this.pingId) this.latencyMs = performance.now() - this.pingSentAt;
      } else if (m.t === 'rumble') {
        this.onRumble?.();
      }
    };
  }

  private ping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.pingId++;
    this.pingSentAt = performance.now();
    this.ws.send(JSON.stringify({ t: 'ping', id: this.pingId }));
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  update(): void {
    if (
      this.status === 'open' &&
      this.lastMsgAt > 0 &&
      performance.now() - this.lastMsgAt > this.decayMs
    ) {
      this.intent.steer = 0;
      this.intent.throttle = 0;
      this.intent.brake = 0;
    }
  }

  sendRumble(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('{"t":"rumble-host"}');
  }

  disconnect(): void {
    this.stopPing();
    this.ws?.close();
    this.ws = null;
    this.status = 'idle';
    this.intent.steer = 0;
    this.intent.throttle = 0;
    this.intent.brake = 0;
  }
}

/**
 * Merge keyboard/gamepad/remote into one manual intent: the source with the
 * most recent meaningful activity wins (held inputs keep their source).
 */
export class ManualMerge {
  readonly intent: DriverIntent = { steer: 0, throttle: 0, brake: 0 };
  /** label of the currently winning source ('keyboard' | 'gamepad' | 'remote' | '') */
  source = '';
  private lastActive: Record<string, number> = { keyboard: -1, gamepad: -1, remote: -1 };

  update(
    keyboard: DriverIntent,
    gamepad: DriverIntent,
    remote: DriverIntent,
    t: number,
  ): DriverIntent {
    const live: Array<[string, DriverIntent]> = [
      ['keyboard', keyboard],
      ['gamepad', gamepad],
      ['remote', remote],
    ];
    let best = '';
    let bestT = -1;
    for (const [name, src] of live) {
      const active = Math.abs(src.steer) > 0.02 || src.throttle > 0.02 || src.brake > 0.02;
      if (active) this.lastActive[name] = t;
      if (t - this.lastActive[name] < 0.5 && this.lastActive[name] > bestT) {
        bestT = this.lastActive[name];
        best = name;
      }
    }
    this.source = best;
    const pick = best ? (live.find(([n]) => n === best)?.[1] as DriverIntent) : null;
    this.intent.steer = pick ? pick.steer : 0;
    this.intent.throttle = pick ? pick.throttle : 0;
    this.intent.brake = pick ? pick.brake : 0;
    return this.intent;
  }
}
