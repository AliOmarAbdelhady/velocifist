// ADR-021 (CPU-class AR): the delegate pick and the adaptive resolution
// ladder are pure decisions — pin them.
import { describe, expect, it } from 'vitest';
import {
  RES_LADDERS,
  nextResolution,
  pickDelegate,
  startResolution,
} from '../src/input/trackerTuning';

describe('pickDelegate (measured, not assumed)', () => {
  it('GPU unusable → CPU', () => {
    expect(pickDelegate(null, 25)).toBe('CPU');
  });
  it('CPU unusable → GPU', () => {
    expect(pickDelegate(20, null)).toBe('GPU');
  });
  it('GPU clearly faster → GPU', () => {
    expect(pickDelegate(10, 30)).toBe('GPU');
  });
  it('near tie → CPU (the lower-risk path)', () => {
    // GPU must beat CPU by the 0.85 margin; equal-ish times go to CPU
    expect(pickDelegate(28, 30)).toBe('CPU');
    expect(pickDelegate(30, 30)).toBe('CPU');
  });
  it('weak GPU slower than CPU → CPU (the field report)', () => {
    expect(pickDelegate(70, 25)).toBe('CPU');
  });
});

describe('resolution ladder', () => {
  const cpu = RES_LADDERS.CPU;
  it('starts at the mid rung (current shipped defaults)', () => {
    expect(startResolution('CPU')).toEqual([320, 240]);
    expect(startResolution('GPU')).toEqual([480, 360]);
  });
  it('sustained slow → step down', () => {
    expect(nextResolution(60, [320, 240], cpu)).toEqual([256, 192]);
  });
  it('already at the bottom stays', () => {
    expect(nextResolution(60, [256, 192], cpu)).toBeNull();
  });
  it('comfortably fast → step up (accuracy is free)', () => {
    expect(nextResolution(15, [320, 240], cpu)).toEqual([384, 288]);
  });
  it('already at the top stays', () => {
    expect(nextResolution(15, [384, 288], cpu)).toBeNull();
  });
  it('the hysteresis band (20–48 ms) stays put', () => {
    expect(nextResolution(30, [320, 240], cpu)).toBeNull();
    expect(nextResolution(21, [320, 240], cpu)).toBeNull();
    expect(nextResolution(47, [320, 240], cpu)).toBeNull();
  });
  it('unknown current size maps to the nearest rung', () => {
    expect(nextResolution(60, [300, 225], cpu)).toEqual([256, 192]);
    // 350-wide is not a rung: nearest ≥350 is [480,360] → fast → top rung
    expect(nextResolution(15, [350, 262], RES_LADDERS.GPU)).toEqual([560, 420]);
  });
});
