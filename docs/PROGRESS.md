# PROGRESS.md — milestone tracker

> Updated at the end of every work session. ✅ done · 🔶 partial · ⬜ not started.

**Last updated:** 2026-09-22 (M5 session 7 — complete + easy-first rework)
**Current milestone:** M5 — Game systems ✅ (125/125 tests; full loop verified live end-to-end)
**Next step:** user plays the full game loop (drive → wreck → results → retry, garage, scoring, saves); then "continue" → M6 (art & audio pass, quality tiers)

## Milestones

| M | Scope | Status | Notes |
|---|---|---|---|
| M0 | Foundation: repo, Vite+TS, fixed-timestep loop, placeholder scene+car, dev HUD, tests | ✅ done | automated gates green; 60 FPS needs user's eyes |
| M1 | Vehicle physics + chase camera feel | ✅ done | 30/30 validation tests; fun panel on user |
| M2 ⭐ | Hand-tracking core (worker, MediaPipe, gestures, calibration) | 🔶 code-complete | scripted gates 56/56; live camera half = user |
| M3 | Traffic AI + swept collision + near-miss detection | ✅ done | soak 0 violations; 73/73 |
| M4 | World streaming + 3 environments | ✅ done | 98/98; curved+straight soaks clean; gates green |
| M5 | Scoring/damage/persistence/garage + EASY-first rework (ADR-008) | ✅ done | 125/125; E2E live-verified |
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

### M2 checklist (session 3)

- [x] `@mediapipe/tasks-vision` installed; wasm + 7.8 MB float16 model vendored (offline-first)
- [x] `oneEuro.ts` + tests (jitter, lag, adaptivity, reset)
- [x] `handTracks.ts` identity tracker + `swap()` + tests (crossing with label flip, dropout, teleport)
- [x] `gestures.ts` — grip metric, magnitude-gated wheel, regrip FSM, calibration capture, AUTO-HOLD + 18 tests (sign rules, dead zone, lock clamp, monotonic, zone gating, false-brake gate <1%)
- [x] `arbiter.ts` hands⊕keyboard
- [x] `tracker.worker.ts` (GPU→CPU fallback, single-flight) + `handTracker.ts` (mirroring, latency EMA, side-fix)
- [x] `pip.ts` AR overlay (mirror, skeleton, live wheel sprite, grip glows, pedals, status)
- [x] `calibrationWizard.ts` (side-fix → anchors → practice with mean-error)
- [x] Flow wiring: camera explainer → wizard → drive; keyboard-only fallback path; HUD input line
- [x] Tests 56/56 · build green (130.9 kB gzip main + 144 kB worker; assets verified in dist)
- [ ] **LIVE GATES (user, PLAN §5.9):** wizard mean error, latency readout, crossing feel, false-brake feel, dropout grace — report back for tuning

### Session 7 (2026-09-22, M5 + easy-first) — game systems complete
- USER DIRECTIVE (ADR-008): game is EASY — lane-keep + stability assists always on, relaxed density (6.5→9 flat), softer wall/grass, rarer oncoming; 4–6-min death target RETIRED (PLAN v1.2).
- scoring.ts (passive/tiers/oncoming ×2/combo cap 10/clean passes/streaks/FLOW regen) + damage.ts (impulse curve, window merge, states, wreck) + persistence (atomic, injectable storage, unlocks) + traffic clean-pass events.
- UI: game HUD (speed/score/combo/health/toasts), results overlay (audit breakdown, NEW BEST), garage picker (stats bars, locks, persists choice).
- main.ts: Game class run lifecycle (retry/garage keys, theme rotation per run, live density from director).
- 125/125 (27 new: scoring 12, damage 7, persist 7, director/car updated).
- Live E2E in browser: garage → hands-off 317 km/h (assist proof) → forced wreck → results 17,387 pts → localStorage written → retry → fresh run on Neon.

### Session 6 (2026-09-22, M4) — world & environments complete
- RoadSystem (curved spine, ADR-007), DifficultyDirector skeleton, car RoadGuide, traffic s/lat/dir refactor with oncoming lanes + relative collision sweep.
- Render: ribbon + zone-aware markings + rails, 3 themed environments (sky shader/fog/lights/props), construction cones (knockable), scene rewrite, world HUD line, T-key theme cycle.
- 98/98 (25 new: road 14, director 6, car +2, traffic reworked 12 incl. curved soak + head-on tunneling + oncoming zones).
- Real bugs caught: κ(s) global-vs-local frame (curves integrated to zero), projection walk outrunning generation + directional-walk vertex bias, stop-distance fairness model (7 soak violations), oncoming hysteresis below p, wall freshness, water under ground, markings lost to tint multiply (PILLs 046–056).
- Browser-verified live: 60 fps, 17–19 draw calls, ~9 k tris, chunk gen 0.1–0.2 ms; markings/ocean/rails confirmed by zoomed screenshot review.

### Session 5 (2026-09-22, M3) — traffic + collision complete
- TrafficSystem, collision, near-miss, instanced renderer, wiring; 73/73 (17 new).
- Real bugs caught: empty event rings, player-state copy mutation, ahead/behind inversion, invisible yaw gain (PILL 041).
- Fairness soak: 60 sim-minutes, escape invariant 0 violations.

### Session 4 (2026-09-22, hotfix 2) — worker wasm loading fixed for dev (blob + module glue, GPU-verified in browser); mute grace; camlost overlay at startup; handling rework: downforce + soft falloff + steer fade + ESC-lite (56/56 green).

### Session log — Session 3 (2026-09-22, M2)

- 2 more real bugs caught by tests/fixture design: inverted finger-curl formula (PILL 024) and the wheel-at-neutral atan2 singularity → magnitude gate (PILL 023); plus tracker lock-on frame now resolves immediately, and physical-side swap() kills handedness ambiguity forever (PILL 025).
- Fixed 2 test-side errors: fistAt rotation sign convention, dead-zone wiggle 10× larger than real jitter.

### Session 2 (2026-09-22, M1)

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

### Session 8 (2026-09-22, M6) — art & audio pass complete
- **Hero cars:** procedural extruded-profile supercars per archetype (Falcone GT wedge / Vipera RS teardrop + rear wing / Bruto box + scoop), glass greenhouse, spoke-texture rims that spin, brake-light bar, night headlights, blob shadow, damage presentation (sooty paint, loose wobbling bumper, dying/flickering lights, wreck askew). ~16 draws/car via per-material merging (PILL 064 mergeMix gotcha).
- **FX:** pooled GPU particles (sparks at crash contacts, damage/tire smoke with per-particle size/alpha/color shader) + camera-space speed-line streaks (retuned curve after QA showed the first was sub-perceptual).
- **Grade pass:** linear RT → single quad (theme tint/sat/vignette/speed-CA/grain), ACES tone mapping, off on Low. Theme-matched PMREM env maps for paint reflections.
- **Quality:** low/med/high presets + EMA autoscaler with hysteresis + manual cap; settings.quality 'auto' default; Q cycles; dev HUD line.
- **Audio (ADR-009):** 100% procedural WebAudio — per-cylinder ignition synthesis, load distortion, gear torque-cuts, turbo + blow-off (Vipera), wind/rumble/squeal beds, panned near-miss whooshes, layered crashes ∝ impulse, wreck cut; master compressor; latency readout in dev HUD.
- **Wiring:** CarView update from Car (brake/throttle/offroad fields), NearMissEvent.side, CrashEvent.x/z for spark anchors, damage-state plumbing into car + FX, audio lifecycle across run/retry/results, floating-origin fx.rebase.
- **Robustness:** camera-rig spring substepping (was divergent on slow frames — QA-caught), favicon 404 silenced.
- **Verification:** 150/150 tests (25 new: quality/autoscaler, audio curves, damage visuals, grade data); build green; headless-Chrome E2E (`scripts/e2e-m6.mjs` + `?smash=1` backdoor) drives → 216 km/h → near-miss whooshes → crash chain (sparks/smoke/screenshots confirmed by QA subagent: 5 PASS / 1 PASS-WITH-ISSUES resolved by streak retune) → WRECKED → results with audit table; 0 console errors. IAB pane was occluded this session → headless path (PILL 072).

### Session 9 (2026-09-23, M7 re-scope) — hands & AR pass (user directives: better detection, very easy, enhanced AR)
- **Detection:** arbiter EMA + hysteresis (flicker no longer cuts the car — PILL 074), PARTIAL-hold for one-hand flicker, sticky MediaPipe thresholds, 480×360 GPU inference from a 960×720 request, longer lost-grace (0.9 s) with gentler auto-hold.
- **Very easy:** forward-collision auto-brake assist (TTC model, steer relief, 0.7 cap, AUTO-BRAKE chip), damage k 7.5 + regen cap 45%, softer guardrail, stronger lane-keep (PILL 080). Live proof: repeated full-speed ghost-truck encounters left the car PRISTINE.
- **AR:** PiP rewritten as an AR dashboard (skeletons with grip arcs + trails, rocker wheel with hand orbs + chevrons, pedal meters, gesture banner, pulsing status ring), screen-edge hand glow, hand-status toasts, bigger panel. `?pipdemo=1` drives the whole game with synthetic hands through the real pipeline.
- **Verification:** 170/170 tests (arbiter/assist/demo/banner suites + PARTIAL-hold gate); E2E `scripts/e2e-m7.mjs` three runs green (demo autonomy + glow cycle; assist chase peak 0.70 + chip; fake-camera worker READY + lost UX), 0 console errors; visual QA subagent pass (glow visibility fixed from its findings).
- Docs: PLAN v1.4 (M7 re-scope), ADR-010.

### Session 10 (2026-09-23, M8) — variety & events complete
- EventDirector with six deterministic, survivable set-pieces (convoy / rolling roadblock / road train / rubberneckers / cutter / weaver), each fairness-checked with full rollback; readable HUD toasts name the threat and the read; mercy pauses the schedule.
- Injected agents are ordinary traffic: near-miss scoring, IDM, knocks — convoys measurably feed the score (12 near-misses in one E2E run).
- Telemetry: 1 Hz run vitals + audit block, exportable JSON from the results screen (verified as a real download headless); seed recorded for world reproduction.
- Verification: 187/187 tests (17 new events/telemetry gates); E2E `scripts/e2e-m8.mjs` green (event injected + toast caught on a clean drive; scripted-wreck run → results → download + "saved ✓"), 0 console errors.
- Docs: PLAN v1.5, PILLs 081–085.

### Session 11 (2026-09-23, M9) — comfort & polish
- **Options overlay** (O key / Esc / ⚙ button): steering sensitivity 0.5–1.5 (curve-exponent warp, full lock preserved), one-handed mode, volume, camera shake, speed lines, reduced motion (auto/on/off), PiP corner + size 0.6–1.5, quality preset, recalibrate hands, export/import/reset save data. DOM panel, ≥44 px rows, gear button, opens over garage/results/drive.
- **One-handed mode** (PILL 086): single hand drives — fist = throttle, open palm = brake after the regrip window; wrist displacement steers the same virtual wheel with the same sign rule (missing hand parked on its anchor, ×2 displacement). Single visible hand = TRACKING with full confidence. AR banner speaks the one-handed contract ('FIST — FULL THROTTLE', 'OPEN PALM — BRAKING', 'SHOW A HAND').
- **Accessibility/comfort (ADR-011):** `prefers-reduced-motion` resolved once and respected everywhere — camera shake off, speed-line streaks off, FOV speed-span capped at ~6°, CSS toast/glow animations disabled; user toggles AND with the reduction, never around it. Settings additive on schema 2 (pre-M9 saves migrate free, tested).
- **Pause:** options pauses the sim (step skipped, render alive) during a run; recalibrate runs the wizard mid-run and resumes; wizard is modal over the O key.
- **Latency readout:** audio output latency (base+output from AudioContext) + hand-tracker latency/delegate, live while the panel is open.
- **Verification:** 210/210 tests (23 new: one-handed drive/steer-sign/brake/regrip/lost, sensitivity separation + full-lock, banner one-handed, comfort resolution, settings migration); build green; E2E `scripts/e2e-m9.mjs` green — options open/pause-freeze/persist nine settings/live PiP layout/quality pin 'pinned low'/reopen-synced/export download/two-click reset, plus a `?pipdemo=1` leg proving one-handed drives the real pipeline (TRACKING + HANDS_LOST both observed over a full demo cycle), 0 console errors.
- Docs: PLAN v1.6, PILLs 086–090, ADR-011.

### Session 12 (2026-09-23, M10) — ship prep: v1.0.0
- **Deployment:** GitHub Pages enabled (workflow build type) at https://aliomarabdelhady.github.io/velocifist/ — CI workflow (typecheck + 210 tests + build) and deploy workflow (`--base=/velocifist/` → upload-pages-artifact → deploy-pages) push on every main commit. Private repo, public site (Pages semantics — disable in Settings→Pages if unwanted).
- **PWA:** manifest + headless-rendered icon set + runtime cache-first service worker with first-visit priming (PILL 091). Offline-after-first-visit verified headless INCLUDING the 20 MB camera wasm+model. Installable (fullscreen, landscape, maskable icon).
- **Budgets:** vendor chunk split (entry 653 KB → 148 KB app + 505 KB three, ~180 KB gzip initial); ship gates measured on the production build: load 83 ms, boot→driving 2.4 s (gates ≤ 3 s / ≤ 15 s).
- **README replaced** (the M0 one still advertised the retired five-minute death rule): pitch, controls table incl. one-handed, quickstart, E2E script map, dev backdoors, architecture map, deployment + PWA notes, credits (MIT code; Three.js MIT; MediaPipe Apache-2.0; zero third-party art/audio per ADR-009).
- **Verification:** 210/210 tests; build green; E2E `scripts/e2e-m10.mjs` green (budgets, manifest, SW activated+controlling, primed cache, wasm+model cached, offline reload boots, Pages-base build serves + drives under /velocifist/, 0 console errors).
- Docs: PLAN v1.7, PILLs 091–093; version 1.0.0.

### Session 13 (2026-09-23, M11) — cruise traffic (user post-1.0 feedback)
- **Constant-gas cruise (ADR-012):** cars cap at 80/80/75 km/h via `vCruise` soft limiter; gears/downforce/audio/FOV normalize over the cap; held gas = dead-steady plateau in 7th (E2E: 79 km/h flat for 10+ s, never past 80).
- **Traffic from second zero:** corridor warmup through the normal fairness rules; 12 cars active within the first second (E2E); spawn window 110–300 m; base density 8.
- **Regime rescale:** traffic families 30–60 km/h, event speeds ~½ with nearer placement, near-miss floor 11.1→3 m/s, passive-score floor 35 km/h, speed lines from ~43 km/h.
- **Fairness fixes the regime exposed:** direction-aware beside-blocking + matchable-neighbour rule in `hasEscape`; soak bot keeps a following envelope.
- **Verification:** 210/210 tests (validation targets re-measured for the regime: 0→75 km/h, cruise→0 braking, near-cruise slalom); E2E m6/m7/m8/m9 all green under the new speeds + new `e2e-m11.mjs` (traffic at t≈1 s, plateau, coast decay), 0 console errors; build green.
- Docs: ADR-012, PILLs 095–097, PLAN v1.8.

### Session 14 (2026-09-23, M12) — real controllers & handling contract (ADR-013)
- **Phone remote:** `scripts/remote-relay.mjs` (LAN WebSocket relay; `--serve` hosts game + phone page). Phone gets a draggable steering wheel, hold pedals, crash vibration, latency display; input decays if the phone goes silent. E2E drives the real game through the real relay (67 km/h, steering, reverse gear R).
- **PS4 DualShock 4:** standard Gamepad API mapping (cubic stick, deadzone, analog triggers), hot-plug, merges with keyboard/phone (last-touched wins).
- **Handling:** grip governor — steering range speed-scaled to the ~2 g tire envelope; oversteer/understeer/spins impossible by construction (abuse tests: |β| < 7°, yaw bounded, g capped yet 1.5+ g usable, ~31 m turn radius at cruise). steerFadeSpeed retired.
- **Reverse** (brake at standstill, ~20 km/h cap, R on the HUD; brake-force cancellation bug caught by tests). **Driver aid** light/full/off (light default). **Camera** constant close chase, 55°+9° FOV.
- **Fairness soak:** envelopes re-anchored to 1.6 g braking + speed-proportional margins; 60-min soak back to 0 violations.
- **Verification:** 226/226 tests (16 new controls/ADR-013 gates); build green; e2e m11/m6 regressions green; relay --serve smoke (game+phone pages, LAN IP); 0 console errors.
- Docs: ADR-013, PILLs 098–101, README controllers section.

### Session 15 (2026-09-23, M13) — zero assistance, lateral freedom, 120 km/h (ADR-014)
- Lane centre-pull deleted — lateral position is fully the player's (road-heading alignment only); freedom test replaces the old lane-keep gate.
- Driver aid defaults OFF; settings schema 3 migrates existing 'light' saves.
- Cruise cap 120 km/h (Bruto 112); traffic 46–89 km/h, events ×1.5 with farther placement, streaks from ~70 km/h, brake/radius targets re-measured (39/38/33 m; 51–73 m ≈ 2 g).
- Verification: 226/226 tests; build green; e2e m11 (119 km/h flat plateau, gear 7, coast releases), m12 (phone remote + reverse), m6 all green; 0 console errors.
- Docs: ADR-014, PILLs 102–104, PLAN v2.0.

### Session 16 (2026-09-23, M14) — 150 km/h, rival traffic, escalating density (ADR-015)
- Cap 150/150/140 km/h; traffic 58–111 km/h; events ×1.25 placed 340–460 m; streaks from ~85 km/h; brake targets 61/60/51 m.
- Rival AI: drift-reading block cuts (1 s blinker warning, lane-gap checks, ≤2 concurrent, cooldown), defensive pacing under shadowing; scripted event cars excluded. E2E visibly shows the effect (plateau dips to 143 while passing).
- Density escalates: 8→10 over 4 min, then +1/min forever, ceiling 24 (agent pool).
- Verification: 229/229 tests (3 rival gates + escalation curve); soak 0 violations WITH rivals; build green; e2e m6/m11/m12 green; 0 console errors.
- Docs: ADR-015, PILLs 105–107, PLAN v2.1.

### Session 17 (2026-09-23, M17) — 200 km/h, meaner rivals, readability (ADR-016)
- Cruise cap 200/200/187 km/h; traffic families ×4/3 (77–149 km/h), spawn window 170–460 m, pool 56; events ×1.33 placed 460–640 m; speed lines from ~115 km/h; brake targets re-measured (108/108/92 m from 196 km/h); turn-radius bound 210 m (measured 199).
- Meaner traffic: rivals 45% of eligible cars, cooldown 3–6 s, ≤3 concurrent cuts, defensive pacing ×1.30, band 110 m; density 8→11 over 3 min then +1/45 s, ceiling 26.
- Readability: brighter/wider lane markings with long dashes, delineator reflector posts every 24 m, road draw 760→920 m, camera far 1300, fog pushed out (+100–140 m far per theme), neon asphalt/rails brighter.
- Car realism: clearcoat paint (MeshPhysicalMaterial), front splitter, rear-deck vents, side blades, 10-spoke rims.
- Verification: 238/238 tests (gates re-derived: plateau −1.8, g ≤ 2.6, radius ≤ 210, density curve); build green; e2e m6/m11/m12 green — plateau 196 km/h @ gear 7, 77% hold, coast 196→188; 0 console errors.
- Docs: ADR-016, PILLs 110–112, PLAN v3.0.

### Session 18 (2026-09-23, M18) — RobEn rebrand: ROBEN VELOCIFIST (ADR-017)
- Mark recreated as hand-built SVG from a vision-extracted recipe (robot head, navy→azure tile): favicon roben.svg, PWA icons regenerated, manifest renamed (ROBEN / ROBEN VELOCIFIST, theme #19699D), SW cache bumped to roben-v1.
- UI accents orange → RobEn azure #2f9ce0 (buttons/h1s/selection), flow/streak cyan → teal #20c997, bars azure→teal gradients; overlay now shows the logo tile + mixed-case "RobEn Velocifist" + "BY ROBEN CLUB · ROBEN.CLUB · DESIGN YOUR FUTURE"; README rebranded.
- Livery: azure paints per archetype (0x1a76b8/0x19699d/0x0e4f7e), hood robot-head roundel, rear-deck wordmark, and a rear-fascia "RobEn" panel the chase cam actually reads.
- Visual QA loop (subagent passes): caught the invisible deck wordmark (moved to rear fascia), weak dusk marking contrast (asphalt #5e5e5e + tints ~0xb2aaa4 → CLEAR readability), uppercase title hiding the "RobEn" casing.
- Verification: 238/238 tests, build green, deterministic crop review passed (wordmark readable, markings CLEAR, 7-8 posts with amber reflectors).
- Docs: ADR-017, PILLs 113–115.

### Session 19 (2026-09-23, M19) — versus multiplayer: invite-code 1v1 ghost race (ADR-018)
- Transport: PeerJS WebRTC DataChannel (lazy chunk — solo payload untouched); free PeerJS cloud brokers the handshake; local `?broker=` override for e2e.
- Match codes: 5 chars from an unambiguous alphabet; host claims `roben-race-<CODE>`, guest joins by code; host auto-starts on connect (hello → start with seed + target + 3.2 s countdown).
- Race model: identical-seed worlds, 15 Hz road-frame pose stream (rebase-proof), translucent ghost opponent (no collision), live gap/position/ping HUD chip, first to 5 km wins, wreck = instant loss, disconnect = opponent wins; VICTORY/DEFEAT results with margin, host-authoritative rematch (reseed), leave (✕ during race, button on results).
- Verification: 12 new unit tests (codes/protocol/state machine) — 250/253 total; build green; **e2e-m19: two real browser pages race a full match against a local PeerServer — code matchmake, synced countdowns, chip `1st · +2 m · 535 ms`, VICTORY/DEFEAT, rematch, leave→disconnect win, 0 console errors**.
- Docs: ADR-018, PILLs 116–119, README versus section.

### Session 20 (2026-09-23, M19 hotfix) — versus would not connect between networks
- Field report: both sides reached the matchmaker but the DataChannel never formed (guest hung at "dialing the host…"). Root cause: STUN-only ICE cannot traverse CGNAT/symmetric NAT pairs (phone cellular vs laptop WiFi).
- Fixes: TURN relays added (free OpenRelay + Google/Twilio STUN, iceCandidatePoolSize 4); 20 s dial timeout that fails with an actionable message instead of hanging; every peer error now fails loudly (failOut kills the link + tells the user) and logs `[versus] peer error: <type>` to the console; create/join retry works after a dead session (was silently blocked); host gets a "still waiting — keep this tab in the foreground" hint after 45 s; results overlays scroll on short screens.
- Verification: 250/253 tests; build green; e2e-m19 full match green again (code → countdown → race → VICTORY/DEFEAT → rematch → disconnect win, 0 console errors) with hardened timeouts + cleanup.
- Docs: PILLs 120–121.

### Session 21 (2026-09-23, M19b) — versus rides public MQTT relays (works on ANY two networks)
- User directive: versus must NOT require same WiFi. Diagnosed: OpenRelay TURN credentials allocate zero relay candidates (relay-only ICE probe) — the previous hotfix was inert; STUN-only WebRTC cannot cross CGNAT pairs.
- Transport replaced: MQTT-over-WSS via public anonymous brokers (emqx + hivemq fallback), mqtt.js lazy chunk (~340 kB, solo payload untouched); peerjs/peer deps removed. Topics per match code; hello repeat (1 Hz) until start; LWT bye; 20 s join timeout ("no match with that code"); ping/pong at 1 Hz.
- Verification: 250/253 tests; build green; **e2e-m19 now runs the full two-browser match through the REAL public relay** (code → countdown → race → VICTORY/DEFEAT → rematch → disconnect win, 0 console errors).
- Docs: ADR-018 amendment, PILL 122, README, SW cache roben-v3.
