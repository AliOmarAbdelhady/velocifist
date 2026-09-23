// Versus wire protocol (ADR-018): tiny JSON messages over the PeerJS
// DataChannel. Poses are tuple-packed ([x, z, heading, u, distance]) — the
// 15 Hz stream is the bulk of the traffic and JSON object keys would double
// it. Pure module — encode/decode roundtrip is unit-tested.

export interface HelloMsg {
  t: 'hello';
  /** display name the opponent chose (their garage name / "Player") */
  name: string;
  /** which car they drive (shown on your HUD) */
  carId: string;
}
export interface StartMsg {
  t: 'start';
  /** world seed — BOTH sims run identical worlds (ghost-race model) */
  seed: number;
  /** race distance target, metres (first to this distance wins) */
  target: number;
  /** countdown seconds from RECEIPT to GO (host-owned sync) */
  goIn: number;
}
export type Pose = [number, number, number, number, number];
export interface PoseMsg {
  t: 'pose';
  p: Pose;
}
export interface PingMsg {
  t: 'ping';
  ts: number;
}
export interface PongMsg {
  t: 'pong';
  ts: number;
}
export interface FinishMsg {
  t: 'finish';
  /** final distance, m */
  d: number;
  /** race time, s */
  rt: number;
}
export type VsMsg =
  | HelloMsg
  | StartMsg
  | PoseMsg
  | PingMsg
  | PongMsg
  | FinishMsg
  | { t: 'wrecked' }
  | { t: 'rematch' }
  | { t: 'bye' };

export function encodeMsg(msg: VsMsg): string {
  return JSON.stringify(msg);
}

/** Parse + shape-validate; null on anything that isn't our protocol. */
export function decodeMsg(raw: string): VsMsg | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const m = obj as Record<string, unknown>;
  switch (m.t) {
    case 'hello':
      return typeof m.name === 'string' && typeof m.carId === 'string'
        ? { t: 'hello', name: m.name.slice(0, 24), carId: m.carId.slice(0, 32) }
        : null;
    case 'start':
      return Number.isInteger(m.seed) && Number.isFinite(m.target) && Number.isFinite(m.goIn)
        ? { t: 'start', seed: m.seed as number, target: m.target as number, goIn: m.goIn as number }
        : null;
    case 'pose':
      if (Array.isArray(m.p) && m.p.length === 5 && m.p.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        return { t: 'pose', p: m.p as Pose };
      }
      return null;
    case 'ping':
    case 'pong':
      return typeof m.ts === 'number' ? { t: m.t, ts: m.ts } : null;
    case 'finish':
      return Number.isFinite(m.d) && Number.isFinite(m.rt)
        ? { t: 'finish', d: m.d as number, rt: m.rt as number }
        : null;
    case 'wrecked':
    case 'rematch':
    case 'bye':
      return { t: m.t };
    default:
      return null;
  }
}
