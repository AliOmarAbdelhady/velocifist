// Versus race state machine (ADR-018) — PURE sim, no network, no DOM.
// The race is a ghost race: both players drive identical-seed worlds; the
// opponent is a translucent ghost with no collision. First to `target`
// metres of odometer wins; wrecking is an instant loss; a disconnect hands
// the win to the player who stayed. The network layer only DELIVERS events
// — every verdict is computed here, identically on both ends, and tested.

export type VsPhase = 'countdown' | 'racing' | 'finished';
export type VsOutcome =
  | 'win-distance'
  | 'loss-distance'
  | 'win-wreck'
  | 'loss-wreck'
  | 'win-disconnect'
  | 'loss-disconnect'
  | null;

export class VersusRace {
  phase: VsPhase = 'countdown';
  outcome: VsOutcome = null;
  /** countdown remaining, s (drives the 3-2-1-GO overlay) */
  countdown: number;
  /** race clock, s (starts at GO) */
  time = 0;
  localDist = 0;
  remoteDist = 0;
  /** seconds since the last remote pose (ghost fade / disconnect guard) */
  remoteAgeSec = Infinity;

  private readonly target: number;
  private remoteFinished = false;

  constructor(target: number, goIn = 3.2) {
    this.target = target;
    this.countdown = goIn;
  }

  /** One sim step. Feeds both odometers + the remote-pose age. */
  tick(dt: number, localDist: number, remoteDist: number, remoteAgeSec: number): void {
    this.localDist = localDist;
    this.remoteDist = remoteDist;
    this.remoteAgeSec = remoteAgeSec;
    if (this.phase === 'finished') return;
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.countdown = 0;
        this.phase = 'racing';
      }
      return; // nobody moves before GO (main.ts gates the sim input)
    }
    this.time += dt;
    if (this.localDist >= this.target) {
      this.finish('win-distance');
    }
    // opponent silent for 6 s while racing = link dead (poses arrive at 15 Hz)
    if (this.phase === 'racing' && remoteAgeSec > 6) {
      this.finish('win-disconnect');
    }
  }

  /** The opponent crossed the line first (their finish message arrived). */
  remoteFinish(): void {
    if (this.phase === 'racing') {
      this.remoteFinished = true;
      this.finish('loss-distance');
    }
  }

  /** The opponent wrecked (their wrecked message arrived). */
  remoteWrecked(): void {
    if (this.phase === 'racing') this.finish('win-wreck');
  }

  /** The peer connection dropped (their bye message or the channel closing). */
  remoteLeft(): void {
    if (this.phase === 'countdown') this.finish('win-disconnect');
    else if (this.phase === 'racing' && !this.remoteFinished) this.finish('win-disconnect');
  }

  /** The local player wrecked. */
  localWreck(): void {
    if (this.phase === 'racing' || this.phase === 'countdown') this.finish('loss-wreck');
  }

  /** + = the local player is AHEAD, in metres. */
  get gap(): number {
    return this.localDist - this.remoteDist;
  }

  get position(): 1 | 2 {
    return this.gap >= 0 ? 1 : 2;
  }

  get targetDist(): number {
    return this.target;
  }

  get won(): boolean {
    return this.outcome !== null && this.outcome.startsWith('win');
  }

  private finish(outcome: VsOutcome): void {
    this.phase = 'finished';
    this.outcome = outcome;
  }
}
