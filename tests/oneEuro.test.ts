import { describe, expect, it } from 'vitest';
import { OneEuro, DEFAULT_ONE_EURO } from '../src/input/oneEuro';

function stdev(xs: number[]): number {
  const m = xs.reduce((s, v) => s + v, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length);
}

describe('One Euro filter', () => {
  it('strongly attenuates jitter on a static noisy signal', () => {
    const f = new OneEuro({ ...DEFAULT_ONE_EURO, minCutoff: 1.0 });
    let seed = 42;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647 - 0.5;
    };
    const in_: number[] = [];
    const out: number[] = [];
    for (let i = 0; i < 600; i++) {
      const x = 0.5 + rand() * 0.08; // ±2% noise
      in_.push(x);
      out.push(f.filter(x, i / 60));
    }
    // ignore the first 60 samples (settling)
    expect(stdev(out.slice(60))).toBeLessThan(stdev(in_.slice(60)) * 0.35);
  });

  it('tracks a fast ramp with low lag', () => {
    const f = new OneEuro({ ...DEFAULT_ONE_EURO, beta: 0.05 });
    let y = 0;
    for (let i = 0; i < 120; i++) {
      y = f.filter(i < 60 ? 0 : 1, i / 60); // step at t = 1 s
    }
    expect(y).toBeGreaterThan(0.9);
  });

  it('adapts: smooths slow motion more than fast motion', () => {
    const slow = new OneEuro({ ...DEFAULT_ONE_EURO });
    const fast = new OneEuro({ ...DEFAULT_ONE_EURO });
    let seed = 7;
    const rand = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647 - 0.5;
    };
    const slowOut: number[] = [];
    const fastOut: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t = i / 30;
      slowOut.push(slow.filter(0.2 * Math.sin(2 * Math.PI * 0.5 * t) + rand() * 0.05, t));
      fastOut.push(fast.filter(0.2 * Math.sin(2 * Math.PI * 4 * t) + rand() * 0.05, t));
    }
    // residual noise (deviation from the clean sine) should be lower on the slow signal
    const resid = (xs: number[], freq: number) =>
      stdev(xs.slice(50).map((v, k) => v - 0.2 * Math.sin(2 * Math.PI * freq * ((k + 50) / 30))));
    expect(resid(slowOut, 0.5)).toBeLessThan(resid(fastOut, 4));
  });

  it('reset() forgets state', () => {
    const f = new OneEuro();
    f.filter(0.9, 0);
    f.reset();
    expect(f.filter(0.1, 1)).toBe(0.1);
  });
});
