# PROGRESS.md — milestone tracker

> Updated at the end of every work session. ✅ done · 🔶 partial · ⬜ not started.

**Last updated:** 2026-09-22 (M0 session 1 — complete)
**Current milestone:** M0 — Foundation ✅ (pending user visual confirmation of 60 FPS)
**Next step:** user says "continue" → M1 (bicycle-model vehicle + chase camera + cones)

## Milestones

| M | Scope | Status | Notes |
|---|---|---|---|
| M0 | Foundation: repo, Vite+TS, fixed-timestep loop, placeholder scene+car, dev HUD, tests | ✅ done | automated gates green; 60 FPS needs user's eyes |
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
- [x] Vite + TS strict scaffold (package.json, tsconfig, vite.config, index.html)
- [x] `src/core/loop.ts` fixed-timestep accumulator + interpolation + `accumulate()` pure helper (zero-alloc out-param)
- [x] `src/sim/vehicle.ts` placeholder kinematic mule (deterministic, state-hash)
- [x] `src/input/keyboard.ts` → DriverIntent
- [x] `src/render/scene.ts` Three scene: fog, lights, procedural canvas road texture (scrolling), guardrails, box car, chase-style camera + speed FOV
- [x] `src/render/devHud.ts` benchmark harness: FPS, ms, draw calls, tris, speed
- [x] `src/main.ts` wiring + start overlay
- [x] Tests: `loop.test.ts` (6), `vehicle.test.ts` (6) — **12/12 green**
- [x] `npm install` + `npm run build` + `npm test` all green (build 472 kB raw / 120 kB gzip)
- [x] Git init + commit + private GitHub repo created + pushed (`AliOmarAbdelhady/velocifist`, PRIVATE)
- [x] MEMORY/PROGRESS updated with results

## Acceptance criteria for M0 (from PLAN §20)

1. 60 FPS keyboard drive on iGPU — 🔶 **pending user visual run** (`npm run dev` → click START → drive; watch dev HUD top-left). Scene is ~11 draw calls, so headroom is huge.
2. Determinism hash test green — ✅ `vehicle.test.ts` "bit-deterministic" (60 s scripted run, hash equality)
3. Dev HUD shows frame time + draw calls (benchmark harness exists) — ✅

## Session log

### Session 1 — 2026-09-22 (M0 complete)
- Project created at `/home/ali/velocifist` (user moved it out of `~/Klenka`).
- Plans merged → `docs/PLAN.md` v1.1 (ADR-001..006 recorded).
- M0 implemented: fixed-timestep loop (accumulator + interpolation + spiral guard), deterministic placeholder vehicle with state-hash, keyboard controller (reused intent object, zero alloc), Three.js scene (procedural canvas asphalt — zero image assets, scrolling road, guardrails, box car, chase-cam sketch with speed FOV 50→78°), benchmark dev HUD, start overlay.
- **Bug found & fixed by tests:** coasting car never fully stopped (coast-decel was conditionally disabled below 0.5 m/s, leaving only quadratic drag → eternal 0.4 m/s creep). Fix: coast decel applies to a full stop; clamp absorbs overshoot.
- **TS strict fix:** `: void`-annotated expression arrow returning `Set.delete()`'s boolean.
- Verification: `npm test` 12/12 · `npm run build` green (120 kB gzip) · repo pushed PRIVATE.
- Files: 20 committed, 2,902 lines. Commit `5112a92`.
