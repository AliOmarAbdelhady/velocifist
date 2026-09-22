import { describe, expect, it } from 'vitest';
import { HandIdentityTracker } from '../src/input/handTracks';
import { makeOpen } from './helpers/handFixture';

describe('HandIdentityTracker — crossing safety (PILL 006)', () => {
  it('does not lock on until two hands with distinct labels appear', () => {
    const tr = new HandIdentityTracker();
    let p = tr.update([makeOpen([0.5, 0.6], 1)], 0.1);
    expect(p.right).toBeNull();
    p = tr.update([makeOpen([0.4, 0.6], 0), makeOpen([0.6, 0.6], 0)], 0.13); // same label
    expect(p.left).toBeNull();
    p = tr.update([makeOpen([0.4, 0.6], 0), makeOpen([0.6, 0.6], 1)], 0.17);
    expect(p.left).not.toBeNull();
    expect(p.right).not.toBeNull();
  });

  it('preserves identity when hands CROSS even if handedness labels flip', () => {
    const tr = new HandIdentityTracker();
    const dt = 1 / 30;
    const frames = 90;
    // handA starts LEFT at 0.35 and drifts right; handB starts RIGHT at 0.65 and drifts left.
    // At the midpoint (frame ~45) MediaPipe flips its labels — tracker must not care.
    for (let i = 0; i <= frames; i++) {
      const t = i * dt;
      const ax = 0.35 + (0.3 * i) / frames; // original-left hand → right side
      const bx = 0.65 - (0.3 * i) / frames; // original-right hand → left side
      const labelsSwapped = i > frames / 2;
      const handA = makeOpen([ax, 0.6], labelsSwapped ? 1 : 0); // label flips mid-run
      const handB = makeOpen([bx, 0.6], labelsSwapped ? 0 : 1);
      const p = tr.update(i === 0 ? [] : [handA, handB].sort((a, b) => a.data[0] - b.data[0]), t);
      if (i === 0) {
        tr.update([makeOpen([0.35, 0.6], 0), makeOpen([0.65, 0.6], 1)], t);
        continue;
      }
      if (i >= 2) {
        expect(p.left).not.toBeNull();
        expect(p.right).not.toBeNull();
        // identity: "left" is the hand that STARTED at 0.35 (handA)
        expect(Math.abs(p.left!.data[0] - ax)).toBeLessThan(0.02);
        expect(Math.abs(p.right!.data[0] - bx)).toBeLessThan(0.02);
      }
    }
  });

  it('keeps tracking when one hand leaves the frame', () => {
    const tr = new HandIdentityTracker();
    tr.update([makeOpen([0.4, 0.6], 0), makeOpen([0.6, 0.6], 1)], 0.1);
    // brief holdover (anti-flicker) keeps the lost hand for <150 ms…
    const p0 = tr.update([makeOpen([0.6, 0.6], 1)], 0.15);
    expect(p0.right).not.toBeNull();
    // …then it expires
    const p1 = tr.update([makeOpen([0.6, 0.6], 1)], 0.32);
    expect(p1.left).toBeNull();
    expect(p1.right).not.toBeNull();
    const p2 = tr.update([makeOpen([0.6, 0.62], 1)], 0.36);
    expect(p2.right!.data[0]).toBeCloseTo(0.6, 3);
  });

  it('flags low confidence on a teleport', () => {
    const tr = new HandIdentityTracker();
    tr.update([makeOpen([0.4, 0.6], 0), makeOpen([0.6, 0.6], 1)], 0.1);
    const steady = tr.update([makeOpen([0.41, 0.6], 0), makeOpen([0.61, 0.6], 1)], 0.15);
    const teleported = tr.update([makeOpen([0.05, 0.2], 0), makeOpen([0.61, 0.6], 1)], 0.2);
    expect(teleported.confidence).toBeLessThan(steady.confidence);
    expect(teleported.confidence).toBeLessThan(0.5);
  });
});
