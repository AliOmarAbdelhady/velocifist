// Game HUD (PLAN §15, M5): speed + gear, score + combo, health bar with
// state label, floating score toasts. DOM-based (crisp text, zero GPU cost),
// updated at render rate but text only mutates on change.

import type { ScoringSystem, ScorePopup } from '../sim/scoring';
import type { DamageSystem, HealthState } from '../sim/damage';
import type { Car } from '../sim/car';

const STATE_LABEL: Record<HealthState, { text: string; color: string }> = {
  PRISTINE: { text: 'PRISTINE', color: '#43d17a' },
  DAMAGED: { text: 'DAMAGED', color: '#ffb01f' },
  CRITICAL: { text: 'CRITICAL', color: '#ff4d4d' },
  WRECKED: { text: 'WRECKED', color: '#ff4d4d' },
};

export class GameHud {
  private readonly root: HTMLElement;
  private readonly kmh: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly pts: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly healthLabel: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly assistChip: HTMLElement;
  private lastScore = -1;
  private lastKmh = -1;
  private lastGear = -1;
  private lastState: HealthState | null = null;
  private lastHealthFrac = -1;

  constructor() {
    this.root = document.getElementById('hud')!;
    this.kmh = document.getElementById('hudKmh')!;
    this.gear = document.getElementById('hudGear')!;
    this.pts = document.getElementById('hudPts')!;
    this.combo = document.getElementById('hudCombo')!;
    this.healthLabel = document.getElementById('hudHealthLabel')!;
    this.healthFill = document.getElementById('hudHealthFill')!;
    this.toasts = document.getElementById('hudToasts')!;
    this.assistChip = document.getElementById('hudAssist')!;
  }

  /** AUTO-BRAKE chip while the forward-collision assist is engaging. */
  setAssist(level: number): void {
    this.assistChip.classList.toggle('on', level > 0.05);
  }

  /** Small transient notification (hand-status etc.). */
  notify(text: string, cls = ''): void {
    const el = document.createElement('div');
    el.className = `toast ${cls}`;
    el.textContent = text;
    this.toasts.append(el);
    setTimeout(() => el.remove(), 1500);
  }

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  update(car: Car, scoring: ScoringSystem, damage: DamageSystem): void {
    const kmh = Math.round(Math.abs(car.u) * 3.6);
    if (kmh !== this.lastKmh) {
      this.kmh.textContent = String(kmh);
      this.lastKmh = kmh;
    }
    if (car.gear !== this.lastGear) {
      this.gear.textContent = String(car.gear);
      this.lastGear = car.gear;
    }
    const score = Math.round(scoring.score);
    if (score !== this.lastScore) {
      this.pts.textContent = score.toLocaleString();
      this.lastScore = score;
    }
    const comboText =
      scoring.combo >= 2
        ? `×${scoring.comboMultiplier.toFixed(2)} combo ${scoring.combo}${scoring.flow ? ' · FLOW' : ''}`
        : scoring.flow
          ? 'FLOW'
          : '';
    if (comboText !== this.combo.textContent) {
      this.combo.textContent = comboText;
      this.combo.classList.toggle('flow', scoring.flow);
    }
    const frac = damage.healthFrac;
    if (frac !== this.lastHealthFrac) {
      this.healthFill.style.width = `${Math.round(frac * 100)}%`;
      const st = STATE_LABEL[damage.state];
      this.healthFill.style.background =
        damage.state === 'PRISTINE'
          ? 'linear-gradient(90deg, #43d17a, #a8e063)'
          : damage.state === 'DAMAGED'
            ? 'linear-gradient(90deg, #ffb01f, #ffd26f)'
            : 'linear-gradient(90deg, #ff4d4d, #ff8a5c)';
      void st;
      this.lastHealthFrac = frac;
    }
    if (damage.state !== this.lastState) {
      const st = STATE_LABEL[damage.state];
      this.healthLabel.textContent = st.text;
      this.healthLabel.style.color = st.color;
      this.lastState = damage.state;
    }
    for (const p of scoring.takePopups()) this.toast(p);
  }

  private toast(p: ScorePopup): void {
    const el = document.createElement('div');
    el.className = 'toast';
    switch (p.kind) {
      case 'NEAR_MISS':
        el.classList.add(
          p.tier === 'INCHES' ? 'inches' : p.tier === 'VERY_CLOSE' ? 'very' : 'near',
        );
        if (p.oncoming) el.classList.add('oncoming');
        el.textContent =
          p.tier === 'INCHES' ? 'INCHES!' : p.tier === 'VERY_CLOSE' ? 'VERY CLOSE' : 'NEAR MISS';
        el.append(` +${p.points.toLocaleString()}`);
        break;
      case 'CLEAN_PASS':
        el.classList.add('pass');
        el.textContent = `clean pass +${p.points}`;
        break;
      case 'STREAK':
        el.classList.add('streak');
        el.textContent = `30 s CLEAN +${p.points.toLocaleString()}`;
        break;
      case 'FLOW':
        el.classList.add('flow');
        el.textContent = 'FLOW';
        break;
      case 'WRECK':
        return; // results screen handles the finale
    }
    this.toasts.append(el);
    setTimeout(() => el.remove(), 1500);
  }
}
