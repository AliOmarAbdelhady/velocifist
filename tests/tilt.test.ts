// Tilt steering gates (M15): the wheel-plane formula, calibration, and
// clamping — the phone page embeds the same math verbatim.

import { describe, expect, it } from 'vitest';
import { orientationToWheel, wheelToSteer } from '../src/input/tilt';

describe('orientationToWheel', () => {
  it('holding the phone flat toward you is a defined baseline (no NaN)', () => {
    expect(Number.isFinite(orientationToWheel(0, 0))).toBe(true);
  });

  it('turning the wheel left/right moves the angle monotonically', () => {
    // a wheel held ~vertical: beta ~90 base; rotating the wheel trades
    // beta and gamma — sample a rotation arc and demand monotonic change
    const angles: number[] = [];
    for (let i = -5; i <= 5; i++) {
      const rot = i * 15; // deg of wheel rotation
      const beta = 90 * Math.cos(rot * (Math.PI / 180));
      const gamma = 90 * Math.sin(rot * (Math.PI / 180));
      angles.push(orientationToWheel(beta, gamma));
    }
    for (let i = 1; i < angles.length; i++) {
      // direction of increase is a CONVENTION (page may flip the sign for
      // feel); the contract is strict monotonicity along the arc
      expect(angles[i]).toBeLessThan(angles[i - 1]);
    }
  });
});

describe('wheelToSteer', () => {
  it('calibration zero: the held angle steers nothing', () => {
    const calib = orientationToWheel(63, 12);
    expect(wheelToSteer(orientationToWheel(63, 12), calib)).toBeCloseTo(0, 6);
  });

  it('full lock at ±fullLockDeg, clamped beyond', () => {
    expect(wheelToSteer(95, 0)).toBeCloseTo(1, 6);
    expect(wheelToSteer(-95, 0)).toBeCloseTo(-1, 6);
    expect(wheelToSteer(170, 0)).toBe(1);
    expect(wheelToSteer(-170, 0)).toBe(-1);
  });

  it('sensitivity: half-lock steers half', () => {
    expect(wheelToSteer(47.5, 0)).toBeCloseTo(0.5, 6);
  });
});

describe('normalizeRelayUrl (production phone remote)', () => {
  it('bare host picks the scheme from the page protocol', () => {
    expect(normalizeRelayUrl('192.168.1.3:8080', 'http:')).toBe('ws://192.168.1.3:8080');
    expect(normalizeRelayUrl('192.168.1.3:8443', 'https:')).toBe('wss://192.168.1.3:8443');
  });

  it('http(s):// input maps to ws(s)://', () => {
    expect(normalizeRelayUrl('http://192.168.1.3:8080/', 'http:')).toBe('ws://192.168.1.3:8080');
    expect(normalizeRelayUrl('https://192.168.1.3:8443', 'https:')).toBe('wss://192.168.1.3:8443');
  });

  it('an https page NEVER opens ws:// (mixed content) — forced to wss', () => {
    expect(normalizeRelayUrl('ws://192.168.1.3:8080', 'https:')).toBe('wss://192.168.1.3:8080');
    expect(normalizeRelayUrl('http://192.168.1.3:8080', 'https:')).toBe('wss://192.168.1.3:8080');
  });

  it('explicit wss and localhost http pages keep their scheme', () => {
    expect(normalizeRelayUrl('wss://example.com', 'https:')).toBe('wss://example.com');
    expect(normalizeRelayUrl('ws://127.0.0.1:8080', 'http:')).toBe('ws://127.0.0.1:8080');
  });
});

import { normalizeRelayUrl } from '../src/input/devices';
