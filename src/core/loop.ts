// Fixed-timestep game loop with render interpolation ("Fix Your Timestep!", Fiedler).
// The simulation steps at a constant dt (default 60 Hz); rendering happens at display
// rate and interpolates between the previous and current sim state via alpha = acc/dt.

export interface LoopCallbacks {
  /** Advance the simulation by exactly dt seconds. Must be side-effect-pure in time. */
  step: (dt: number) => void;
  /** Draw the world. alpha ∈ [0,1) is the interpolation fraction between sim states. */
  render: (alpha: number, frameDt: number) => void;
}

export interface Loop {
  start(): void;
  stop(): void;
}

/** Max real-world delta consumed per frame; larger values (tab switch, debugger) are clamped. */
export const MAX_FRAME_DT = 0.25;
/** Panic guard: if we cannot catch up within this many steps, drop the backlog entirely. */
export const MAX_STEPS_PER_FRAME = 10;

export interface AccumulateResult {
  steps: number;
  acc: number;
  dropped: boolean;
}

// Reused result object — accumulate() runs every frame and must not allocate.
const _result: AccumulateResult = { steps: 0, acc: 0, dropped: false };

export function accumulate(
  acc: number,
  frameDt: number,
  dt: number,
  out: AccumulateResult = _result,
): AccumulateResult {
  acc += Math.min(frameDt, MAX_FRAME_DT);
  let steps = 0;
  while (acc >= dt && steps < MAX_STEPS_PER_FRAME) {
    acc -= dt;
    steps++;
  }
  let dropped = false;
  if (acc >= dt) {
    // Backlog exceeded the panic guard (long stall): drop it rather than spiral.
    acc = 0;
    dropped = true;
  }
  out.steps = steps;
  out.acc = acc;
  out.dropped = dropped;
  return out;
}

export function createLoop(cb: LoopCallbacks, simHz = 60): Loop {
  const dt = 1 / simHz;
  let acc = 0;
  let prev = 0;
  let raf = 0;
  let running = false;

  const frame = (t: number) => {
    const frameDtSec = Math.max(0, (t - prev) / 1000);
    prev = t;
    const r = accumulate(acc, frameDtSec, dt);
    acc = r.acc;
    for (let i = 0; i < r.steps; i++) cb.step(dt);
    cb.render(acc / dt, Math.min(frameDtSec, MAX_FRAME_DT));
    if (running) raf = requestAnimationFrame(frame);
  };

  return {
    start() {
      if (running) return;
      running = true;
      prev = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
