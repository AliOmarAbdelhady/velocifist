// Collision gates (PLAN §6.4, M3): SAT correctness, swept anti-tunneling at
// 365 km/h closing, and response sanity (head-on / rear-end / side hit).

import { describe, expect, it } from 'vitest';
import {
  obbSAT,
  sweptPlayerSAT,
  resolveHit,
  type Contact,
  type OBB,
  type PlayerBody,
  type AgentBody,
} from '../src/sim/collision';

const out: Contact = { nx: 0, nz: 0, depth: 0 };
const box = (x: number, z: number, hw: number, hl: number, h = 0): OBB => ({ x, z, hw, hl, h });

describe('obbSAT', () => {
  it('detects plain AABB overlap with positive depth', () => {
    expect(obbSAT(box(0, 0, 1, 2), box(1.5, 0, 1, 2), out)).toBe(true);
    expect(out.depth).toBeCloseTo(0.5, 5);
  });

  it('rejects separated boxes', () => {
    expect(obbSAT(box(0, 0, 1, 2), box(5, 0, 1, 2), out)).toBe(false);
    expect(obbSAT(box(0, 0, 1, 2), box(0, -6, 1, 2), out)).toBe(false);
  });

  it('rejects a 0.05 m near-miss', () => {
    expect(obbSAT(box(0, 0, 1, 2), box(2.05, 0, 1, 2), out)).toBe(false);
  });

  it('handles rotated boxes (45° corner contact)', () => {
    // long thin box rotated 45° overlapping an axis-aligned box corner region
    expect(obbSAT(box(0, 0, 0.5, 3, Math.PI / 4), box(1.8, 0, 1, 2), out)).toBe(true);
    expect(obbSAT(box(0, 0, 0.5, 3, Math.PI / 4), box(4.2, 0, 1, 2), out)).toBe(false); // 45° reach = 0.354+2.12 = 2.47 m; 4.2−1 > 2.47
  });

  it('identical boxes overlap', () => {
    expect(obbSAT(box(0, 0, 1, 2), box(0, 0, 1, 2), out)).toBe(true);
  });
});

describe('swept anti-tunneling', () => {
  const agent = box(0, -100, 1, 2.3); // ~100 m ahead
  it('never misses a 365 km/h closing pass through an agent', () => {
    const step = 101 / 60; // 101 m/s at 60 Hz ≈ 1.7 m per tick
    for (let start = -1.6; start <= 1.6; start += 0.2) {
      // place the player so the agent sits anywhere within one tick of travel
      const z0 = -100 + 3.35 + start; // just clear ahead
      const hit = sweptPlayerSAT(0, z0, 0, z0 - step, 1, 2.3, 0, agent, out);
      expect(hit).toBe(true);
    }
  });

  it('does not hit when passing beside (lateral clearance)', () => {
    expect(sweptPlayerSAT(3.2, 0, 3.2, -1.7, 1, 2.3, 0, box(0, -0.85, 1, 2.3), out)).toBe(false);
  });
});

describe('resolveHit', () => {
  const mkPlayer = (): PlayerBody => ({
    x: 0, z: 0, heading: 0, u: 30, w: 0, omega: 0, halfW: 1, halfL: 2.3, iz: 3200,
  });
  const mkAgent = (): AgentBody => ({
    x: 0, z: -4, heading: 0, speed: 20, kvx: 0, kvz: 0, kspin: 0,
  });

  it('head-on: player slows, agent knocked, closing returned', () => {
    const p = mkPlayer();
    const a = mkAgent();
    a.z = -4;
    const closing = resolveHit(p, a, 1.0, 0, 1); // normal agent→player = +z
    expect(closing).toBeGreaterThan(5);
    expect(p.u).toBeLessThan(30);
    expect(a.kvz).not.toBe(0);
    expect(Number.isFinite(p.u + p.w + p.omega + a.kvz)).toBe(true);
  });

  it('side hit: adds lateral velocity and yaw, keeps forward speed', () => {
    const p = mkPlayer();
    p.w = 3; // sliding right, toward the agent
    const a = mkAgent();
    a.x = 2.5;
    a.z = -2; // front-right corner — a pure lateral swipe through the arm has no yaw
    const closing = resolveHit(p, a, 1.0, -1, 0); // agent at +x ⇒ agent→player normal = −x
    expect(closing).toBeGreaterThan(0);
    expect(Math.abs(p.w)).toBeGreaterThan(0.05);
    expect(Math.abs(p.omega)).toBeGreaterThan(0.01);
    expect(p.u).toBeGreaterThan(20);
  });

  it('separating contact produces no impulse', () => {
    const p = mkPlayer();
    const a = mkAgent();
    p.u = 10; // slower than agent's 20 → separating along +z normal
    const closing = resolveHit(p, a, 1.0, 0, 1);
    expect(closing).toBe(0);
    expect(p.u).toBe(10);
  });

  it('heavy traffic (massRatio 3) hurts more than light (0.7)', () => {
    const p1 = mkPlayer();
    const a1 = mkAgent();
    resolveHit(p1, a1, 3.0, 0, 1);
    const p2 = mkPlayer();
    const a2 = mkAgent();
    resolveHit(p2, a2, 0.7, 0, 1);
    expect(30 - p1.u).toBeGreaterThan(30 - p2.u);
  });
});
