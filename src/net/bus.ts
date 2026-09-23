// BusLink (ADR-018 v2): the versus transport — MQTT over secure WebSocket
// through public anonymous brokers. Replaces WebRTC/PeerJS: public TURN is
// effectively dead (OpenRelay's shared credentials stopped allocating relay
// candidates), and STUN-only WebRTC fails silently on CGNAT/symmetric-NAT
// pairs — exactly the phone-vs-laptop case versus must support. A WSS relay
// needs NO NAT traversal: it works on any pair of networks, full stop.
// Measured through broker.emqx.io: ~100 ms publish→deliver, plenty for the
// 15 Hz ghost-pose stream.
//
// Topics (per match): roben-race/v1/<CODE>/a (host→guest) and /b (guest→host).
// Each side subscribes to the peer's topic and publishes on its own. Presence
// is app-level: hello repeats until the race starts, ping/pong at 1 Hz, a
// Last-Will 'bye' publishes if a tab dies ungracefully, and the session's
// 6-second silence guard settles races the network ate.

import { encodeMsg, decodeMsg, type VsMsg } from './protocol';

export interface BusCallbacks {
  /** broker connected + subscribed — the channel is usable */
  onReady(): void;
  /** the guest may start talking (the bus has no connection event) */
  onPeerConnected(): void;
  onMessage(msg: VsMsg): void;
  onPing(ms: number): void;
  /** the opponent published a graceful bye (or their Last-Will fired) */
  onPeerClosed(): void;
  onFail(reason: string): void;
}

const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
const TOPIC_BASE = 'roben-race/v1';

interface MqttClientLike {
  on(event: string, cb: (...args: unknown[]) => void): void;
  subscribe(topic: string): void;
  publish(topic: string, payload: string): void;
  end(force?: boolean): void;
}

export class BusLink {
  private client: MqttClientLike | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private readonly myTopic: string;
  private readonly peerTopic: string;

  private constructor(
    private readonly cb: BusCallbacks,
    private readonly code: string,
    private readonly isHost: boolean,
    private readonly brokerOverride?: string,
  ) {
    this.myTopic = `${TOPIC_BASE}/${code}/${isHost ? 'a' : 'b'}`;
    this.peerTopic = `${TOPIC_BASE}/${code}/${isHost ? 'b' : 'a'}`;
  }

  static async create(code: string, isHost: boolean, cb: BusCallbacks, brokerOverride?: string): Promise<BusLink> {
    const link = new BusLink(cb, code, isHost, brokerOverride);
    await link.connect();
    return link;
  }

  private async connect(): Promise<void> {
    const urls = this.brokerOverride ? [this.brokerOverride, ...BROKERS] : BROKERS;
    const { default: mqtt } = (await import('mqtt')) as unknown as {
      default: {
        connect(url: string, opts: Record<string, unknown>): MqttClientLike;
      };
    };
    let lastErr = 'unknown error';
    for (const url of urls) {
      const ok = await new Promise<boolean>((resolve) => {
        let settled = false;
        const client = mqtt.connect(url, {
          clientId: `roben-${this.code}-${this.isHost ? 'h' : 'g'}-${Math.random().toString(16).slice(2, 8)}`,
          clean: true,
          keepalive: 20,
          connectTimeout: 8000,
          reconnectPeriod: 0, // we manage fallbacks ourselves
          will: { topic: this.myTopic, payload: encodeMsg({ t: 'bye' }), qos: 0, retain: false },
        });
        const done = (v: boolean, err?: string): void => {
          if (settled) return;
          settled = true;
          if (v) {
            this.client = client;
            client.on('message', (_t: unknown, payloadArg: unknown) => {
              const msg = decodeMsg(String(payloadArg));
              if (!msg) return;
              if (msg.t === 'ping') {
                this.send({ t: 'pong', ts: msg.ts });
                return;
              }
              if (msg.t === 'pong') {
                this.cb.onPing(Math.max(0, performance.now() - msg.ts));
                return;
              }
              if (msg.t === 'bye') {
                this.cb.onPeerClosed();
                return;
              }
              this.cb.onMessage(msg);
            });
            // a socket drop mid-race: surface it (LWT 'bye' also fires server-side)
            client.on('close', () => {
              if (!this.closed) this.cb.onPeerClosed();
            });
            client.on('error', () => { /* handled via close/fallback */ });
            client.subscribe(this.peerTopic);
            resolve(true);
          } else {
            try {
              client.end(true);
            } catch {
              /* already gone */
            }
            if (err) lastErr = err;
            resolve(false);
          }
        };
        client.on('connect', () => done(true));
        client.on('error', (e: unknown) => done(false, (e as Error)?.message ?? 'broker error'));
        setTimeout(() => done(false, 'connection timeout'), 10000);
      });
      if (ok) {
        this.cb.onReady();
        if (!this.isHost) this.cb.onPeerConnected(); // guest may speak now
        this.pingTimer = setInterval(() => {
          this.send({ t: 'ping', ts: performance.now() });
        }, 1000);
        return;
      }
    }
    this.cb.onFail(`relay unreachable (${lastErr}) — check your connection and try again`);
  }

  send(msg: VsMsg): void {
    if (this.client && !this.closed) {
      try {
        this.client.publish(this.myTopic, encodeMsg(msg));
      } catch {
        /* broker dropped — the silence guard decides the race */
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    try {
      this.client?.end();
    } catch {
      /* already gone */
    }
  }
}
