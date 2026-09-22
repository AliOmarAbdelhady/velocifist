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
