// ADR-021 (CPU-class AR): pure decision logic for the hand pipeline — which
// delegate to run and what inference frame size to feed it. Both are chosen
// from MEASURED timings, never assumed: a weak GPU happily initializes WebGL
// and then runs several times slower than the CPU, and "GPU first, CPU only
// on crash" locks exactly those machines (the field report) into the slow
// path forever. Pure module so the decisions are unit-testable.

export type DelegatePref = 'auto' | 'gpu' | 'cpu';

/**
 * Pick the inference delegate from median per-frame times (ms, null = the
 * delegate could not even be built). GPU must win by a real margin to be
 * worth its WebGL context — ties and near-ties go to CPU, the lower-risk
 * path (no driver quirks, no context loss, no surprise swiftshader).
 */
export function pickDelegate(gpuMs: number | null, cpuMs: number | null): 'GPU' | 'CPU' {
  if (gpuMs === null) return 'CPU';
  if (cpuMs === null) return 'GPU';
  return gpuMs < cpuMs * 0.85 ? 'GPU' : 'CPU';
}

/** Inference-frame ladders (w×h) per delegate. Start at the mid entry. */
export const RES_LADDERS: Record<'GPU' | 'CPU', Array<[number, number]>> = {
  GPU: [
    [320, 240],
    [480, 360],
    [560, 420],
  ],
  CPU: [
    [256, 192],
    [320, 240],
    [384, 288],
  ],
};

/** Start resolution for a delegate (the current shipped defaults). */
export function startResolution(delegate: 'GPU' | 'CPU'): [number, number] {
  return RES_LADDERS[delegate][Math.floor(RES_LADDERS[delegate].length / 2)];
}

/**
 * Next inference resolution for a sustained per-frame EMA (ms), or null to
 * stay. Step DOWN when struggling (usability beats precision — the wheel
 * must keep turning), step UP when comfortably fast (accuracy is free:
 * bigger inference frames = better landmarks at distance). Called once per
 * evaluation window, so the thresholds double as hysteresis.
 */
export function nextResolution(
  emaMs: number,
  current: [number, number],
  ladder: ReadonlyArray<readonly [number, number]>,
): [number, number] | null {
  let idx = ladder.findIndex((r) => r[0] === current[0] && r[1] === current[1]);
  if (idx < 0) {
    idx = ladder.findIndex((r) => r[0] >= current[0]); // nearest by width
    if (idx < 0) return null;
  }
  if (emaMs > 48 && idx > 0) return [ladder[idx - 1][0], ladder[idx - 1][1]];
  if (emaMs < 20 && idx < ladder.length - 1) return [ladder[idx + 1][0], ladder[idx + 1][1]];
  return null;
}

/** Frames processed between adaptive-resolution evaluations (~1.5 s at 30 Hz). */
export const RES_EVAL_FRAMES = 45;
