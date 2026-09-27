// Options screen (M9, PLAN §15): steering sensitivity + one-handed mode,
// volume + latency readout, comfort toggles (shake / speed lines /
// reduced-motion), PiP corner + size, quality preset, recalibrate, and
// save-data export / import / reset. Pure DOM (≥44 px targets), live-applied
// through one callback so main.ts stays the single settings owner.

import type { PersistenceService, GameSettings } from '../persist/local';
import type { TrackerLike } from '../render/pip';

export interface OptionsCallbacks {
  /** every settings mutation lands here with the full new settings object;
   *  `changed` is '' on a full flush (import / reset) */
  onSettings(settings: GameSettings, changed: keyof GameSettings | ''): void;
  /** recalibrate hands (camera mode only — panel checks the tracker) */
  onRecalibrate(): void;
  /** live probe for the active hand tracker (may be null in keyboard mode) */
  getTracker(): TrackerLike | null;
  /** audio latency in ms, or null when audio is unavailable */
  audioLatencyMs(): number | null;
  /** master volume apply (live, without waiting for a settings flush) */
  setVolume(v: number): void;
  /** connect the phone remote to a relay (ws://host:port) */
  connectRemote(url: string): void;
  /** remote connection state for the status line */
  remoteStatus(): { status: string; latencyMs: number };
}

export class OptionsPanel {
  private readonly root: HTMLElement;
  private readonly sens: HTMLInputElement;
  private readonly sensVal: HTMLElement;
  private readonly oneHanded: HTMLInputElement;
  private readonly recal: HTMLButtonElement;
  private readonly recalHint: HTMLElement;
  private readonly vol: HTMLInputElement;
  private readonly volVal: HTMLElement;
  private readonly latency: HTMLElement;
  private readonly shake: HTMLInputElement;
  private readonly lines: HTMLInputElement;
  private readonly reduced: HTMLSelectElement;
  private readonly corners: HTMLButtonElement[];
  private readonly pipScale: HTMLInputElement;
  private readonly pipScaleVal: HTMLElement;
  private readonly quality: HTMLSelectElement;
  private readonly aid: HTMLSelectElement;
  private readonly relayUrl: HTMLInputElement;
  private readonly relayStatus: HTMLElement;
  private readonly resetBtn: HTMLButtonElement;
  private readonly importFile: HTMLInputElement;
  private latTimer: number | null = null;
  private resetArmed = false;
  private resetArmTimer = 0;

  constructor(
    private readonly persist: PersistenceService,
    private readonly cb: OptionsCallbacks,
  ) {
    this.root = document.getElementById('options')!;
    this.sens = document.getElementById('optSens') as HTMLInputElement;
    this.sensVal = document.getElementById('optSensVal')!;
    this.oneHanded = document.getElementById('optOneHanded') as HTMLInputElement;
    this.recal = document.getElementById('optRecal') as HTMLButtonElement;
    this.recalHint = document.getElementById('optRecalHint')!;
    this.vol = document.getElementById('optVol') as HTMLInputElement;
    this.volVal = document.getElementById('optVolVal')!;
    this.latency = document.getElementById('optLatency')!;
    this.shake = document.getElementById('optShake') as HTMLInputElement;
    this.lines = document.getElementById('optLines') as HTMLInputElement;
    this.reduced = document.getElementById('optReduced') as HTMLSelectElement;
    this.corners = [
      document.getElementById('optTL'),
      document.getElementById('optTR'),
      document.getElementById('optBL'),
      document.getElementById('optBR'),
    ] as HTMLButtonElement[];
    this.pipScale = document.getElementById('optPipScale') as HTMLInputElement;
    this.pipScaleVal = document.getElementById('optPipScaleVal')!;
    this.quality = document.getElementById('optQuality') as HTMLSelectElement;
    this.aid = document.getElementById('optAid') as HTMLSelectElement;
    this.relayUrl = document.getElementById('optRelayUrl') as HTMLInputElement;
    this.relayStatus = document.getElementById('optRelayStatus')!;
    this.resetBtn = document.getElementById('optReset') as HTMLButtonElement;
    this.importFile = document.getElementById('optImportFile') as HTMLInputElement;

    this.sens.addEventListener('input', () => {
      const v = Number(this.sens.value);
      this.sensVal.textContent = `${v.toFixed(2)}×`;
      this.commit({ sensitivity: v });
    });
    this.oneHanded.addEventListener('change', () =>
      this.commit({ oneHanded: this.oneHanded.checked }),
    );
    this.recal.addEventListener('click', () => {
      this.close();
      this.cb.onRecalibrate();
    });
    this.vol.addEventListener('input', () => {
      const v = Number(this.vol.value);
      this.volVal.textContent = `${Math.round(v * 100)}%`;
      this.cb.setVolume(v); // live
      this.commit({ volume: v });
    });
    this.shake.addEventListener('change', () => this.commit({ shake: this.shake.checked }));
    this.lines.addEventListener('change', () => this.commit({ speedLines: this.lines.checked }));
    this.reduced.addEventListener('change', () =>
      this.commit({ reducedMotion: this.reduced.value as GameSettings['reducedMotion'] }),
    );
    for (const btn of this.corners) {
      btn.addEventListener('click', () =>
        this.commit({ pipCorner: btn.dataset.corner as GameSettings['pipCorner'] }),
      );
    }
    this.pipScale.addEventListener('input', () => {
      const v = Number(this.pipScale.value);
      this.pipScaleVal.textContent = `${Math.round(v * 100)}%`;
      this.commit({ pipScale: v });
    });
    this.quality.addEventListener('change', () =>
      this.commit({ quality: this.quality.value as GameSettings['quality'] }),
    );
    this.aid.addEventListener('change', () =>
      this.commit({ driverAid: this.aid.value as GameSettings['driverAid'] }),
    );
    document.getElementById('optRelayConnect')!.addEventListener('click', () => {
      const url = this.relayUrl.value.trim();
      if (url) this.cb.connectRemote(url);
    });

    document.getElementById('optExport')!.addEventListener('click', () => this.exportSave());
    document.getElementById('optImport')!.addEventListener('click', () => this.importFile.click());
    this.importFile.addEventListener('change', () => void this.importSave());
    this.resetBtn.addEventListener('click', () => this.resetSave());

    document.getElementById('optDone')!.addEventListener('click', () => this.close());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.close(); // backdrop click
    });
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.syncFromSettings();
    this.root.classList.remove('hidden');
    this.refreshTrackerDependent();
    this.latTimer = window.setInterval(() => {
      this.updateLatency();
      const r = this.cb.remoteStatus();
      this.relayStatus.textContent =
        r.status === 'open'
          ? `connected · ${r.latencyMs.toFixed(0)} ms`
          : r.status === 'connecting'
            ? 'connecting…'
            : r.status === 'error'
              ? 'unreachable — is the relay running?'
              : 'not connected';
    }, 500);
    this.updateLatency();
  }

  close(): void {
    this.root.classList.add('hidden');
    if (this.latTimer !== null) {
      window.clearInterval(this.latTimer);
      this.latTimer = null;
    }
    this.disarmReset();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Push persisted settings into the controls (open + external changes). */
  syncFromSettings(): void {
    const s = this.persist.settings;
    this.sens.value = String(s.sensitivity);
    this.sensVal.textContent = `${s.sensitivity.toFixed(2)}×`;
    this.oneHanded.checked = s.oneHanded;
    this.vol.value = String(s.volume);
    this.volVal.textContent = `${Math.round(s.volume * 100)}%`;
    this.shake.checked = s.shake;
    this.lines.checked = s.speedLines;
    this.reduced.value = s.reducedMotion;
    for (const btn of this.corners) {
      btn.classList.toggle('sel', btn.dataset.corner === s.pipCorner);
    }
    this.pipScale.value = String(s.pipScale);
    this.pipScaleVal.textContent = `${Math.round(s.pipScale * 100)}%`;
    this.quality.value = s.quality;
    this.aid.value = s.driverAid;
  }

  /** Recalibrate button + latency line reflect the live tracker. */
  private refreshTrackerDependent(): void {
    const tracker = this.cb.getTracker();
    this.recal.disabled = tracker === null;
    this.recalHint.textContent =
      tracker === null
        ? 'camera mode only'
        : `${tracker.info.latencyMs.toFixed(0)} ms · ${tracker.info.delegate}` +
          (tracker.info.fps
            ? ` · ${tracker.info.fps.toFixed(0)} fps · ${tracker.info.res ?? '—'}`
            : '');
  }

  private updateLatency(): void {
    const tracker = this.cb.getTracker();
    const hands = tracker
      ? ` · hands ${tracker.info.latencyMs.toFixed(0)} ms (${tracker.info.delegate})`
      : '';
    const audioMs = this.cb.audioLatencyMs();
    this.latency.textContent =
      audioMs !== null ? `output latency ${audioMs.toFixed(1)} ms${hands}` : 'audio unavailable';
  }

  private commit(patch: Partial<GameSettings>): void {
    this.persist.setSettings(patch);
    const s = this.persist.settings;
    if ('pipCorner' in patch) {
      for (const btn of this.corners) {
        btn.classList.toggle('sel', btn.dataset.corner === s.pipCorner);
      }
    }
    // '' = full flush (import / reset) — re-apply every derived system
    const changed = (Object.keys(patch)[0] ?? '') as keyof GameSettings;
    this.cb.onSettings(s, changed);
  }

  private exportSave(): void {
    const blob = new Blob([this.persist.exportAll()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'velocifist-save.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  private async importSave(): Promise<void> {
    const file = this.importFile.files?.[0];
    this.importFile.value = '';
    if (!file) return;
    const text = await file.text();
    if (this.persist.importAll(text)) {
      this.syncFromSettings();
      this.commit({}); // flush every derived system with the imported settings
    }
  }

  private resetSave(): void {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.resetBtn.textContent = 'sure? click again';
      this.resetArmTimer = window.setTimeout(() => this.disarmReset(), 3000);
      return;
    }
    this.disarmReset();
    this.persist.wipe();
    this.syncFromSettings();
    this.commit({});
  }

  private disarmReset(): void {
    this.resetArmed = false;
    if (this.resetArmTimer) window.clearTimeout(this.resetArmTimer);
    this.resetArmTimer = 0;
    this.resetBtn.textContent = 'reset save data';
  }
}
