// PersistenceService (PLAN §11.3, M5): versioned, atomic localStorage writes
// (serialize → temp key → verify → swap + backup copy). The storage backend
// is injectable so the sim-side logic is unit-testable in node (no DOM).
//
// Keys (all under the `vfc.` prefix):
//   settings  { input tunables, quality, volumes, car, envPin, oneHanded }
//   progress  { lifetimeScore, unlocks, bestSpeed, totalRuns }
//   scores    [ top-20 runs ]
//   calib     { oneEuro params, anchors }   (M2)

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'vfc.';
const SCHEMA_VERSION = 2;

export interface GameSettings {
  schema: number;
  car: string;
  envPin: string | null;
  volume: number;
  /** 'auto' = presets with the frame-time auto-scaler (ADR-008 easy-first,
   *  M6 quality system); manual levels pin the preset */
  quality: 'auto' | 'low' | 'medium' | 'high';
}

export interface Progress {
  schema: number;
  lifetimeScore: number;
  unlocks: string[];
  bestSpeed: number; // m/s
  totalRuns: number;
}

export interface ScoreEntry {
  score: number;
  car: string;
  env: string;
  durationSec: number;
  topCombo: number;
  nearMisses: number;
  crashes: number;
  topSpeed: number; // m/s
  date: string; // ISO
}

export const DEFAULT_SETTINGS: GameSettings = {
  schema: SCHEMA_VERSION,
  car: 'falcone-gt',
  envPin: null,
  volume: 0.8,
  quality: 'auto',
};

export const DEFAULT_PROGRESS: Progress = {
  schema: SCHEMA_VERSION,
  lifetimeScore: 0,
  unlocks: ['falcone-gt'],
  bestSpeed: 0,
  totalRuns: 0,
};

const MAX_SCORES = 20;

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

export class PersistenceService {
  private readonly store: StorageLike;

  constructor(store?: StorageLike) {
    if (store) {
      this.store = store;
    } else {
      // browser (or node tests that don't care): fall back gracefully
      this.store =
        typeof localStorage !== 'undefined' ? localStorage : new MemoryStorage();
    }
  }

  // ------------------------------------------------------------- primitives

  private read<T>(key: string, fallback: T): T {
    try {
      const raw = this.store.getItem(PREFIX + key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as T;
      return parsed === null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  /**
   * Atomic write: temp key → verify → swap, plus a backup copy of the old
   * value. A crash mid-write can never corrupt the previous good state.
   */
  private write(key: string, value: unknown): boolean {
    const full = PREFIX + key;
    const tmp = `${full}__tmp`;
    const text = JSON.stringify(value);
    if (text === undefined) return false;
    try {
      const old = this.store.getItem(full);
      this.store.setItem(tmp, text);
      if (this.store.getItem(tmp) !== text) {
        this.store.removeItem(tmp);
        return false; // verify failed — do not swap
      }
      this.store.setItem(full, text);
      this.store.removeItem(tmp);
      if (old !== null && old !== text) this.store.setItem(`${full}__bak`, old);
      return true;
    } catch {
      try {
        this.store.removeItem(tmp);
      } catch {
        // give up quietly — persistence is never fatal
      }
      return false;
    }
  }

  // --------------------------------------------------------------- settings

  get settings(): GameSettings {
    return { ...DEFAULT_SETTINGS, ...this.read('settings', DEFAULT_SETTINGS) };
  }

  setSettings(s: Partial<GameSettings>): void {
    this.write('settings', { ...this.settings, ...s, schema: SCHEMA_VERSION });
  }

  // --------------------------------------------------------------- progress

  get progress(): Progress {
    return { ...DEFAULT_PROGRESS, ...this.read('progress', DEFAULT_PROGRESS) };
  }

  /** Record a finished run; returns the updated progress. */
  recordRun(entry: ScoreEntry, score: number): Progress {
    const p = this.progress;
    p.lifetimeScore += Math.round(score);
    p.totalRuns += 1;
    if (entry.topSpeed > p.bestSpeed) p.bestSpeed = entry.topSpeed;
    // unlocks (PLAN §12): Vipera 150k lifetime, Bruto 500k
    if (p.lifetimeScore >= 150000 && !p.unlocks.includes('vipera-rs')) p.unlocks.push('vipera-rs');
    if (p.lifetimeScore >= 500000 && !p.unlocks.includes('bruto-widebody')) p.unlocks.push('bruto-widebody');
    this.write('progress', p);

    const scores = this.topScores();
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    this.write('scores', scores.slice(0, MAX_SCORES));
    return p;
  }

  topScores(): ScoreEntry[] {
    return this.read<ScoreEntry[]>('scores', []);
  }

  isNewBest(score: number): boolean {
    const top = this.topScores();
    return top.length === 0 || score > top[0].score;
  }

  /** The best score so far (0 when none). */
  get bestScore(): number {
    const top = this.topScores();
    return top.length > 0 ? top[0].score : 0;
  }

  /** Export/import (PLAN §11.3). */
  exportAll(): string {
    return JSON.stringify({
      settings: this.settings,
      progress: this.progress,
      scores: this.topScores(),
    });
  }

  importAll(json: string): boolean {
    try {
      const data = JSON.parse(json) as {
        settings?: Partial<GameSettings>;
        progress?: Partial<Progress>;
        scores?: ScoreEntry[];
      };
      if (data.settings) this.write('settings', { ...DEFAULT_SETTINGS, ...data.settings });
      if (data.progress) this.write('progress', { ...DEFAULT_PROGRESS, ...data.progress });
      if (Array.isArray(data.scores)) {
        const clean = data.scores
          .filter((s) => typeof s.score === 'number' && Number.isFinite(s.score))
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_SCORES);
        this.write('scores', clean);
      }
      return true;
    } catch {
      return false;
    }
  }

  wipe(): void {
    for (const key of ['settings', 'progress', 'scores']) {
      this.store.removeItem(PREFIX + key);
      this.store.removeItem(`${PREFIX + key}__bak`);
      this.store.removeItem(`${PREFIX + key}__tmp`);
    }
  }
}

/** Minimal key helpers kept from the M2 wrapper (calibration data). */
export function loadJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full / disabled — non-fatal
  }
}
