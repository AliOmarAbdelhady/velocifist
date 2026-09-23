// MatchLink (ADR-018): the PeerJS wrapper. peerjs is lazily imported — solo
// play never downloads it (vite splits the dynamic import into its own
// chunk). Signaling goes through the PeerJS cloud broker by default; all
// game traffic is then a direct WebRTC DataChannel. The wrapper owns ping
// RTT (1 Hz) and translates conn events into the callbacks the versus UI
// consumes. One link per match; close() is idempotent.

import { encodeMsg, decodeMsg, type VsMsg } from './protocol';
import { peerIdFor } from './matchCode';

export interface BrokerConfig {
  host: string;
  port: number;
  key: string;
  path: string;
  secure: boolean;
}

export interface MatchLinkCallbacks {
  /** the broker accepted our registration (host: the code is now claimable) */
  onReady(): void;
  /** the DataChannel to the opponent is open */
  onPeerConnected(): void;
  onMessage(msg: VsMsg): void;
  onPing(ms: number): void;
  /** the opponent's channel closed (left / dropped) */
  onPeerClosed(): void;
  /** unrecoverable setup or connection error (id taken, broker down…) */
  onFail(reason: string): void;
}

interface PeerLike {
  on(event: string, cb: (arg?: unknown) => void): void;
  connect(id: string, opts: { reliable: boolean }): ConnLike;
  destroy(): void;
}
interface ConnLike {
  on(event: string, cb: (arg?: unknown) => void): void;
  send(data: unknown): void;
  close(): void;
  open: boolean;
}

export class MatchLink {
  private peer: PeerLike | null = null;
  private conn: ConnLike | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private dialTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  private constructor(
    private readonly cb: MatchLinkCallbacks,
    private readonly makePeer: () => Promise<PeerLike>,
    private readonly connectTo: string | null,
  ) {}

  static async createHost(code: string, cb: MatchLinkCallbacks, broker?: BrokerConfig): Promise<MatchLink> {
    const link: MatchLink = new MatchLink(cb, () => link.initPeer(peerIdFor(code), broker), null);
    await link.start();
    return link;
  }

  static async createGuest(code: string, cb: MatchLinkCallbacks, broker?: BrokerConfig): Promise<MatchLink> {
    const link: MatchLink = new MatchLink(cb, () => link.initPeer(undefined, broker), peerIdFor(code));
    await link.start();
    return link;
  }

  // -- setup ---------------------------------------------------------------

  private async start(): Promise<void> {
    this.peer = await this.makePeer();
  }

  private async initPeer(id: string | undefined, broker?: BrokerConfig): Promise<PeerLike> {
    const mod = (await import('peerjs')) as unknown as {
      default: new (a?: unknown, b?: unknown) => PeerLike;
    };
    const Peer = mod.default;
    // ICE: STUN alone dies on carrier-grade/symmetric NAT (phone on cellular
    // vs laptop on WiFi never punch through) — the free OpenRelay TURN is the
    // relay of last resort so versus works across networks (ADR-018 fix).
    const opts = {
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478' },
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        ],
        iceCandidatePoolSize: 4,
      },
      ...(broker ?? {}),
    };
    const peer = id !== undefined ? new Peer(id, opts) : new Peer(opts);
    peer.on('open', () => {
      this.cb.onReady();
      if (this.connectTo !== null) {
        // guest: dial the host's claimed id; if the DataChannel can't form
        // (hard NATs, silent ICE death) FAIL LOUDLY after 20 s instead of
        // hanging at "dialing the host…" forever
        const conn = peer.connect(this.connectTo, { reliable: true });
        this.wireConn(conn);
        this.dialTimer = setTimeout(() => {
          if (!this.closed && !(this.conn && this.conn.open)) {
            this.failOut('could not connect to the opponent — press JOIN again (a fresh code helps; same WiFi works best)');
          }
        }, 20000);
      }
    });
    peer.on('connection', (connArg: unknown) => {
      // host: the guest dialed us
      this.wireConn(connArg as ConnLike);
    });
    peer.on('error', (errArg: unknown) => {
      const err = errArg as { type?: string; message?: string };
      const type = err?.type ?? 'unknown';
      console.warn('[versus] peer error:', type, err?.message ?? '');
      if (type === 'peer-unavailable') {
        this.failOut('no match with that code right now — ask for a fresh code');
        return;
      }
      if (type === 'unavailable-id') {
        this.failOut('that code is taken — create a new match');
        return;
      }
      if (type === 'browser-incompatible') {
        this.failOut('this browser cannot do WebRTC');
        return;
      }
      if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
        this.failOut('matchmaking server unreachable — try again');
        return;
      }
      if (!this.conn?.open && !this.closed) this.failOut('connection error: ' + type);
    });
    return peer;
  }

  /** terminal, user-visible failure: kill the link and say why */
  private failOut(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.stopPing();
    if (this.dialTimer !== null) {
      clearTimeout(this.dialTimer);
      this.dialTimer = null;
    }
    try {
      this.peer?.destroy();
    } catch {
      /* already gone */
    }
    this.cb.onFail(reason);
  }

  private wireConn(conn: ConnLike): void {
    if (this.conn) return; // one opponent per match
    this.conn = conn;
    conn.on('open', () => {
      if (this.dialTimer !== null) {
        clearTimeout(this.dialTimer);
        this.dialTimer = null;
      }
      this.cb.onPeerConnected();
      this.pingTimer = setInterval(() => {
        this.send({ t: 'ping', ts: performance.now() });
      }, 1000);
    });
    conn.on('data', (data: unknown) => {
      const raw = typeof data === 'string' ? data : JSON.stringify(data);
      const msg = decodeMsg(raw);
      if (!msg) return;
      if (msg.t === 'ping') {
        this.send({ t: 'pong', ts: msg.ts });
        return;
      }
      if (msg.t === 'pong') {
        this.cb.onPing(Math.max(0, performance.now() - msg.ts));
        return;
      }
      this.cb.onMessage(msg);
    });
    conn.on('close', () => {
      this.stopPing();
      this.cb.onPeerClosed();
    });
    conn.on('error', () => {
      this.stopPing();
      this.cb.onPeerClosed();
    });
  }

  // -- runtime -------------------------------------------------------------

  send(msg: VsMsg): void {
    if (this.conn?.open) this.conn.send(encodeMsg(msg));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopPing();
    if (this.dialTimer !== null) {
      clearTimeout(this.dialTimer);
      this.dialTimer = null;
    }
    try {
      this.send({ t: 'bye' });
    } catch {
      /* channel already gone */
    }
    this.conn?.close();
    this.peer?.destroy();
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
