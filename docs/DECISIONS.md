# DECISIONS.md — Architecture Decision Records

> ADRs are never deleted. Superseded ones get a `**Superseded by ADR-0xx**` line.
> Format: Context → Decision → Alternatives considered → Consequences.

---

## ADR-001 — Engine: pure web app (TypeScript + Three.js + WebGL2), not Godot/Unity/Unreal native

**Date:** 2026-09-22 · **Status:** Accepted

**Context:** Must run on the dev laptop (i5-1135G7 / Iris Xe), zero friction, with real-time webcam hand tracking in the same frame budget as rendering.

**Decision:** Browser app. Three.js (WebGL2) renderer; MediaPipe Tasks Vision JS (GPU delegate) in a Web Worker — single process, officially supported path for GPU hand inference.

**Alternatives:**
- *Godot 4 native + Python MediaPipe sidecar over UDP* (Codex plan's choice): rejected — two-process fragility (lifecycle, protocol, stale packets, distribution burden: Python or sidecar binary on every player machine); MediaPipe's Python GPU delegate on Linux is poorly supported → likely CPU inference competing with the game on a 4-core i5. Its renderer advantage evaporates when the Compatibility (GL) fallback engages on this machine.
- *Unity WebGL:* poor webcam/worker story in-browser; heavy builds.
- *Unreal:* heavy install; pixel-streaming needs servers.
- *Babylon.js:* fine library, but ~1.4 MB bundle vs Three's ~168 kB and its main advantage (built-in Havok) is moot since we use no physics engine (ADR-002).

**Consequences:** zero-install distribution; offline-capable after first load; hands never leave the device; rendering ceiling is WebGL2 — acceptable for this genre with the budgets in PLAN §16.

## ADR-002 — Physics: custom deterministic arcade model, no physics engine

**Date:** 2026-09-22 · **Status:** Accepted

**Context:** NFS-like feel, fair leaderboards, CI-testability, iGPU perf.

**Decision:** Authored planar bicycle model + simplified Pacejka + grip circle, fixed 60 Hz, analytic OBB (swept) collision. No Rapier/Cannon/Godot rigid bodies.

**Consequences:** cannot flip/fall through world; bit-deterministic (state-hash CI test); microseconds/frame; full feel control. Cost: we own all vehicle math and must hit the §6.3 validation numbers ourselves.

## ADR-003 — Cars: original "archetype" supercars, not licensed real brands

**Date:** 2026-09-22 · **Status:** Accepted

**Context:** User asked for "real supercars". Shipping branded real cars requires manufacturer licenses (shape, badges, sound, marketing, crash-damage clauses) — a business deal that blocks a solo release (Codex plan made it a release dependency and estimated licensing could dominate a 9–18 month schedule).

**Decision:** Three original designs with real physics personalities (Falcone GT / Vipera RS / Bruto Widebody). Never market unlicensed branded cars.

**Consequences:** ships on schedule; silhouettes/archetypes stay recognizable. If genuine branding becomes a requirement later, it's a separate licensing/business track (future ADR).

## ADR-004 — Process: milestone-gated sessions + in-repo memory system

**Date:** 2026-09-22 · **Status:** Accepted

**Decision:** User says "continue" → next milestone. `docs/{PLAN,MEMORY,PROGRESS,DECISIONS}.md` updated on every change (project law, PLAN §22). Spec-Kit/SDD artifacts are deliberately not used: PLAN.md already serves as spec+plan and the user chose this cadence explicitly.

## ADR-005 — Name: VELOCIFIST

**Date:** 2026-09-22 · **Status:** Accepted

Velocity + fist — encodes the signature mechanic. Repo `velocifist`, private. Rename is cheap while pre-release.

## ADR-006 — M0 scope: benchmark harness is a first-class deliverable

**Date:** 2026-09-22 · **Status:** Accepted (merged from Codex plan)

M0 ships the dev HUD (FPS/ms/draw calls/tris) + fixed-timestep loop with determinism hash tests. Measure before art; every later milestone cites its gate numbers.

## ADR-007 — M4 world: world-space curved spine + road-frame traffic mapping

**Date:** 2026-09-22 · **Status:** Accepted

**Decision:** The road is a seeded, chunk-streamed curved spine integrated in WORLD space (RK2 on heading κ(s), 256 m chunks, 4 m samples, gentle modules only: |Δθ| ≤ 0.26 rad/chunk ⇒ peak curvature ≥ ~740 m radius — always drivable at highway speed). The player's physics stays honest world-space (real steering through bends, real lateral g); traffic agents live in ROAD space — (s = arclength, lat = lateral, dir = ±1) — and are mapped onto the spine each tick for world-space swept collision and rendering. "Ahead" = larger s (smaller z). Oncoming agents (dir −1) close at pu + speed in every s-space rule, which makes oncoming lanes naturally lethal and never a fair escape. Floating origin: pure +4096 m z-translation whenever raw z < −4096 (exact, deterministic; keeps float32 render precision on 20 km runs).

**Alternatives rejected:** (a) road-frame player physics with injected centrifugal force — a full rewrite of every validated M1 gate for no player-facing gain; (b) visually-fake curves — dishonest, breaks traffic coherence; (c) clothoid segments — analytic inversion cost with no perceptible benefit at R ≥ 700 m.

**Consequences:** cumulative heading self-centres (bias past ±0.5 rad) so z stays monotone — the projection's −z heuristics rely on it; features (modules/zones) chain hEnd so chunkFeature(i) is a pure function of (seed, i) — the renderer can query ahead of the sim without changing the world (PILL 049). Car takes an optional `guide` (null = straight road) for off-road/wall in the road frame; all M1 tests run guide-free unchanged.

## ADR-008 — Easy-first design: assists always on, death pacing retired

**Date:** 2026-09-22 · **Status:** Accepted (user directive: "very easy to play, forget about the 5 mins rule")

**Decision:** VELOCIFIST is an easy, relaxed arcade cruiser. (a) Driving assists ship always-on: lane-keep assist (road-heading + lane-centre pull, full strength with quiet hands, 35% when steering deliberately), stronger yaw/slide damping, earlier counter-steer, forgiving guardrail grazes and grass. (b) The 4–6-minute elite death target is removed: density ramps 6.5→9 veh/km/lane over 4 min then flattens, oncoming zones are rarer (p .35), construction sparse. (c) Health/wreck still exists — mistakes still end runs — but FLOW regen (0.5 HP/s to 35% cap) and 0.8 s impact-window merging make survival the default. Risk stays opt-in via the near-miss scoring model (unchanged): thrill is how close YOU choose to shave.

**Consequences:** PLAN v1.2 (pillar 4, §11.2, roadmap M7/M8 reworded). Raw-dynamics tests run with `laneAssist = false`; assist behaviour has its own gates (sloppy-driver centring). Scoring/balance numbers remain hypotheses for M8 comfort tuning rather than survival tuning.

## ADR-009 — M6 art & audio: fully procedural, asset pipeline deferred

**Date:** 2026-09-22 · **Status:** accepted

**Context.** PLAN §12/§13 sketched a CC0-asset pipeline (Kenney/Quaternius bases → Blender → glTF+Draco+KTX2) for hero cars, and left a decision point on engine-audio synthesis vs sampled loops.

**Decision.** Ship M6 with 100% procedural content:
- Hero cars are code-built extruded-profile meshes (~2–4 k tris each) with material merging — no external assets, no pipeline tooling, instant load, trivially recolorable/re-shapable per archetype.
- Audio is 100% WebAudio synthesis (ignition-pulse engine model, layered one-shots, beds). Zero audio files.

**Why.** The asset pipeline adds toolchain risk and licensing surface for marginal gain at our poly/lighting budget (the look comes from lighting/grading/motion — PLAN's own "AAA-adjacent" thesis). Synthesis gives infinite RPM resolution and per-car character for free. Both fallback paths stay open and cheap to add later (a glTF hero drop-in replaces CarView.build; a CC0 engine loop replaces the engine voice only — the rest of the graph is independent).

**Consequences.** Audio quality judgement needs human ears — user playtest decides if the synthesis holds; if not, only the engine layer is swapped (PLAN decision point resolved as: implemented procedural, fallback documented). Audio latency measured live in the dev HUD (34–51 ms observed in software-GL headless; the <30 ms gate applies to real hardware).

## ADR-010 — Input robustness: hold-not-cut + driver aids (M7 hands pass)

**Date:** 2026-09-23 · **Status:** accepted

**Context.** User feedback: "detecting the hand is not very good", "make the game very easy". Diagnosis: detection dropouts were amplified by the INPUT CONTRACT — the arbiter hard-cut intent below 0.5 confidence, so single-frame flickers zeroed the throttle and the solver's careful degradation never reached the car.

**Decision.**
1. **Hold-not-cut contract:** hand intent survives confidence dropouts (EMA + hysteresis + 0.8 s hold window; one-hand-flicker holds throttle indefinitely while the remaining hand grips). The car calmly holds instead of lurching.
2. **Detection quality:** stickier MediaPipe thresholds + larger inference frames on GPU (480×360); camera requested at 960×720.
3. **Driver aid:** forward-collision auto-brake assist (TTC-based, capped 0.7, relieved by deliberate evasion, player's own braking always wins) — an extension of ADR-008 easy-first: the game actively protects an unsupported player, and opting into risk (weaving toward cars) is still rewarded by the scoring systems.

**Consequences.** Crashes now require sustained indifference rather than a moment's lost tracking. Near-miss scoring is unaffected (assist never steers and yields to evasion). The assist is a scored UX surface (AUTO-BRAKE chip + dev-HUD level), and it is NOT in the deterministic sim path — it lives in main's intent blend, keeping the sim's state-hash tests stable.

## ADR-011 — Comfort & accessibility contract (M9)

**Date:** 2026-09-23 · **Status:** accepted

**Context.** PLAN §15 demands a complete options surface (sensitivity, one-handed mode, shake, latency readout, PiP pos/size, recalibrate, data export/import/reset; ≥44 px targets; `prefers-reduced-motion` respected). Motion-comfort toggles and OS-level reduction must compose predictably, and one-handed play must not be a separate input stack.

**Decision.**
1. **Comfort is AND-semantics:** every motion effect = user toggle ∧ ¬resolvedReducedMotion. The OS query (`prefers-reduced-motion: reduce`) is the ceiling; the user setting is 'auto' (follow OS) / 'on' / 'off'. A user toggling shake ON cannot override a reduced-motion resolution — but CAN explicitly resolve reduction 'off' (informed choice). Applies to: camera micro-shake, speed-line streaks, FOV speed-span (capped ≈6° under reduction), CSS toast/glow animations.
2. **One-handed mode is the same wheel, not a new stack:** the missing hand is parked on its calibration anchor; the visible hand's displacement is doubled to match two-hand counter-rotation. Identical magnitude gate, zone gate, slew, deadzone and SIGN RULE; calibration still uses both hands. Contract: visible fist = throttle, open palm = brake after the regrip window, single visible hand = TRACKING at full confidence.
3. **Sensitivity warps the response exponent** (`pow(a, curveExp/gain)`, gain 0.5–1.5): full lock stays reachable at every gain — comfort tuning changes how SOON authority arrives, never the car's maximum capability.
4. **Options pauses the run** (sim step skipped, render alive) — changing feel settings mid-run must not crash the car; recalibrate replays the wizard from the same parked state.

**Consequences.** Settings are additive on persistence schema 2 (old saves migrate by default-merge — tested). The options panel is the single mutation surface; main.ts fans changes out to audio/tracker/pip/quality/comfort via one callback. E2E proves pause-freeze, persistence, live application and reset; unit tests pin the one-handed sign rule, regrip protection and sensitivity separation.

## ADR-012 — Cruise traffic regime (old-arcade constant gas)

**Date:** 2026-09-23 · **Status:** accepted

**Context.** User feedback after v1.0.0: (1) traffic should be present from the first seconds, not appear "after a while"; (2) the car should not accelerate forever — hold gas at a constant ~70–80 km/h cruise "like the old games", always on full throttle, never needing to brake.

**Decision.**
1. **`vCruise` per car** (80 km/h Falcone/Vipera, 75 Bruto): a second soft limiter that zeroes drive force at the cap. `vMax` remains physics headroom only. Gears spread across `vCruise` (80 km/h = top of 7th, high rpm — the "singing engine" arcade feel); downforce normalizes over `vCruise` (full stick at cruise).
2. **Whole speed regime rescaled:** traffic families 8.5–16.5 m/s (30–60 km/h) so the player always overtakes at a weave-able 4–10 m/s; event injectors ~½ speed and placed 160–240 m ahead; near-miss closing floor 11.1→3 m/s; whoosh/fast-pass thresholds rescaled; speed lines visible from ~43 km/h; passive score floor 80→35 km/h (cruising always scores).
3. **Traffic from frame one:** `TrafficSystem.warmup()` pre-populates the corridor around the player through the normal fairness-checked spawn rules (near-min 40 m); steady spawn window tightened to 110–300 m; base density 6.5→8 veh/km/lane.

**Consequences.** Closing speeds are small, which exposed two real `hasEscape` semantics bugs: a barely-slower neighbour (≤1.5 m/s) is matchable within a second and must not count as a wall, and an agent BEHIND that the player outruns can never block a lane — both fixed (direction-aware). The soak bot now keeps a survivable following envelope (the invariant's own premise: an escape exists for a player who keeps one). Validation targets are cruise-regime (`targetCruise` 0→75 km/h s, `targetBrake` cruise→0 m, slalom near cruise). Old saves unaffected (no settings change).

## ADR-013 — Real controllers & the handling contract

**Date:** 2026-09-23 · **Status:** accepted

**Context.** User feedback after the cruise pass: the AR camera isn't the preferred way to play "for real" — a phone should be a physical remote, and a PS4 pad should work; the auto-brake assistance is too strong; the car must NEVER oversteer, understeer, or rotate around itself ("super super car… sticking to the ground, very fast in maneuvering"); reverse is missing; and the chase camera pulls too far away under acceleration.

**Decision.**
1. **Phone remote:** a zero-dependency-for-the-phone local relay (`scripts/remote-relay.mjs`, `--serve` also hosts the game). Phone page = drag steering wheel + hold pedals + crash vibration over LAN WebSocket. Input decays to zero if the phone goes quiet — a controller can never stick on. All manual sources (keyboard, pad, phone) merge by most-recent activity; hands still arbitrate against the merged manual intent.
2. **PS4 pad:** standard Gamepad API mapping (deadzone 0.12, cubic stick, analog triggers preferred, button fallback), hot-plug.
3. **Handling contract — grip governor:** steering range is speed-scaled so lateral demand (v²·tanδ/L) never exceeds the tire envelope (~2 g supercar-glue tires, grip-circle aware). Slides/oversteer/understeer are impossible by construction, not damped after the fact. Fairness soak envelopes re-anchored to 1.6 g braking with speed-proportional reaction margins.
4. **Reverse:** brake held at standstill latches reverse (capped ~20 km/h); brake input becomes the reverse throttle (service brakes would cancel it); throttle always recovers forward. Gear 0 renders as R.
5. **Driver aid levels:** light (new default — fires ≤1.15 s TTC, caps at 0.35) / full (M7 feel) / off. User-selectable in options.
6. **Camera:** constant chase mount (6.0 m back, no speed pull-back), near-constant FOV (55°+9°) — the car stays the same apparent size at every speed.

**Consequences.** The M7 "very easy" assist default is superseded (still selectable). Validation targets re-measured for 2 g tires (brake 75→0 ≈ 17 m, cornering 1.5–2.3 g at full lock, ~31 m turn radius at cruise). The soak bot now mirrors the 1.6 g envelope.
