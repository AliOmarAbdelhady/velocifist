// ADR-018 unit gates: match codes, wire protocol, and the VersusRace state
// machine (countdown → racing → every verdict path). The network layer is
// mocked away — every verdict must be computed identically offline.

import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LEN, genCode, normalizeCode, peerIdFor } from '../src/net/matchCode';
import { decodeMsg, encodeMsg, type VsMsg } from '../src/net/protocol';
import { VersusRace } from '../src/net/versus';

describe('match codes', () => {
  it('generates 5 chars from the unambiguous alphabet', () => {
    // deterministic rng pins the sequence
    const seq = [0, 0.5, 0.999, 0.0, 0.123];
    let i = 0;
    const code = genCode(() => seq[i++]);
    expect(code).toHaveLength(CODE_LEN);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    expect(code.startsWith('2')).toBe(true); // rand 0 → index 0
    expect(code[2]).toBe(CODE_ALPHABET[CODE_ALPHABET.length - 1]); // 0.999 → last
  });

  it('never emits ambiguous characters (0/O/1/I/L)', () => {
    for (let seed = 0; seed < 500; seed++) {
      // xorshift-ish deterministic stream
      let s = seed || 1;
      const code = genCode(() => {
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        return ((s >>> 0) % 100000) / 100000;
      });
      expect(code).not.toMatch(/[01ILO]/);
    }
  });

  it('normalizes sloppy input and rejects garbage', () => {
    expect(normalizeCode(' ab3-kq ')).toBe('AB3KQ');
    expect(normalizeCode('ab3kq')).toBe('AB3KQ');
    expect(normalizeCode('AB3K')).toBeNull(); // too short
    expect(normalizeCode('AB3KQQ')).toBeNull(); // too long
    expect(normalizeCode('AB0KQ')).toBeNull(); // ambiguous 0 not in alphabet
    expect(normalizeCode('A*3KQ')).toBeNull();
  });

  it('derives a peer id both sides agree on', () => {
    expect(peerIdFor('AB3KQ')).toBe('roben-race-AB3KQ');
  });
});

describe('wire protocol', () => {
  const cases: VsMsg[] = [
    { t: 'hello', name: 'Ali', carId: 'falcone-gt' },
    { t: 'start', seed: 123456789, target: 5000, goIn: 3.2 },
    { t: 'pose', p: [1.5, -240.25, 0.01, 54.4, 2600] },
    { t: 'ping', ts: 99_000 },
    { t: 'pong', ts: 99_000 },
    { t: 'finish', d: 5000, rt: 91.4 },
    { t: 'wrecked' },
    { t: 'rematch' },
    { t: 'bye' },
  ];

  it('round-trips every message kind', () => {
    for (const msg of cases) {
      expect(decodeMsg(encodeMsg(msg))).toEqual(msg);
    }
  });

  it('rejects non-protocol payloads without throwing', () => {
    expect(decodeMsg('not json')).toBeNull();
    expect(decodeMsg('{"t":"nope"}')).toBeNull();
    expect(decodeMsg('{"t":"pose","p":[1,2,"x",4,5]}')).toBeNull();
    expect(decodeMsg('{"t":"pose","p":[1,2,3]}')).toBeNull(); // wrong arity
    expect(decodeMsg('{"t":"start","seed":"x","target":1,"goIn":1}')).toBeNull();
    expect(decodeMsg('null')).toBeNull();
  });

  it('clamps hostile hello fields', () => {
    const out = decodeMsg('{"t":"hello","name":"' + 'A'.repeat(200) + '","carId":"x"}');
    expect(out && out.t === 'hello' && out.name.length).toBe(24);
  });
});

describe('VersusRace state machine', () => {
  const TARGET = 5000;

  it('counts down, then races; first to the target wins', () => {
    const r = new VersusRace(TARGET, 3.2);
    expect(r.phase).toBe('countdown');
    r.tick(3.0, 0, 0, 0);
    expect(r.phase).toBe('countdown');
    r.tick(0.3, 0, 0, 0); // 3.3 s elapsed > 3.2 → GO
    expect(r.phase).toBe('racing');
    expect(r.countdown).toBe(0);
    r.tick(0.016, 2500, 2000, 0.1);
    expect(r.time).toBeCloseTo(0.016, 6);
    expect(r.gap).toBe(500);
    expect(r.position).toBe(1);
    r.tick(0.016, TARGET, 4000, 0.1);
    expect(r.phase).toBe('finished');
    expect(r.outcome).toBe('win-distance');
    expect(r.won).toBe(true);
  });

  it('remote finishing first is a distance loss even if you keep driving', () => {
    const r = new VersusRace(TARGET, 0);
    r.tick(1, 1000, 900, 0.1);
    r.remoteFinish();
    expect(r.outcome).toBe('loss-distance');
    // finished is final — a later local cross must not flip it
    r.tick(1, TARGET, 4000, 0.1);
    expect(r.outcome).toBe('loss-distance');
  });

  it('wrecking loses instantly, even during the countdown', () => {
    const r = new VersusRace(TARGET, 3.2);
    r.localWreck();
    expect(r.outcome).toBe('loss-wreck');
    expect(r.won).toBe(false);
  });

  it('opponent wreck or disconnect hands the win', () => {
    const a = new VersusRace(TARGET, 0);
    a.tick(1, 100, 100, 0.1);
    a.remoteWrecked();
    expect(a.outcome).toBe('win-wreck');

    const b = new VersusRace(TARGET, 0);
    b.tick(1, 100, 100, 0.1);
    b.remoteLeft();
    expect(b.outcome).toBe('win-disconnect');

    // silent link for > 6 s mid-race counts as a disconnect
    const c = new VersusRace(TARGET, 0);
    c.tick(1, 100, 100, 0.1);
    c.tick(1, 200, 100, 7.0);
    expect(c.outcome).toBe('win-disconnect');
  });

  it('gap sign drives the position', () => {
    const r = new VersusRace(TARGET, 0);
    r.tick(0.016, 1000, 1200, 0.1);
    expect(r.gap).toBe(-200);
    expect(r.position).toBe(2);
  });
});
