# AGENTS.md — rules for AI agents working in this repo (ZCode, Codex, or human collaborators)

## Read before doing anything

1. `docs/PLAN.md` — the canonical master plan (what we're building and why)
2. `docs/PROGRESS.md` — where we are (current milestone, next step)
3. `docs/MEMORY.md` — memory pills (facts, decisions, gotchas learned so far)
4. `docs/DECISIONS.md` — ADRs (never contradict an active ADR; supersede explicitly if needed)

## Project law

- **Update docs on every change:** any code/design/behavior change appends a pill to
  `docs/MEMORY.md` and updates `docs/PROGRESS.md` (checklist + session log) in the same commit.
  Design changes also update `docs/PLAN.md`; architectural choices get a new ADR.
- **Milestone cadence:** one milestone (or a coherent slice) per work session; end the session
  with a report and wait for the user's "continue". Do not race ahead into future milestones.
- **`src/sim/` is pure:** no DOM, no Three.js, no WebSocket, no `performance.now()` inside step
  logic. Deterministic, unit-tested. Rendering/input/audio live outside it.
- **Zero allocations in hot paths:** no object/closure/array creation inside per-frame or
  per-step code; use preallocated typed-array pools.
- **TypeScript strict**; match existing style; small focused modules per the layout in
  `docs/PLAN.md` §21.
- **Tests:** `npm test` must stay green. New sim logic ships with unit tests. Determinism
  (state-hash) and fairness invariants are CI tests, not aspirations.
- **Commit messages:** `M<phase> <system>: <summary>` (e.g., `M2 input: crossing-safe hand tracker`).

## Commands

```bash
npm run dev      # dev server
npm test         # vitest
npm run build    # typecheck + build
```

## Hard constraints (from PLAN)

- 60 FPS on Iris Xe-class iGPU; ≤ 250 draw calls (Low); 0 GC allocs/frame steady state.
- Hand-tracking: never trust MediaPipe handedness labels after lock-on (own identity tracker).
- Every traffic spawn must keep a provably survivable line (fairness invariant).
- Latency budget input→pixels ≤ 100 ms p95.
