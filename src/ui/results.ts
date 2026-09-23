// Results overlay (PLAN §15, M5): score + NEW BEST ceremony + auditable
// breakdown from the scoring counters. Retry (R/Enter) restarts instantly.

import type { ScoringSystem } from '../sim/scoring';
import type { Car } from '../sim/car';
import type { ScoreEntry, PersistenceService } from '../persist/local';
import { TelemetryRecorder, type RunTelemetry } from '../core/telemetry';

export class ResultsScreen {
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly newBest: HTMLElement;
  private readonly score: HTMLElement;
  private readonly table: HTMLElement;
  private readonly exportBtn: HTMLElement;
  private telemetry: RunTelemetry | null = null;

  constructor() {
    this.root = document.getElementById('results')!;
    this.title = document.getElementById('resultsTitle')!;
    this.newBest = document.getElementById('newBest')!;
    this.score = document.getElementById('resultsScore')!;
    this.table = document.getElementById('resultsTable')!;
    this.exportBtn = document.getElementById('btnExportRun')!;
    this.exportBtn.addEventListener('click', this.onExport);
  }

  private onExport = (): void => {
    if (!this.telemetry) return;
    const ok = TelemetryRecorder.download(this.telemetry);
    this.exportBtn.textContent = ok ? 'saved ✓' : 'export failed';
    setTimeout(() => (this.exportBtn.textContent = 'export run data'), 2000);
  };

  show(
    scoring: ScoringSystem,
    car: Car,
    envName: string,
    durationSec: number,
    persist: PersistenceService,
    telemetry: RunTelemetry | null = null,
    versus: { title: string; line: string } | null = null,
  ): ScoreEntry {
    this.telemetry = telemetry;
    this.exportBtn.classList.toggle('hidden', telemetry === null);
    const c = scoring.counts;
    const totalNear = c.inches + c.veryClose + c.near;
    const entry: ScoreEntry = {
      score: Math.round(scoring.score),
      car: car.tune.id,
      env: envName,
      durationSec,
      topCombo: scoring.topCombo,
      nearMisses: totalNear,
      crashes: c.crashes,
      topSpeed: scoring.topSpeed,
      date: new Date().toISOString(),
    };
    const isBest = persist.isNewBest(entry.score);
    persist.recordRun(entry, scoring.score);

    this.title.textContent = versus ? versus.title : c.crashes > 0 ? 'WRECKED' : 'RUN COMPLETE';
    this.newBest.classList.toggle('hidden', !isBest);
    this.score.textContent = entry.score.toLocaleString();
    const rows: Array<[string, string]> = [
      ...(versus ? ([['versus', versus.line]] as Array<[string, string]>) : []),
      ['near misses (inches / close / near)', `${totalNear} (${c.inches} / ${c.veryClose} / ${c.near})`],
      ['oncoming near misses', String(c.oncomingNearMiss)],
      ['clean passes (fast)', `${c.cleanPass} (${c.cleanPassFast})`],
      ['clean streaks', String(c.streaks)],
      ['top combo', `×${entry.topCombo}`],
      ['crashes', String(c.crashes)],
      ['top speed', `${Math.round(entry.topSpeed * 3.6)} km/h`],
      ['passive / bonus split', `${Math.round(scoring.passiveScored)} / ${Math.round(scoring.bonusScored)}`],
      ['duration', `${Math.floor(durationSec / 60)}:${String(Math.floor(durationSec % 60)).padStart(2, '0')}`],
      ['best', entry.score <= persist.bestScore ? persist.bestScore.toLocaleString() : '—'],
    ];
    this.table.innerHTML = '';
    for (const [k, v] of rows) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = k;
      const td2 = document.createElement('td');
      td2.className = 'v';
      td2.textContent = v;
      tr.append(td1, td2);
      this.table.append(tr);
    }
    this.root.classList.remove('hidden');
    return entry;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
