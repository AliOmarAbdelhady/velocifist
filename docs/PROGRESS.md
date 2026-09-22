# PROGRESS.md — milestone tracker

> Updated at the end of every work session. ✅ done · 🔶 partial · ⬜ not started.

**Last updated:** 2026-09-22 (M0 session 1)
**Current milestone:** M0 — Foundation
**Next step after this session:** user says "continue" → M1 (bicycle-model vehicle + chase camera + cones)

## Milestones

| M | Scope | Status | Notes |
|---|---|---|---|
| M0 | Foundation: repo, Vite+TS, fixed-timestep loop, placeholder scene+car, dev HUD, tests | 🔶 in progress (this session) | see session log |
| M1 | Vehicle physics + chase camera feel | ⬜ | |
| M2 ⭐ | Hand-tracking core (worker, MediaPipe, gestures, calibration) | ⬜ | highest risk, done early |
| M3 | Traffic AI + swept collision + near-miss detection | ⬜ | |
| M4 | World streaming + 3 environments | ⬜ | |
| M5 | Scoring/damage/persistence/garage | ⬜ | |
| M6 | Art + audio pass, quality tiers | ⬜ | |
| M7 | Difficulty director + events + telemetry | ⬜ | |
| M8 | Playtest calibration (4–6 min target) + polish | ⬜ | |
| M9 | Ship prep | ⬜ | |

## M0 checklist (this session)

- [x] Merged plan v1.1 → `docs/PLAN.md`
- [x] Memory/tracking docs created (MEMORY/PROGRESS/DECISIONS/README/AGENTS)
- [ ] Vite + TS strict scaffold (package.json, tsconfig, vite.config, index.html)
- [ ] `src/core/loop.ts` fixed-timestep accumulator + interpolation + `accumulate()` pure helper
- [ ] `src/sim/vehicle.ts` placeholder kinematic mule (deterministic, state-hash)
- [ ] `src/input/keyboard.ts` → DriverIntent
- [ ] `src/render/scene.ts` Three scene: fog, lights, procedural canvas road texture (scrolling), guardrails, box car, chase-style camera + speed FOV
- [ ] `src/render/devHud.ts` benchmark harness: FPS, ms, draw calls, tris, speed
- [ ] `src/main.ts` wiring + start overlay
- [ ] Tests: `loop.test.ts` (accumulator math), `vehicle.test.ts` (determinism hash, vMax, road clamp)
- [ ] `npm install` + `npm run build` + `npm test` all green
- [ ] Git init + commit + private GitHub repo created + pushed
- [ ] MEMORY/PROGRESS updated with results

## Acceptance criteria for M0 (from PLAN §20)

1. 60 FPS keyboard drive on iGPU — *needs user visual confirmation; build+tests green is the automated part*
2. Determinism hash test green — *unit test*
3. Dev HUD shows frame time + draw calls (benchmark harness exists)

## Session log

### Session 1 — 2026-09-22 (M0 part 1)
- Project created at `/home/ali/velocifist` (user moved it out of `~/Klenka`).
- Plans merged → `docs/PLAN.md` v1.1.
- (results appended at end of session)
