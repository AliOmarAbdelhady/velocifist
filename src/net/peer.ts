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
    const peer = id !== undefined ? new Peer(id, { ...(broker ?? {}) }) : new Peer({ ...(broker ?? {}) });
    peer.on('open', () => {
      this.cb.onReady();
      if (this.connectTo !== null) {
        // guest: dial the host's claimed id
        const conn = peer.connect(this.connectTo, { reliable: true });
        this.wireConn(conn);
      }
    });
    peer.on('connection', (connArg: unknown) => {
      // host: the guest dialed us
      this.wireConn(connArg as ConnLike);
    });
    peer.on('error', (errArg: unknown) => {
      const err = errArg as { type?: string; message?: string };
      const type = err?.type ?? 'unknown';
      if (type === 'peer-unavailable') {
        this.cb.onFail('no match with that code right now');
        return;
      }
      if (type === 'unavailable-id') {
        this.cb.onFail('that code is taken — create a new match');
        return;
      }
      if (type === 'browser-incompatible') {
        this.cb.onFail('this browser cannot do WebRTC');
        return;
      }
      if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
        this.cb.onFail('matchmaking server unreachable — try again');
        return;
      }
      if (!this.conn?.open && !this.closed) this.cb.onFail('connection error: ' + type);
    });
    return peer;
  }

  private wireConn(conn: ConnLike): void {
    if (this.conn) return; // one opponent per match
    this.conn = conn;
    conn.on('open', () => {
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
