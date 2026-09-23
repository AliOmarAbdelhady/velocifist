// VersusPanel (ADR-018): the create/join lobby. Generates the match code,
// owns the VersusSession until the race config is agreed, then hands the
// session to the game launcher. Reopened after a race for rematch/leave.

import { genCode, normalizeCode } from '../net/matchCode';
import { VersusSession } from '../net/session';
import type { BrokerConfig } from '../net/peer';

export class VersusPanel {
  private readonly root: HTMLElement;
  private readonly codeBox: HTMLElement;
  private readonly codeEl: HTMLElement;
  private readonly joinInput: HTMLInputElement;
  private readonly statusEl: HTMLElement;
  private session: VersusSession | null = null;
  /** e2e hook: ?broker=host:port:key forces a local PeerServer */
  private readonly broker: BrokerConfig | undefined;

  constructor(
    private readonly myCarId: string,
    private readonly onRaceStart: (session: VersusSession) => void,
    private readonly onExit: () => void,
  ) {
    this.root = document.getElementById('versus')!;
    this.codeBox = document.getElementById('vsCodeBox')!;
    this.codeEl = document.getElementById('vsCode')!;
    this.joinInput = document.getElementById('vsJoinInput') as HTMLInputElement;
    this.statusEl = document.getElementById('vsStatus')!;
    const b = new URLSearchParams(location.search).get('broker');
    if (b) {
      const [host, port, key] = b.split(':');
      this.broker = { host, port: Number(port) || 9000, key: key || 'peerjs', path: '/', secure: false };
    }
    document.getElementById('btnVsCreate')!.addEventListener('click', () => void this.create());
    document.getElementById('btnVsJoin')!.addEventListener('click', () => void this.join());
    document.getElementById('btnVsBack')!.addEventListener('click', () => this.close());
    this.joinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.join();
      e.stopPropagation(); // don't reach the game's key handler
    });
  }

  open(): void {
    this.root.classList.remove('hidden');
    this.refresh();
  }

  close(): void {
    this.session?.leave();
    this.session = null;
    this.root.classList.add('hidden');
    this.onExit();
  }

  /** after a race: reopen for rematch/leave (session still alive). */
  reopen(session: VersusSession): void {
    this.session = session;
    this.root.classList.remove('hidden');
    this.refresh();
  }

  /** the run is fully over — allow creating/joining a fresh match */
  reset(): void {
    this.session = null;
    this.joinInput.value = '';
    this.refresh();
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  private async create(): Promise<void> {
    if (this.session) return;
    this.setCode('· · · · ·');
    this.setStatus('contacting the matchmaker…');
    try {
      const session = await VersusSession.host(genCode(Math.random), this.broker);
      session.myCarId = this.myCarId;
      this.adopt(session);
    } catch {
      this.setStatus('could not reach the matchmaker — try again');
    }
  }

  private async join(): Promise<void> {
    if (this.session) return;
    const code = normalizeCode(this.joinInput.value);
    if (!code) {
      this.setStatus('enter the 5-character code your friend sent');
      return;
    }
    this.setStatus('joining ' + code + '…');
    try {
      const session = await VersusSession.join(code, this.broker);
      session.myCarId = this.myCarId;
      this.adopt(session);
    } catch {
      this.setStatus('could not reach the matchmaker — try again');
    }
  }

  private adopt(session: VersusSession): void {
    this.session = session;
    session.onChanged = () => this.refresh();
    session.onLobby = () => {
      if (session.isHost) this.setCode(session.code);
    };
    session.onStart = () => {
      // hand over to the game; the panel hides but the session lives on
      this.hide();
      this.onRaceStart(session);
    };
    this.refresh();
  }

  private setCode(code: string): void {
    this.codeBox.classList.remove('hidden');
    this.codeEl.textContent = code;
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private refresh(): void {
    const s = this.session;
    if (!s) {
      this.codeBox.classList.add('hidden');
      this.setStatus('');
      return;
    }
    if (s.isHost && s.code) this.setCode(s.code);
    this.setStatus(
      s.state === 'dead' ? s.statusText + ' — create or join again'
      : s.statusText + (s.pingMs !== null ? ` · ${Math.round(s.pingMs)} ms` : ''),
    );
  }
}
