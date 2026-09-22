// Deterministic seeded RNG (mulberry32). Pure — reused by cones (M1), world
// streaming and traffic (M3/M4). Identical seeds ⇒ identical sequences, always.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless per-index deterministic value in [0,1) — order-independent pattern lookup. */
export function hashRng(index: number, seed = 1337): number {
  return mulberry32((seed ^ Math.imul(index + 1, 2654435761)) >>> 0)();
}
