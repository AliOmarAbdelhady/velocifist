# PROGRESS.md — milestone tracker

> Updated at the end of every work session. ✅ done · 🔶 partial · ⬜ not started.

**Last updated:** 2026-09-22 (M1 session 2 — complete)
**Current milestone:** M1 — Vehicle & Camera Feel ✅ (automated gates green; user fun-panel + 60 FPS eyeball pending)
**Next step:** user says "continue" → M2 ⭐ (hand-tracking core: worker + MediaPipe + gestures + calibration)

## Milestones

| M | Scope | Status | Notes |
|---|---|---|---|
| M0 | Foundation: repo, Vite+TS, fixed-timestep loop, placeholder scene+car, dev HUD, tests | ✅ done | automated gates green; 60 FPS needs user's eyes |
| M1 | Vehicle physics + chase camera feel | ✅ done | 30/30 validation tests; fun panel on user |
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

## M1 checklist (session 2)

- [x] `src/sim/car.ts` — deterministic bicycle model (slip angles, Pacejka curve, grip circle, weight transfer, speed-sensitive steering, slide assist, off-road, soft wall, gear/RPM model)
- [x] `src/sim/cars/*.json` — Falcone GT / Vipera RS / Bruto Widebody tunes + `carTunes.ts`
- [x] `src/sim/intent.ts`, `src/sim/rng.ts` (mulberry32 + stateless hashRng)
- [x] `src/render/cameraRig.ts` — spring arm CHASE/HOOD/FAR, speed FOV, look-ahead bias, micro-shake
- [x] `src/render/carView.ts` — roll/pitch springs, rolling/steering wheels, per-tune rebuild
- [x] `src/render/cones.ts` — seeded instanced slalom course (stateless per-slot layout)
- [x] `src/render/scene.ts` rewrite — follow-planes world (texture-anchored endless road), car travels for real
- [x] Dev HUD extended (gear, rpm, β, lat g, cam mode) + live car switching (1/2/3) + camera cycle (C)
- [x] Removed placeholder mule (`vehicle.ts` + its tests)
- [x] Validation protocol tests (§6.3): 0–100, 100–0, cornering g, yaw overshoot, slalom, vMax, determinism, 10-min abuse — **30/30 green**
- [x] `npm run build` green — 124.9 kB gzip

### Session log — Session 2 (2026-09-22, M1)

- **3 real physics bugs found & fixed by the validation gates:**
  1. Tire curve written `sin(B·atan(C·α))` — collapses/oscillates past ~7° slip ⇒ every slide spun the car. Correct classic form is `sin(C·atan(B·α))` (PILL 015).
  2. Brake force not negated — braking *accelerated* the car at launch-force levels (PILL 016).
  3. Always-on β-based counter-steer assist unwound normal cornering (steady yaw 0.02 vs ~0.4); now triggers only on rear saturation + |β| > 0.2 (PILL 017).
- **2 test-fixture corrections** (physics was right, fixtures were wrong): wide-road tune clones for dynamics tests; slalom needs a closed-loop cascade driver model — an open-loop sine steer random-walks off any road (PILL 018).
- Tuning changes: Falcone μ 1.2; Vipera mid-engine geometry (a 1.42/b 1.08 ≈ 58% rear) + μ 1.26/1.45 to hit the 2.7 s RWD target.
- Verification: `npm test` 30/30 · `npm run build` green (124.9 kB gzip).

### Session 1 — 2026-09-22 (M0 complete)
- Project created at `/home/ali/velocifist` (user moved it out of `~/Klenka`).
- Plans merged → `docs/PLAN.md` v1.1 (ADR-001..006 recorded).
- M0 implemented: fixed-timestep loop (accumulator + interpolation + spiral guard), deterministic placeholder vehicle with state-hash, keyboard controller (reused intent object, zero alloc), Three.js scene (procedural canvas asphalt — zero image assets, scrolling road, guardrails, box car, chase-cam sketch with speed FOV 50→78°), benchmark dev HUD, start overlay.
- **Bug found & fixed by tests:** coasting car never fully stopped (coast-decel was conditionally disabled below 0.5 m/s, leaving only quadratic drag → eternal 0.4 m/s creep). Fix: coast decel applies to a full stop; clamp absorbs overshoot.
- **TS strict fix:** `: void`-annotated expression arrow returning `Set.delete()`'s boolean.
- Verification: `npm test` 12/12 · `npm run build` green (120 kB gzip) · repo pushed PRIVATE.
- Files: 20 committed, 2,902 lines. Commit `5112a92`.
