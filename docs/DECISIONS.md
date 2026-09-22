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
