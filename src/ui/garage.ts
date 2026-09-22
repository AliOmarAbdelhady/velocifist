// Garage (PLAN §12, M5 — functional pass): pick a car, see the stats, respect
// unlocks. The turntable/rev/paint showcase is M6 art; this is the playable
// core: ← → select, Enter drive, choices persist.

import { CAR_TUNES } from '../sim/carTunes';
import type { CarTune } from '../sim/car';
import type { PersistenceService } from '../persist/local';

interface CarMeta {
  cls: string;
  blurb: string;
}

const META: Record<string, CarMeta> = {
  'falcone-gt': { cls: 'AWD GRAND TOURER', blurb: 'Heavy, stable, forgiving.' },
  'vipera-rs': { cls: 'LIGHTWEIGHT RWD', blurb: 'Nimble — punishes over-correction.' },
  'bruto-widebody': { cls: 'TRACK WIDE-BODY', blurb: 'Huge sliding grip. A tank.' },
};

const UNLOCK_AT: Record<string, number> = {
  'falcone-gt': 0,
  'vipera-rs': 150000,
  'bruto-widebody': 500000,
};

/** Stats bars, 0..1 (M5 visual rubric — speed / accel / grip / toughness). */
function statBars(t: CarTune): Array<[string, number]> {
  return [
    ['speed', Math.min(1, t.vMax / 100)],
    ['accel', Math.min(1, t.launchForce / 16000)],
    ['grip', Math.min(1, (t.muFront + t.muRear) / 2 / 1.5 + t.downforce * 0.3)],
    ['tough', Math.min(1, t.healthMax / 140)],
  ];
}

export class Garage {
  private readonly root: HTMLElement;
  private readonly cars: HTMLElement;
  private readonly life: HTMLElement;
  private readonly hint: HTMLElement;
  private sel = 0;
  private cards: HTMLElement[] = [];
  private locked: boolean[] = [];

  constructor(
    private readonly persist: PersistenceService,
    private readonly onDrive: (tune: CarTune) => void,
    private readonly onBack: () => void,
  ) {
    this.root = document.getElementById('garage')!;
    this.cars = document.getElementById('garageCars')!;
    this.life = document.getElementById('garageLife')!;
    this.hint = document.getElementById('garageHint')!;
    document.getElementById('btnGarageGo')!.addEventListener('click', () => this.confirm());
    document.getElementById('btnGarageBack')!.addEventListener('click', () => {
      this.hide();
      onBack();
    });
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (this.root.classList.contains('hidden')) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      this.sel = (this.sel + CAR_TUNES.length - 1) % CAR_TUNES.length;
      this.render();
    } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      this.sel = (this.sel + 1) % CAR_TUNES.length;
      this.render();
    } else if (e.code === 'Enter') {
      this.confirm();
    }
  };

  private confirm(): void {
    if (this.locked[this.sel]) return;
    const tune = CAR_TUNES[this.sel];
    this.persist.setSettings({ car: tune.id });
    this.hide();
    this.onDrive(tune);
  }

  show(selectedId?: string): void {
    this.root.classList.remove('hidden');
    const idx = CAR_TUNES.findIndex((t) => t.id === selectedId);
    this.sel = idx >= 0 ? idx : 0;
    this.render();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private render(): void {
    const p = this.persist.progress;
    this.life.textContent = `lifetime ${Math.round(p.lifetimeScore).toLocaleString()} pts · ${p.totalRuns} runs · best ${Math.round(p.bestSpeed * 3.6)} km/h`;
    this.cars.innerHTML = '';
    this.cards = [];
    this.locked = [];
    CAR_TUNES.forEach((t, i) => {
      const need = UNLOCK_AT[t.id] ?? 0;
      const isLocked = !p.unlocks.includes(t.id) && p.lifetimeScore < need;
      this.locked.push(isLocked);
      const card = document.createElement('div');
      card.className = 'card' + (i === this.sel ? ' sel' : '') + (isLocked ? ' locked' : '');
      const h2 = document.createElement('h2');
      h2.textContent = t.name;
      const cls = document.createElement('div');
      cls.className = 'cls';
      const meta = META[t.id];
      cls.textContent = meta ? `${meta.cls} — ${meta.blurb}` : t.id;
      card.append(h2, cls);
      for (const [label, frac] of statBars(t)) {
        const row = document.createElement('div');
        row.className = 'statrow';
        const span = document.createElement('span');
        span.textContent = label;
        const bar = document.createElement('div');
        bar.className = 'bar';
        const fill = document.createElement('i');
        fill.style.width = `${Math.round(frac * 100)}%`;
        bar.append(fill);
        row.append(span, bar);
        card.append(row);
      }
      const stats = document.createElement('div');
      stats.className = 'cls';
      stats.textContent = `${Math.round(t.vMax * 3.6)} km/h · ${t.target0100.toFixed(1)} s · ${t.healthMax} hp`;
      card.append(stats);
      if (isLocked) {
        const lock = document.createElement('div');
        lock.className = 'locknote';
        lock.textContent = `locked — ${need.toLocaleString()} lifetime pts`;
        card.append(lock);
      }
      card.addEventListener('click', () => {
        this.sel = i;
        this.render();
      });
      card.addEventListener('dblclick', () => {
        this.sel = i;
        this.confirm();
      });
      this.cars.append(card);
      this.cards.push(card);
    });
    this.hint.textContent = this.locked[this.sel]
      ? 'locked — pick another (← →)'
      : '← → choose · ENTER drive';
  }
}
