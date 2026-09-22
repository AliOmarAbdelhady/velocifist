import { describe, expect, it } from 'vitest';
import { accumulate, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from '../src/core/loop';

describe('fixed-timestep accumulator', () => {
  it('does not step when the frame is shorter than dt', () => {
    const r = accumulate(0, 0.016, 1 / 60);
    expect(r.steps).toBe(0);
    expect(r.acc).toBeGreaterThan(0);
    expect(r.acc).toBeLessThan(1 / 60);
  });

  it('steps exactly once on a carried-over 60 Hz frame', () => {
    const r = accumulate(1 / 120, 1 / 120, 1 / 60);
    expect(r.steps).toBe(1);
    expect(r.acc).toBeLessThan(1e-9);
  });

  it('catches up with multiple steps after a small hitch', () => {
    const r = accumulate(0, 0.1, 1 / 60);
    expect(r.steps).toBe(6);
    expect(r.dropped).toBe(false);
  });

  it('clamps absurd frame deltas and drops the backlog (spiral guard)', () => {
    const r = accumulate(0, 10, 1 / 60); // e.g. tab was hidden for 10 s
    expect(MAX_FRAME_DT).toBe(0.25);
    expect(r.steps).toBe(MAX_STEPS_PER_FRAME);
    expect(r.dropped).toBe(true);
    expect(r.acc).toBe(0);
  });

  it('keeps the interpolation alpha in [0, 1)', () => {
    const dt = 1 / 60;
    const r = accumulate(0, 0.0502, dt);
    const alpha = r.acc / dt;
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
  });

  it('reuses the out object (zero-allocation contract)', () => {
    const a = accumulate(0, 0.016, 1 / 60);
    const b = accumulate(0, 0.016, 1 / 60);
    expect(a).toBe(b); // same reused instance
  });
});
