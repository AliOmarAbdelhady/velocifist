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

## ADR-014 — Zero driving assistance & lateral freedom (120 km/h)

**Date:** 2026-09-23 · **Status:** accepted

**Context.** User: "Why do I always return to the middle? I want to be free on the right and on the left as I want… I want zero assistance in the driving… increase the speed to 120 kilometers per hour."

**Decision.**
1. **Lane centre-pull deleted.** The lane assist now ONLY aligns the car with the road heading ahead (so bends don't fling you); a lateral offset is preserved exactly — the car stays wherever the player puts it. Guardrails remain the only physical boundary.
2. **Driver aid defaults to OFF** (was light). Settings schema 3 migrates existing 'light' saves to 'off' once — the player who asked for zero gets zero. Light/full remain selectable in options.
3. **Cruise cap 120 km/h** (33.3 m/s; Bruto 112). The whole pyramid rescales ×1.5: traffic families 46–89 km/h, event injector speeds and placement, speed-line onset ~70 km/h, validation targets re-measured (brake 120→0 ≈ 39/38/33 m, full-lock turn radius 51–73 m ≈ 2 g).

**Consequences.** This supersedes the "assists always on" clause of ADR-008 and the light default of ADR-013 — driving is now fully manual by default; the grip governor (ADR-013) stays, being the car's character rather than an aid. The M5 "sloppy driver" lane-keep test is replaced by a lateral-freedom test (an offset car keeps its offset).

## ADR-015 — 150 km/h, rival traffic, escalating density

**Date:** 2026-09-23 · **Status:** accepted

**Context.** User: speed to 150 km/h; "the cars in front of me are trying to prevent me from passing, and I'm trying to pass"; traffic should increase every while, again and again.

**Decision.**
1. **Cruise cap 150 km/h** (41.7 m/s; Bruto 140) — pyramid rescaled ×1.25: traffic families 58–111 km/h, events ×1.25 placed 340–460 m ahead, streaks from ~85 km/h, targets re-measured (brake 150→0 ≈ 61/60/51 m).
2. **Rival AI:** ~30% of same-direction cars (families 0–4, not buses/trucks) are rivals. A rival ahead reads the player's lateral DRIFT (projected lane), and when the player pulls toward an adjacent lane it signals (1 s readable blinker) and cuts across to block, subject to: lane-gap checks, max 2 concurrent rival cuts (no coordinated walling), 5–9 s cooldown, oncoming/construction exclusion. Rivals also pace up (~+15% over family cruise) while the player shadows them, and relax when the pressure leaves. Scripted event cars are never rivals.
3. **Escalating density (replaces ADR-008's flat-after-4-min curve):** warm-up 8→10 veh/km/lane over 4 minutes, then **+1 per minute forever**, capped at 24 by the agent pool. The longer the run, the denser the weave.

**Consequences.** Passing becomes a duel: you fake left, they blink and close the door, you cut back right. The fairness soak runs WITH rivals armed and still probes zero no-escape states across 60 sim-minutes — the block is one lane, one rival, with a warning blinker, so an escape always exists. Kill pacing remains retired; difficulty now comes from density and rivals, not from unfair walls.

---

## ADR-016 — 200 km/h regime, meaner rivals, readability pass (M17)

**Context.** User directive: "add the speed to be 200 km/h… make the game harder a little bit and the cars trying to stop me from passing… the road to be more clear and appear better… the car look more real". The third cap bump (80→120→150→200) plus a difficulty and readability pass.

**Decision.**
1. **Cruise cap 200 km/h** (55.6 m/s; Bruto 186.7 → 51.9). Pyramid rescaled ×1.333: traffic families 21.3–41.3 m/s (77–149 km/h), spawn window 170–460 m (~3–8 s at the new closings), events ×1.33 placed 460–640 m ahead, speed lines from ~115 km/h, `targetBrake` re-measured (brake from vCruise−1), turn-radius bound re-derived v²/a ≈ 158 m at 2 g. Road bends need NO flattening: chunk curvature keeps R ≥ ~740 m while full-lock at 200 needs only ~158 m.
2. **Meaner rivals:** fraction 30%→45% of eligible same-direction cars; cooldown 5–9 s → 3–6 s; concurrent block cuts ≤2 → ≤3; defensive pacing to family vMax ×1.15 → ×1.30; trigger band 8–90 m → 8–110 m. The readability contract stays: 1 s blinker before every cut, lane-gap checks, no rivals in buses/trucks/event cars.
3. **Escalation faster:** warm-up 8→11 veh/km/lane over 3 min (was 8→10 over 4), then +1 per 45 s (was 60), ceiling 26 (was 24); agent pool 48→56.
4. **Readability:** marking texture redrawn (wider/brighter edge lines, brighter dashes, less speckle over lines); white delineator posts with reflector bands every 24 m on both shoulders; road ribbon AHEAD 760→920 m; fog far +100–140 m per theme.
5. **Car realism:** clearcoat paint (MeshPhysicalMaterial), front splitter, rear vents, 10-spoke rims, richer nose taper on profiles.

**Consequences.** The fairness invariant is unchanged and the soak must still probe 0 no-escape states with rivals armed at the new speeds — the spawner simply rejects harder (bigger brake envelopes at 30+ m/s closings). Difficulty rises from speed, density and rival pressure, never from unfair walls.

---

## ADR-017 — RobEn rebrand: ROBEN VELOCIFIST for roben.club (M18)

**Context.** User directive: "rebrand the game to be made for roben.club… view the website and take the logo and rebrand the car to look like roben". roben.club is the RobEn Club (AAST Cairo, robotics/AI/UAV/racing teams, "Design Your Future"). Its mark: wordmark "RobEn" where the "o" is a robot head (ring + blue eyes + antenna), framed by PCB circuit traces; palette azure #19699D, letter gray #676767, pale slate #8CA3C5 on white; the icon variant is the white robot head on a navy→azure radial-gradient rounded tile.

**Decision.**
1. **Name:** the game is **ROBEN VELOCIFIST**, subtitled "by RobEn Club · roben.club". Repo name and Pages URL stay `velocifist` (renaming the repo breaks the live URL; not asked).
2. **Mark recreated as hand-authored SVG** (favicon + PWA icons + overlay logo + in-game livery) — faithful to the recipe: robot-head "o", "R/b" hollow gray + "E/n" solid azure treatment simplified to a game-legible azure/white lockup where tiny sizes demand it; circuit-trace accents on the overlay version only. PNG PWA icons rasterized from the SVG at build time (headless Chrome screenshot), committed.
3. **Palette:** UI accents move from orange #ff5a1f to RobEn azure #19699D with teal #20c997 highlights (score gold #ffb01f kept for game pop). PWA theme/background and manifest renamed; SW cache name bumped (forces one clean refetch).
4. **Livery:** player cars get RobEn azure paint with white centre stripes, a robot-head roundel decal on the hood and "RobEn" on the rear wing/ducktail (canvas texture, per-archetype placement). Traffic cars keep their palette.

**Consequences.** Zero new runtime deps; one-time icon generation committed to the repo. The orange was load-bearing in ~15 CSS rules — all replaced by the two RobEn accents. Nothing about gameplay changes in this ADR.

---

## ADR-018 — Versus multiplayer: invite-code 1v1 ghost race (M19)

**Context.** User directive: "add a multiplayer… invite another player and send him a code and when he enter it we can play verses each other". The site is static (GitHub Pages); there is no server of our own. The phone-remote relay is LAN-only and cannot carry an internet opponent.

**Decision.**
1. **Transport:** WebRTC DataChannel via `peerjs` (new dependency, dynamically imported ONLY when the Versus panel opens — solo boot payload unchanged). Signaling through the free PeerJS cloud broker; game traffic is then peer-to-peer.
2. **Match codes:** host generates a 5-char code from the unambiguous alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ` and claims peer id `roben-race-<CODE>`; the guest connects to that id. UX: CREATE shows the code + "share it"; JOIN takes the code.
3. **Race model — ghost race on identical seeds:** the host owns the seed + start; on connect it sends `{seed, target}`; both clients run their own fully-local sims (same traffic seed → same world). Each sends `{x, z, heading, u, distance}` at 15 Hz; the opponent renders as a translucent azure ghost car with NO collision (classic time-trial-ghost semantics; each player weaves their own traffic). **First to 5,000 m wins** (~90 s at 200 km/h); wrecking = instant loss; disconnect mid-race = the other player wins.
4. **Determinism scope:** worlds are seeded identically but the sims legitimately diverge (traffic reacts to each player) — accepted by design; the ghost shows where the opponent IS, not a promise of identical traffic around them.
5. **UI:** VERSUS section (create/join, code display, status, ping); synced 3-2-1-GO countdown driven by the host's start message; HUD gap (+/- metres) and position; versus results screen (WIN/LOSS + margin + rematch — host re-seeds) and leave.

**Consequences.** No server to run or pay for; if the PeerJS cloud is down, Versus shows a clear error and solo play is untouched. Unit tests cover code generation, the race state machine (countdown/win/loss/disconnect/gap) and the protocol roundtrip; e2e-m19 runs a full two-browser race against a LOCAL PeerServer (`peer` devDep) so CI proves the flow without the internet broker.

---

## ADR-018 amendment — transport replaced: public MQTT relay instead of WebRTC (2026-09-23, user directive "i dont want them to be on the same wifi")

**Context.** Field test: host stuck at "share your code", guest stuck at "dialing the host…" — both reached the PeerJS broker, but the DataChannel never formed (STUN cannot traverse CGNAT/symmetric-NAT pairs; the free OpenRelay TURN credentials turned out to allocate ZERO relay candidates — verified with a relay-only ICE probe — so the shipped TURN config was inert). Cross-network versus must work ALWAYS, not "when NATs allow".

**Decision.** Replace WebRTC/PeerJS with **MQTT over secure WebSocket through public anonymous brokers** (broker.emqx.io primary, broker.hivemq.com fallback), `mqtt.js` lazy-loaded only when Versus opens. Topics `roben-race/v1/<CODE>/a|b`; presence is app-level: guest repeats hello every 1 s until the host's start (self-healing), ping/pong at 1 Hz, Last-Will publishes bye on ungraceful death, the 6 s silence guard settles races. A 20 s join timeout reports "no match with that code". Measured broker latency ~100 ms publish→deliver.

**Consequences.** No NAT traversal exists to fail — versus works on any pair of networks, which is the requirement. Latency is relay-grade (fine for ghost poses; the opponent is advisory, never physical). Public brokers are anonymous shared infrastructure: codes are unguessable (31⁵) but not cryptographic — accepted for an arcade 1v1. e2e-m19 now exercises the REAL production relay end to end.
