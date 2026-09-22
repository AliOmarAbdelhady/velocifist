// Persistence gates (PLAN §11.3, M5): atomic writes, top-20 scores,
// unlocks, export/import, corruption resilience.

import { describe, expect, it } from 'vitest';
import {
  PersistenceService,
  type ScoreEntry,
  type StorageLike,
} from '../src/persist/local';

class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  failWrites = false;
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.failWrites) throw new Error('quota exceeded');
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

function entry(score: number, over: Partial<ScoreEntry> = {}): ScoreEntry {
  return {
    score,
    car: 'falcone-gt',
    env: 'coastal',
    durationSec: 120,
    topCombo: 4,
    nearMisses: 30,
    crashes: 1,
    topSpeed: 70,
    date: '2026-09-22T00:00:00.000Z',
    ...over,
  };
}

describe('PersistenceService', () => {
  it('records runs, keeps top-20 sorted, tracks lifetime + best speed', () => {
    const p = new PersistenceService(new FakeStorage());
    for (let i = 1; i <= 25; i++) {
      p.recordRun(entry(i * 100), i * 100);
    }
    const top = p.topScores();
    expect(top.length).toBe(20);
    expect(top[0].score).toBe(2500);
    expect(top[19].score).toBe(600); // the 5 lowest fell off
    expect(p.progress.lifetimeScore).toBe(25 * 13 * 100); // Σ i·100
    expect(p.progress.totalRuns).toBe(25);
    expect(p.progress.bestSpeed).toBe(70);
    expect(p.isNewBest(2600)).toBe(true);
    expect(p.isNewBest(2500)).toBe(false);
  });

  it('unlocks: Vipera at 150k, Bruto at 500k lifetime', () => {
    const p = new PersistenceService(new FakeStorage());
    expect(p.progress.unlocks).toEqual(['falcone-gt']);
    p.recordRun(entry(149999), 149999);
    expect(p.progress.unlocks).not.toContain('vipera-rs');
    p.recordRun(entry(1), 1); // lifetime hits 150k
    expect(p.progress.unlocks).toContain('vipera-rs');
    expect(p.progress.unlocks).not.toContain('bruto-widebody');
    p.recordRun(entry(350000), 350000); // lifetime hits 500k
    expect(p.progress.unlocks).toContain('bruto-widebody');
  });

  it('atomic write leaves the previous good value when storage fails', () => {
    const store = new FakeStorage();
    const p = new PersistenceService(store);
    p.setSettings({ car: 'falcone-gt' });
    store.failWrites = true;
    expect(p.setSettings({ car: 'vipera-rs' })).toBeUndefined(); // non-fatal
    expect(p.settings.car).toBe('falcone-gt'); // old value intact
  });

  it('write leaves a backup copy of the superseded value', () => {
    const store = new FakeStorage();
    const p = new PersistenceService(store);
    p.recordRun(entry(100), 100);
    p.recordRun(entry(200), 200);
    const bak = store.map.get('vfc.progress__bak');
    expect(bak).not.toBeNull();
    expect(JSON.parse(bak!).lifetimeScore).toBe(100);
  });

  it('corrupted JSON falls back to defaults, never throws', () => {
    const store = new FakeStorage();
    store.map.set('vfc.progress', '{not json');
    const p = new PersistenceService(store);
    expect(p.progress.lifetimeScore).toBe(0);
    expect(p.topScores()).toEqual([]);
  });

  it('export → wipe → import round-trips', () => {
    const store = new FakeStorage();
    const p = new PersistenceService(store);
    p.recordRun(entry(1234, { car: 'vipera-rs' }), 1234);
    p.setSettings({ car: 'vipera-rs', volume: 0.3 });
    const dump = p.exportAll();
    p.wipe();
    expect(p.progress.totalRuns).toBe(0);
    expect(p.importAll(dump)).toBe(true);
    expect(p.progress.totalRuns).toBe(1);
    expect(p.progress.lifetimeScore).toBe(1234);
    expect(p.settings.car).toBe('vipera-rs');
    expect(p.settings.volume).toBeCloseTo(0.3, 6);
    expect(p.topScores()[0].score).toBe(1234);
    expect(p.importAll('{garbage')).toBe(false);
  });

  it('import sanitizes score entries', () => {
    const store = new FakeStorage();
    const p = new PersistenceService(store);
    const dirty = JSON.stringify({
      scores: [entry(5), { score: 'x' }, entry(7), entry(Infinity as unknown as number)],
    });
    p.importAll(dirty);
    const top = p.topScores();
    expect(top.length).toBe(2); // 5 and 7 survive; 'x' and Infinity dropped
    expect(top[0].score).toBe(7);
  });
});
