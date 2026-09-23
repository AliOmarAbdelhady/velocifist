# VELOCIFIST — Master Production Plan (v1.1, merged)

**Project:** VELOCIFIST — hand-tracked traffic-weaving racer (webcam + browser)
**Repo:** private GitHub `velocifist`
**Plan version:** 1.1 — merger of the ZCode "OVERDRIVE AR" master plan v1.0 with the Codex "Traffic Weave" production plan (2026-09-22), taking the strongest parts of each.
**Date:** 2026-09-22
**Status:** Active canonical plan. Implementation started (M0). Update this file when design changes.

---

## Changelog

- **v2.1 (M14 delivered, ADR-015):** 150 km/h + rival traffic + escalation — cruise cap 150 (Bruto 140) with the pyramid rescaled (traffic 58–111 km/h, events ×1.25 farther out); ~30% of same-direction cars are RIVALS that read your lateral drift, blink, and cut across to block your pass (lane-gap-checked, max 2 concurrent cuts, cooldown, fairness soak still 0 violations with rivals armed) and pace up when you shadow them; density now escalates forever — warm-up 8→10 over 4 min, then +1 veh/km/lane per minute to the pool ceiling of 24.
- **v2.0 (M13 delivered, ADR-014):** Zero assistance & lateral freedom at 120 km/h — the lane centre-pull is deleted (the car stays wherever you put it; only road-heading alignment remains), the forward-collision aid defaults to OFF (schema-3 migration), and the cruise cap rises to 120 km/h with the speed pyramid rescaled (traffic 46–89 km/h, events ×1.5 and placed farther, streaks from ~70 km/h, targets re-measured). Driving is now fully manual by default; the no-slip grip governor stays as the car's character.
- **v1.9 (M12 delivered, ADR-013):** Real controllers & handling contract — phone-as-remote (local WebSocket relay + on-phone steering wheel/pedals with vibration), PS4 DualShock 4 support, a grip governor that makes oversteer/understeer/spins impossible by construction (~2 g supercar-glue, ~31 m turns at cruise), arcade reverse gear (R), driver-aid levels (light default / full / off — the M7 strong default is superseded but selectable), and a constant close chase camera (no speed pull-back, near-constant FOV). All controller sources merge by last activity.
- **v1.8 (M11 delivered, ADR-012 — user post-1.0 feedback):** Cruise traffic regime — cars cap at 80/80/75 km/h (`vCruise` soft limiter; full gas is a dead-steady constant cruise "like the old games", gears sing at top of 7th), the whole speed pyramid rescaled to match (traffic 30–60 km/h, events ~½ speed and nearer, near-miss floor 3 m/s, passive score from 35 km/h, speed lines from ~43 km/h), and the road is populated from the first frame (fairness-checked corridor warmup — 12 cars within second one, verified live). Low-speed fairness semantics fixed (matchable neighbours and agents behind no longer wall lanes).
- **v1.7 (M10 delivered — v1.0.0):** Ship prep complete — GitHub Pages deployment enabled (workflow builds with `--base=/velocifist/`, CI runs typecheck + tests + build on every push), installable PWA (manifest + icon set + runtime cache-first service worker with first-visit priming — offline works after one visit, including the camera wasm+model), vendor chunk split (initial JS ~180 KB gzip; load 83 ms, boot→driving 2.4 s against the ≤3 s / ≤15 s gates), README rewritten as the front door (controls, quickstart, E2E map, architecture, privacy, credits). The production loop is closed end to end: push to main → CI → live site.
- **v1.6 (M9 delivered, ADR-011):** Comfort & polish shipped — the options overlay (O key / ⚙): steering sensitivity (curve-exponent warp, full lock preserved at every gain), one-handed mode (fist = throttle, open palm = brake, wrist steers the same virtual wheel with the same sign rule), volume + audio/hand latency readouts, camera-shake / speed-line toggles, reduced-motion setting (auto/on/off, AND-ed with the OS query — never around it: shake, streaks, FOV speed-span and CSS animations all yield), PiP corner + size, quality preset, recalibrate, and save export/import/reset. Options pauses a live run (sim frozen, render alive); settings are additive on schema 2 so existing saves migrate free.
- **v1.5 (M8 delivered):** Variety & events shipped — six deterministic set-piece injectors (CONVOY / ROADBLOCK / ROAD_TRAIN / RUBBERNECK / CUTTER / WEAVER) placed through a fairness-checked public spawn API with full batch rollback, announced by readable toasts, paused by the mercy rule; plus run telemetry (1 Hz vitals + audit block) exported as JSON from the results screen (seed included for world reproduction).
- **v1.4 (M7 re-scope, user directives "better hand detection / very easy / enhanced AR", ADR-010):** M7 became the hands & AR pass instead of variety & events (that moves to M8). Input contract is now hold-not-cut (arbiter hysteresis, PARTIAL hold, 0.9 s lost-grace), tracking is stickier (lower thresholds, 480×360 GPU inference), a forward-collision auto-brake assist protects unsupported players (capped, evasion-relieved), damage/curve/wall/lane-keep all softened further, and the PiP is a full AR dashboard (skeletons + grip arcs + trails, rocker wheel, gesture banner, status ring + screen-edge glow). `?pipdemo=1` demonstrates everything without a camera.
- **v1.3 (M6 delivered, ADR-009):** Art & audio shipped fully procedural — code-built hero-car meshes (extruded profiles + damage states), pooled GPU particle FX + camera-space speed lines, one-quad final grade pass (tint/sat/vignette/speed-CA, off on Low), theme-matched PMREM env maps, quality presets + EMA auto-scaler (`settings.quality: 'auto' | low | medium | high`, default auto, Q cycles), 100% procedural WebAudio (engine/beds/one-shots, master compressor). CC0 asset pipeline and sampled-engine fallback remain documented options, not commitments.
- **v1.2 (easy-first, user directive):** Design pillar 4 replaced — the 4–6-minute elite death target is RETIRED. The game is easy to play and easy to survive: driving assists always on (lane-keep + stronger stability), relaxed traffic density (6.5→9 veh/km/lane over 4 min, flat after), softer guardrail/grass consequences, rarer oncoming zones. Risk remains opt-in via near-miss scoring (ADR-008).
- **v1.1 (merge):** Kept the browser architecture (Three.js + MediaPipe in-process), deterministic authored vehicle physics, archetype cars, game-feel machinery. Merged in from the Codex plan: AR terminology clarification; regrip-aware grip state machine (one open palm = regrip, second = brake, false-braking < 1% target); tester-diverse acceptance protocol (skin tones / sleeves / lighting); 95th-percentile latency & angle-error targets; score anti-exploit suite; swept body-to-body near-miss clearance; leaderboard partitioning + Practice mode; atomic saves; tunneling math & swept CCD requirement; vehicle-dynamics validation protocol (0–100, 100–0, slalom, yaw overshoot); benchmark-before-art discipline; realistic 3–6 month calendar estimate; drivetrain-personality car classes; IDM/MOBIL as formal traffic-model references.
- **v1.0:** Original architecture and full system specs.

---

## 1. Executive Summary

**The game:** A third-person (chase camera, GTA/NFS-style) arcade traffic-weaving racer controlled with your **real hands in front of a webcam**. Grab an invisible steering wheel with both fists → the supercar accelerates to its limit. Open both hands → it brakes. Turn the invisible wheel — including crossing your right hand over your left for full lock, like a real car → the car steers precisely. Weave through dense highway traffic at 250+ km/h; the closer and faster you pass cars, the more you score (near-miss combo system — the proven Traffic Rider / Burnout reward loop). Crashes damage the car until it is destroyed and the run ends. Multiple environments, multiple supercars, persistent scores.

**Terminology (locked):** This is **camera-based gesture control of a full-screen 3D game**, not world-anchored augmented reality (no device tracking / surface estimation / lighting estimation from a fixed laptop webcam). We call it "hand-tracked AR" informally; docs and marketing must not promise world-anchored AR. A future tabletop AR mode (cars composited into the live camera view) would be a separate project.

**Architecture in one paragraph:** A **pure web application** — zero install, runs in Chrome/Edge on a laptop. **MediaPipe Hand Landmarker** (WASM+GPU delegate) reads both hands from the webcam at ~30 Hz inside a **Web Worker**. A gesture layer converts landmarks into virtual steering-wheel angle and throttle/brake with **One Euro filtering**, hysteresis, and our own hand-identity tracker that survives hands crossing. The game is built on **Three.js (WebGL2)** with a **custom deterministic arcade vehicle model** (bicycle model + simplified Pacejka + grip circle, fixed 60 Hz timestep) — deliberately no general-purpose physics engine, because arcade feel, determinism, integrated-GPU performance, and tunability demand hand-authored math. Traffic is kinematic (IDM/MOBIL-inspired), pooled, instanced. The world streams in seeded procedural chunks. Score/health/difficulty run in a pure simulation layer fully decoupled from rendering.

**Requirement → solution map**

| Requirement | Solution |
|---|---|
| AR driving with real hands | MediaPipe 2×21 landmarks; virtual wheel + fist/open gesture model; crossing-safe hand identity; One Euro filtering |
| GTA/NFS camera | Spring-arm chase cam: low base FOV + speed-widening, lag, shake (NFS recipe) |
| Real-feel physics | Authored bicycle model: slip, grip circle, weight transfer, drift; deterministic fixed timestep; validation protocol (0–100, 100–0, slalom, yaw overshoot) |
| Speed + near-miss scoring, saved | Passive speed score + tiered near-miss bonuses (swept body-to-body clearance) + combo multiplier; versioned atomic localStorage saves |
| Car health, crash → destroyed → lose | Impulse-based damage, 4 visual states, wreck finale |
| Non-repetitive environments | 3 themes × time-of-day/weather × seeded chunks × event director |
| Easy, relaxed survival (v1.2) | Always-on assists + flat-capped difficulty; former 4–6 min death target retired (ADR-008) |
| Multiple supercars | 3 archetype cars (lightweight RWD / AWD GT / track-focus widebody) with distinct physics personalities |
| Laptop performance | Hard budgets (≤250 draw calls Low, instancing, zero-GC frame, quality auto-scaler), benchmark harness from M0 |
| "High graphics" look | PBR-lite + graded environment lighting + speed language + one LUT final pass — not heavy post chains |

---

## 2. Design Pillars

1. **Hands are the interface.** Latency < 100 ms p95 end-to-end is a hard requirement; measure and display it.
2. **Risk = reward.** Score scales with speed and proximity; safe driving is possible but boring.
3. **Readable chaos.** Traffic is dense but fair: a solvable line always exists; deaths are the player's mistake, never the tracker's.
4. **Easy to play, easy to survive (v1.2).** Driving assists are always on and difficulty never escalates to kill. Runs end when the player wrecks by their own mistake or chooses to stop; 2–6-minute sessions remain the natural rhythm (arm fatigue), not a death clock. Risk = reward stays OPT-IN: thrill comes from shaving cars closer and faster, not from the game pressuring you.
5. **60 FPS on a normal laptop.** No frame ever waits on the webcam.

---

## 3. Technology Decisions (summary — full reasoning in DECISIONS.md)

| Layer | Choice | Key alternative rejected |
|---|---|---|
| Runtime | Web app (Chrome/Edge desktop) | Godot native + Python tracker over UDP (two-process fragility; Python GPU delegate weak on Linux → CPU inference competing with the game); Unity WebGL; Unreal |
| Language | TypeScript strict, Vite | — |
| Hand tracking | MediaPipe Tasks Vision `HandLandmarker`, GPU delegate, 2 hands, VIDEO mode, in a Web Worker | TF.js hand-pose (older gen); Python sidecar |
| Rendering | Three.js WebGL2 | Babylon.js (1.4 MB bundle; Havok advantage moot — no physics engine used) |
| Physics | Custom deterministic arcade model + analytic OBB collision | Rapier/Cannon rigid bodies (harder to tune, non-deterministic across engines, heavier) |
| Traffic model | Kinematic FSM, IDM-lite following + MOBIL-inspired lane changes | Physical AI |
| Audio | WebAudio, 100% procedural (engine physics model) | Sampled loops (fallback if synthesis quality insufficient — decision point in M6) |
| Persistence | localStorage, versioned, atomic writes + backup | IndexedDB (overkill) |
| Tests | Vitest (pure sim/gesture units) + scripted-landmark replay harness + seeded sim soaks | — |

---

## 4. High-Level Architecture

```
┌──────────────────────────── Browser (single page app) ─────────────────────────────┐
│                                                                                    │
│  [Web Worker: tracker.worker]          [Main thread]                                │
│   getUserMedia webcam (320×240)  →   ┌─────────────────────────────────────────┐  │
│   MediaPipe HandLandmarker (GPU)      │ GameCore (fixed 60 Hz sim)               │  │
│   → HandFrame {2×21 landmarks, ts}    │  ├ InputArbiter   (hands ⊕ keyboard)    │  │
│   postMessage (~30 Hz, transferable)  │  ├ GestureSolver  (grip, wheel angle)   │  │
│                                       │  ├ VehicleSim                          │  │
│ ┌───────────────────────────────┐     │  ├ TrafficSystem  (IDM/MOBIL, pooling)  │  │
│ │ Renderer (Three.js, rAF)      │     │  ├ WorldStreamer (chunks, seeded RNG)   │  │
│ │  scene/LOD/fog, instancing,   │ ◄── │  ├ CollisionSystem(swept OBB + hash)   │  │
│ │  chase camera, PiP + wheel    │interp│  ├ ScoringSystem (near-miss, combo)    │  │
│ │  FX (speed lines, particles)  │     │  ├ DamageSystem                        │  │
│ └───────────────────────────────┘     │  ├ DifficultyDirector + events          │  │
│                                       │  └ GameStateMachine                     │  │
│  [UI: DOM overlay — HUD, menus, calibration, results]                              │
│  [PersistenceService: atomic localStorage]   [AudioService: WebAudio graph]        │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Data flow (input → pixels, budget ≤ 100 ms p95):** camera frame (33 ms) → landmarks in worker (10–25 ms iGPU GPU delegate) → postMessage → GestureSolver (One Euro + hysteresis) → InputArbiter → VehicleSim 60 Hz → collisions/scoring/damage → interpolated transforms → render (16.7 ms).

**Game loop:** fixed-timestep accumulator + render interpolation ("Fix Your Timestep!", Fiedler). The tracker runs asynchronously at camera rate; gesture output is sampled by sim steps. Sim is deterministic (bit-stable): same inputs → same state hash (unit-tested every build).

**Subsystem contracts**

| System | Owns | I/O |
|---|---|---|
| InputAdapter/Arbiter | hands ⊕ keyboard ⊕ gamepad merge, confidence | `DriverIntent {steer[-1,1], throttle[0,1], brake[0,1], confidence, source, ts}` |
| HandCalibration | mirror check, hand identity, neutral wheel pose, ranges, thresholds | landmark stream → calibrated intent + status |
| VehicleSim | bicycle model, drivetrain, assists | Intent + surface + car tune → state |
| TrafficSystem | lane graph, NPC FSM, legal spawns, despawns | seed + road + player → nearby traffic |
| ScoringSystem | eligible passes, swept min clearance, combos, audits | world events → event log + score |
| DamageSystem | impulse → health, functional + visual states | contacts → damage events |
| WorldStreamer | chunks, props, LOD | player progress → visible world |
| PersistenceService | versioned atomic saves + backup + migration | run results/settings → storage |
| Telemetry | frame time, latency, balance metrics; **no video frames** | events → opt-in local logs |

Units inside the sim: meters, seconds, radians, kilograms, m/s. UI converts to km/h.

---

## 5. Hand-Tracking Input System (full spec)

### 5.1 Capture & worker
- `getUserMedia` 640×480 → downscaled 320×240 for inference; mirrored PiP display for the player.
- `HandLandmarker`: `numHands 2`, `runningMode VIDEO`, `delegate GPU` (CPU fallback + warning + reduced preset). float16 models bundled locally.

### 5.2 Pre-processing
- Selfie-mirrored coords (screen-left = player-left).
- `handScale = dist(L0_wrist, L9_middleMCP)`; all distance features normalized by it.
- One Euro filter per landmark (initial `fcmin 1.0 Hz`, `beta 0.007`; per-user persisted tuning).

### 5.3 Hand identity (crossing-safe) — *critical*
MediaPipe handedness is per-frame from the palm image and flips when hands overlap (known issue #4785). We run our own 2-track tracker: constant-velocity prediction + nearest-neighbor assignment each frame; handedness labels used only for initial lock-on. Teleport (> threshold) → continuity preferred, authority briefly reduced. Single hand visible → single-hand steering from calibrated anchor (one-handed mode optional). Both hands lost > 400 ms → AUTO-HOLD (gentle auto-brake, "HANDS LOST" feedback, pause if unrecovered; never score during input-loss pause).

### 5.4 Grip metric (continuous)
```
curl(f)   = 1 − ∠PIP(f)/180°  per finger (index..pinky)
thumbAcross = 1 − clamp(dist(L4,L8)/handScale/1.1, 0, 1)
grip = 0.85·mean(curl) + 0.15·thumbAcross      ∈ [0,1]
```
Dual thresholds + hysteresis (fist-on > 0.72, fist-off < 0.52) + 3-of-5 frame majority vote.

### 5.5 Grip state machine (regrip-aware) — *merged from Codex plan*
- **Both fists** → throttle ramps to full request, capped at car's vMax.
- **One palm opens during hand-over-hand crossing (regrip)** → grip release only: hold throttle state, no brake, no wheel snap.
- **Second palm opens within a short window** → brake ramps in.
- Mixed/transitional band → coast (engine braking).
- Acceptance metric: **false braking < 1% of intended regrips** (scripted + live trials).

### 5.6 Virtual steering wheel
- Calibration (~5 s): hold 9-and-3 → record `anchorL, anchorR`, `shoulderRef = |anchorR.x − anchorL.x|`.
- `v = (R − anchorR) − (L − anchorL)` in shoulderRef units; `θ = atan2(v.y, v.x)`; unwrap across crossing.
- **Right hand rising over left = counter-clockwise wheel = car turns LEFT** (matches real steering; mirror transform verified in calibration — explicit scripted acceptance case).
- Dead zone ±25°, lock at ±100°, response curve `sign·(|θ/100°|^1.35)`, rate limit 3.5 rad/s, speed-aware steering ratio, wheel-zone gating (authority fades beyond 1.4× shoulderRef from the calibrated plane).
- HUD: translucent wheel sprite rotated live to θ in the PiP; grip glow; throttle bar — the visible "game understands my hands" magic.

### 5.7 Occlusion & confidence
One hand briefly hidden during crossing → bounded-interval estimation from last good pair + visible hand. Confidence below threshold → lift throttle immediately, hold steering briefly, then gentle auto-brake, then pause. Never silently fail.

### 5.8 Fallback & accessibility
Keyboard always active (`W/S`/`A/D`, `Space`, `R`, `C` camera). Gamepad optional InputAdapter. One-handed mode, sensitivity sliders, wheel inversion, gesture hold time, reduced shake. If camera denied → keyboard demo mode with clear messaging.

### 5.9 Acceptance protocol (M2 gate) — *merged: tester-diverse, p95 targets*
- ≥ 10 testers: different hand sizes, skin tones, sleeves, lighting conditions.
- Scripted clips: left/right/center, regrip, crossing, open-palm, partial occlusion, fast reversals.
- Targets (validate, not assume): steering sign correct in 100% of scripted cases; median angle error < 5° and p95 < 12° vs an annotated virtual-wheel reference; false braking < 1% of regrips; end-to-end latency < 120 ms p95 (goal 100 ms); graceful input-loss in 100% of dropout cases. Jitter at rest < 1.2° std-dev.
- Calibration wizard displays live measured latency; practice range mode measures RMS tracking error.

---

## 6. Vehicle Dynamics

### 6.1 Model
Planar bicycle model, semi-implicit Euler, fixed 60 Hz (swept collision absorbs tunneling: at 200 km/h the car moves ~0.93 m/tick; at 365 km/h closing ~1.7 m — swept tests are mandatory, M3 gate).

State: `pos, heading ψ, v (world), yawRate ω, steerAngle δ, wheelSlip`.
```
αf = δ − atan2(vy + aω, |vx|);  αr = −atan2(vy − bω, |vx|)
Fy = −μFz · sin(B·atan(C·α))   (per axle, simplified Pacejka)
Fx = driveForce(gear,RPM) − brake − drag·v|v| − roll·v
Grip circle: lateral available = sqrt((μFz)² − Fx²)
ω̇ = (a·Fyf − b·Fyr)/Iz ;  ψ̇ = ω ;  v̇ = rotate(F/m)
```

### 6.2 Feel layer
Speed-sensitive steering `δmax(v) = δ0/(1+v/vs)`; longitudinal weight transfer (front/rear Fz split) + visible body roll/pitch on spring-damper; surfaces: road 1.0 / shoulder 0.8 + rumble / grass 0.45 + drag; drift when lateral demand exceeds grip (excess → yaw + rear slip, 15% counter-steer assist); top-speed via drag-matched drive force falloff; 6–7 virtual gears driving RPM (audio + force).

### 6.3 Validation protocol — *merged from Codex plan*
Logged and gate-checked in M1: 0–100 km/h time, 100–0 braking distance, steady-state cornering g, slalom response, yaw overshoot after step steering. Manufacturer-real figures only where rights exist; otherwise tune-to-feel and record the achieved numbers (never invent "real" claims).

### 6.4 Collision (analytic)
OBB vs OBB (spatial-hash broadphase, lane-ordered), SAT → normal + penetration + relative velocity. Response: restitution 0.25, tangential scrub 0.6, yaw kick ∝ contact torque, low-slip stability assist. Traffic hit → kinematic "knocked" ballistic (velocity + spin decay 2.5 s, capped 3-car chain reactions). **Swept** narrowphase at high closing speeds (tunneling math above). Damage from impulse (§9).

### 6.5 Determinism
Pure float math, fixed step, no allocation in step. State-hash equality across 10-min scripted runs is a CI test. (Contrast: engine rigid bodies are not deterministic — the reason we author our own.)

---

## 7. Chase Camera

Spring arm: mount car-local (−6.5 m back, +2.8 m up), critically damped, stiffness ∝ speed. Look-at ahead `4 + 0.04v`, biased 12% into steer. Dynamic FOV 50°→78° with speed + 0.8 m pull-back. Perlin micro-shake ∝ v²; crash kick; near-miss roll impulse. Camera never occludes the next gap (validated vs spawn distance M4). Hood/far cams optional. Shake and slow-mo respect `prefers-reduced-motion`.

---

## 8. Traffic AI

- 2–4 same-direction lanes + 0–2 oncoming (environment-dependent; oncoming = ×2 score zone).
- Kinematic agents (lane s, offset, speed) + FSM: `CRUISE → FOLLOW (IDM-lite) → CHANGE_LANE (signal 1.0 s, move 2.2 s) → PANIC → KNOCKED → DESPAWN`. IDM (Treiber) and MOBIL (Kesting) are the formal references for car-following and lane-change safety checks (time-to-collision, target-lane rear gaps); we tune simplified versions.
- Families: compact, sedan, sports, SUV, van, bus, box truck — distinct OBB sizes (gap judgment), speed bands, lane habits, paint.
- Pooled (64) + `InstancedMesh`; ≤ 40 active. Spawn 300–500 m ahead (beyond fog), despawn 80 m behind.
- **Fairness invariant (tested):** every spawn frame leaves ≥ 1 reachable gap ≥ 2.2× player width within reaction distance `v×1.6 s`; never target the player's current lane; every hazard has a readable cue. Verified by escape-search in the autonomous soak.
- Special agents (event director, §11): drunk weaver, roadblock pair, cutter, convoy, rubberneckers, mirror merge.

---

## 9. Damage & Health

`health ∈ [0, healthMax]`. `dmg = k·(J/Jref)^1.4`, `J = |relVel·n|` clamped; same-window impacts (0.8 s) deal 50% (prevents multi-contact drain). States: PRISTINE → DAMAGED 65% (cracks, wobbling bumper, sparks) → CRITICAL 30% (smoke, −8% power, klaxon, vignette) → WRECKED 0 (slow-mo 0.3× 1.2 s, roll-out, orbit, results). Contact split front/side/rear affects consequences (side hits bend steering slightly at CRITICAL). Low-health car stays controllable ("last seconds meaningful"). Health HUD = damage silhouette diagram. Grazing a bus vs a compact at equal closing speed → sensible, not identical (validation case).

---

## 10. World & Environments

### 10.1 Streaming
256 m chunks on a noise-curved spine (sweeping bends, no vMax hairpins). `seed = chunkIndex + runSeed`; per-run seed from clock → non-repeating, QA-replayable. Chunk build ≤ 2 ms (prefab merged geometries). Keep 4 ahead / 1 behind. Props via 1–2 `BatchedMesh` per theme. Repeat suppression: no adjacent duplicate landmarks/events.

### 10.2 Environments (launch 3)
| Theme | Look | Twist |
|---|---|---|
| Coastal Sunset Highway | warm haze, sun-glare events, ocean/cliffs, palms | wide shoulders, glare moments |
| Neon Night City | rain-slick look, neon signage, lit underpasses | tighter lanes, oncoming lanes |
| Desert Canyon Pass | harsh noon, heat shimmer (far-LOD vertex wobble), mesas | curvature + dips (sightline gameplay) |
Variety layers: time-of-day × weather (lighting/fog/palette + particles), seeded props/signage/construction zones, event director, environment auto-cycle per run, billboard/sign locale pools. Authored road modules with rules (lane count, shoulders, bends, merges, tunnel exits, **minimum sight distance**) assembled from a validated graph.

---

## 11. Scoring, Difficulty, Progression

### 11.1 Score (starting values = hypotheses for telemetry)
| Source | Rule | Points |
|---|---|---|
| Passive | `60·(v/vMax)²`/s above 80 km/h | stream |
| Near miss | **swept body-to-body** min clearance `c` + closing > 40 km/h, fired once per encounter ID after the pass completes | tiers: ≤0.4 m +500; ≤0.8 m +250; ≤1.2 m +100 |
| Oncoming lane | multiplier on near miss | ×2 |
| Clean pass | overtake without contact | +50 (+100 more if > 120 km/h) |
| Combo | near-miss within 4 s: `×(1+0.25·combo)` cap 10×; resets on collision or 4 s gap | multiplier |
| Clean streak | 30 s contact-free | +1,000 |
| FLOW | combo ≥ 5: passive ×1.5, +0.5 HP/s regen to 35% cap | state |
Raw event counts + components stored per run (auditable). **Anti-exploit suite (tested):** tailgating without overtaking; re-entering the same gap; reversing; parking; collisions still counting as near misses; impossible spawn gaps. Leaderboards partitioned by car / assists / environment; normalize across partitions only with data. Practice mode: gentle traffic, no leaderboard claim.

### 11.2 Variety director (v1.2 — former "difficulty director")
```
density(t)   = 6.5 + 2.5·min(t/240,1)^1.25   (veh/km/lane, flat after 4 min)
eventRate    = 1/40 s → 1/24 s over 240 s    (variety pacing, not pressure)
```
NO survival target (retired, ADR-008): the director adds variety — density drift, feature zones, M7 injectors (ROADBLOCK, CUTTER, DRUNK_WEAVER, CONVOY, TOLL_SQUEEZE, RUBBERNECKING, MIRROR_EVENT) — as readable, survivable set-pieces. Mercy rule kept: 2 early crashes (< 90 s) → 30 s density pause, unannounced.

### 11.3 Persistence
```
vfc.settings  { input tunables, quality, volumes, car, envPin, oneHanded }
vfc.progress  { lifetimeScore, unlocks, bestSpeed, totalRuns }
vfc.scores    [ top-20 runs {score, car, env, assists, duration, topCombo, nearMisses, crashes, date} ]
vfc.calib     { oneEuro params, anchors }
```
**Atomic writes** (serialize → temp key → verify → swap) + backup copy + versioned migrations + export/import JSON.

---

## 12. Cars (Garage)

Archetypes (original designs — licensing real brands is out of scope; see DECISIONS ADR-003):
| Car | Class | Top | 0–100 | Personality | Health |
|---|---|---|---|---|---|
| **Falcone GT** | Powerful AWD grand tourer | 340 | 3.4 s | Heavy, stable, forgiving; wide | 110 |
| **Vipera RS** | Lightweight RWD | 365 | 2.6 s | Nimble, twitchy at limit, punishes over-correction | 85 |
| **Bruto Widebody** | High-grip track-focus | 320 | 3.1 s | Drift-happy, huge sliding grip, tank | 130 |
Unlocks: Falcone free; Vipera 150k lifetime; Bruto 500k. Garage: turntable, stats bars, rev-on-select, 6 paints each. Each car = 1 hero mesh (~30k tris) + LOD + OBB dims + physics JSON + audio params + FX anchors.

---

## 13. Art Direction

"AAA-adjacent" via lighting/grading/motion, not polygon count: PBR-lite hero car (env map per theme, clear-coat fake); vertex-lit instanced traffic; per-theme 3-stop lighting rig + matched fog + sky dome; emissive neon with sprite halos (bloom-free); **one LUT final pass** (grade + vignette + speed-edge chromatic aberration, off on Low); speed language (FOV, speed-line particles, wind audio); blob shadows always, hero 1024 shadow on Medium+; damage FX (sparks, smoke pools, decals); slow-mo wreck orbit with DOF-fake. Asset pipeline: Kenney/Quaternius CC0 bases → Blender rework → glTF + Draco + KTX2 (`gltf-transform` in CI).

---

## 14. Audio

100% procedural WebAudio (zero files → tiny load, infinite RPM resolution): per-cylinder ignition pulses at firing frequency through resonant band-passes (intake/exhaust/mechanical), load-dependent brightness, distortion with throttle; per-car parameter sets; turbo + blow-off (Vipera); wind/road noise beds ∝ v²; rumble thumper; slip-driven tire squeal; doppler near-miss whoosh panned by side; layered crash + metal ring ∝ impulse. Decision point M6: if synthesis quality disappoints, fall back to a small licensed CC0 sample layer for engine only. Master bus: compressor + limiter; all nodes pre-built.

---

## 15. UI/UX

```
BOOT → camera explainer → MENU[DRIVE|GARAGE|HOW TO PLAY|SETTINGS|SCORES]
DRIVE: car select → env (auto/pin) → CALIBRATION (5 s + live latency/grip readouts + practice nudge)
→ COUNTDOWN → RUN → WRECK → RESULTS (score, NEW BEST ceremony, near-miss timeline, stats) → RETRY(1 key)
```
HUD: speed dial + gear, score/combo/flow, damage silhouette, event toasts, PiP with wheel overlay + grip viz. Statesman moments (milestone toasts, NEW BEST). Options: quality preset, latency readout, one-handed mode, shake, sensitivity sliders, PiP pos/size, recalibrate, reset/export/import data. Failure UX: always say what happened and what to do. DOM UI, ≥44 px targets, `prefers-reduced-motion` respected.

---

## 16. Performance Engineering

**Budgets (Low preset = Iris Xe-class iGPU baseline):**

| Metric | Budget |
|---|---|
| Frame time | ≤ 16.6 ms p95 (60 FPS); 30 FPS absolute floor, 1% lows tracked |
| Draw calls | ≤ 250 Low / 350 High |
| Triangles | ≤ 350 k on screen |
| Texture VRAM | ≤ 128 MB (KTX2) |
| Heap | ≤ 350 MB; 0 allocations/frame steady-state (dev GC watchdog) |
| Input latency | ≤ 100 ms p95 (measured, displayed) |
| Tracker | ≤ 25 ms/frame @320×240 GPU delegate; CPU fallback 15 Hz + interp |
| Load | ≤ 3 s @20 Mbps (code-split, Draco/KTX2, lazy models) |
| Chunk build | ≤ 2 ms |
| Soak | 20-min thermal/frame-time soak passes without hitches |

Techniques: InstancedMesh traffic, BatchedMesh props, 2-level LOD + fog culling, quality auto-scaler (EMA frame time, step-down with hysteresis, manual override), DPR clamp [0.75, 1.5], worker isolation, zero-GC typed-array pools, hybrid-GPU/SwiftShader detection with guidance, per-theme asset residency. **Benchmark harness is a first-class M0 deliverable** (dev HUD + telemetry logging from day one); perf smoke in CI (Chromium worst case, regression-tracked).

---

## 17. Testing & QA

- **Unit (Vitest, pure `sim/`+`input/`):** One Euro properties; grip metric fixtures (fist/open/curl/dorsum); wheel solver monotonicity + unwrap at crossing + mirror sign; OBB SAT; **swept** near-miss tiering; combo decay; damage windows; difficulty bounds; save migrations; atomic write.
- **Landmark replay harness:** recorded sessions → CI golden numbers for tracking error/latency (catches regressions without cameras).
- **Determinism:** 10-min scripted input → state hash equality (CI).
- **Fairness invariant:** escape-search proves a survivable line at every spawn frame (autonomous soaks).
- **Anti-exploit suite** (§11.1) as automated scenario tests.
- **Physics validation:** §6.3 metrics.
- **Chaos drills:** camera denied/unplugged mid-run/10 FPS camera/occluded hands → graceful degradation 100%.
- **Manual matrix:** lighting × sleeves × skin tones; keyboard+hand parity; blind world-recognition screenshots; boredom panel (5 testers × 6 runs, <10% repetition flags).
- **Playtest (M8):** ≥ 12 testers, think-aloud calibration, immediate-retry instinct ≥ 80%.

## 18. Telemetry & Tuning

10 Hz ring buffer: speed, lane, inputs + confidence, near-miss events + swept clearance, crashes + impulse, spawns, difficulty params, frame times, tracker age. Export → analysis scripts → survival curves per cohort, near-miss heat maps, latency histograms, death-cause taxonomy (spawn-fair vs player error). Dev panel: live sliders for every constant. **All numbers in §11 are hypotheses until this loop says otherwise.**

## 19. Risks

| Risk | Response |
|---|---|
| Hand identity swap on crossing | Own tracker (§5.3); 100-trial scripted crossing gate in M2 |
| Tracking latency/jitter on weak laptops | Worker + GPU delegate; 320×240; One Euro; rate limits; live latency display; keyboard fallback |
| Fist false-positives (dorsum view) | Continuous metric + thumb term + hysteresis + voting |
| iGPU frame drops | Budgets + auto-scaler + instancing-first; Low preset verified on reference hardware |
| Unfair spawn walls | Formal solvability invariant + soak tests |
| Feels repetitive | 3 themes × TOD/weather × seeds × event director; variety panel |
| Arm fatigue | 2–6 min runs; elbows-down tolerance; hands-down pause |
| Camera permission friction | Explainer + keyboard demo mode |
| SwiftShader/software WebGL | Detection + guidance + refuse-to-run cleanly |
| Scope creep | Roadmap gates content at 3 cars + 3 envs; stretch parked |
| Motion sickness | Shake toggle, reduced-motion, FOV ceiling |
| Save drift | Versioned + atomic + backup + migrations |

## 20. Roadmap

Idealized engineering weeks; **calendar expectation solo with AI assistance: 3–6 months to production-ready v1** (merged honesty from both plans). Each milestone ends in a playable artifact with acceptance gates.

| M | Scope (weeks) | Gate |
|---|---|---|
| **M0 Foundation** (1) | Repo, Vite+TS strict, fixed-timestep loop + interpolation, Three scene + placeholder road + keyboard box car, **dev HUD + benchmark harness** | 60 FPS drive on iGPU; determinism hash test green |
| **M1 Vehicle & camera feel** (2) | Bicycle model + feel layer + car JSON; chase camera; cones | Validation protocol numbers hit; 10-tester fun ≥ 4/5 |
| **M2 Hand tracking core** (3–4) ⭐ | Worker + MediaPipe; One Euro; identity tracker; grip FSM (regrip-aware); wheel solver; calibration wizard + latency display + practice range; PiP overlay; arbiter | §5.9 acceptance protocol green on 3 laptops |
| **M3 Traffic & collision** (5) | Traffic FSM + spawner + fairness solver; swept OBB; knocked states; near-miss detection (log-only) | 60-min soak: 0 unsolvable spawns; no tunneling at 365 km/h closing |
| **M4 World & environments** (6–7) | Chunk streamer, seeded procgen, 3 themes + lighting rigs, batching, TOD/weather, event framework | ≤ 2 ms chunks; ≤ 250 calls Low; variety panel < 10% flags |
| **M5 Game systems** (8) | Scoring + combos + popups, damage/wreck, results, atomic persistence, garage + 3 cars | Full loop; scores survive; blind car-personality test 8/10 |
| **M6 Art & audio** (9–10) | Hero cars, damage states, FX, final grade pass; procedural engine + SFX; presets + auto-scaler | Budgets green on 3 laptops; audio latency < 30 ms; premium panel ≥ 4/5 |
| **M7 Variety & events** (11) | Director curves, all injectors, mercy; telemetry export | Injectors readable & survivable; telemetry export works |
| **M8 Comfort & polish** (12) | 12+ playtesters; tune assists/feel for relaxed fun; options completeness; accessibility | Assist comfort ≥ 4/5; 0 known fairness bugs |
| **M9 Ship prep** (13) | Perf CI, migrations, packaging/page, trailer, legal pass | Load ≤ 3 s; cold boot → driving ≤ 15 s; budgets green |

Stretch (parked): procedural music, ghost replays, global leaderboards, extra cars/envs.

---

## 21. Repo Layout

```
velocifist/
├─ index.html  vite.config.ts  tsconfig.json  package.json
├─ docs/            PLAN.md  MEMORY.md  PROGRESS.md  DECISIONS.md
├─ src/
│  ├ main.ts        boot + state machine wiring
│  ├ core/          loop.ts (fixed timestep)  events.ts  gameState.ts
│  ├ input/         tracker.worker.ts  handTracks.ts  oneEuro.ts  gestures.ts
│  │                calibration.ts  keyboard.ts  arbiter.ts
│  ├ sim/           vehicle.ts  collision.ts  traffic.ts  world.ts
│  │                scoring.ts  damage.ts  difficulty.ts  cars/*.json   (pure TS, no DOM/Three)
│  ├ render/        scene.ts  camera.ts  trafficRender.ts  worldRender.ts
│  │                fx.ts  pip.ts  quality.ts  devHud.ts
│  ├ audio/         engine.ts  sfx.ts  buses.ts
│  ├ ui/            hud.ts  menus.ts  calibration-ui.ts  results.ts
│  └ persist/       storage.ts  migrations.ts
├─ tests/           vitest units + replay harness + soaks
├─ tools/           telemetry analysis scripts
└─ public/          assets (models ktx2, fonts)
```

**Rule: `src/sim/` stays pure** — the whole game logic runs headless (this powers CI, determinism, fairness proofs, and difficulty calibration).

## 22. Memory & Progress Discipline (project law)

1. `docs/MEMORY.md` — append-only pills (dated, atomic facts/decisions/gotchas). Update **every** change.
2. `docs/PROGRESS.md` — milestone checklist + "next step", updated at the end of every work session.
3. `docs/DECISIONS.md` — ADRs for every architectural choice, never deleted, superseded marked.
4. `docs/PLAN.md` — this document; update when design changes (never silently).
5. Commit messages reference milestone + system (e.g., `M2 input: crossing-safe hand tracker`).

---

*Appendix A/B (tuning constants, gesture math) and full source list are inherited verbatim from OVERDRIVE-AR-MASTER-PLAN.md v1.0 and remain authoritative; see the original document archived in the workspace until mirrored here (M1 task).*
