# MEMORY.md — VELOCIFIST memory pills

> **Project law:** append a pill every time anything changes (fact, decision, gotcha, number).
> One pill = one atomic fact. Newest at the top. Never delete — mark `~~superseded~~` instead.

---

## 2026-09-22 — project creation

- **PILL 001 · IDENTITY:** Game = VELOCIFIST (`velocifist`). Name = velocity + fist (the core mechanic: fists = throttle). Working title "OVERDRIVE AR" retired. Repo: private GitHub `AliOmarAbdelhady/velocifist`. Local: `/home/ali/velocifist`.
- **PILL 002 · CONCEPT:** Webcam hand-tracked traffic-weaving racer. Chase cam (GTA/NFS style). Both fists = accelerate to car limit; both palms open = brake; virtual wheel incl. right-hand-over-left = LEFT turn. Near-miss/speed scoring, car health, wreck = run over. Elite target death 4–6 min. NOT world-anchored AR (terminology locked, PLAN §1).
- **PILL 003 · ARCHITECTURE:** Pure web app. TypeScript strict + Vite. Three.js WebGL2 render. MediaPipe Tasks Vision HandLandmarker (GPU delegate, 2 hands, VIDEO mode) in a Web Worker. Custom deterministic arcade vehicle physics (bicycle model, fixed 60 Hz, NO physics engine). Kinematic instanced traffic. Seeded chunk streaming. localStorage persistence (atomic). Vitest.
- **PILL 004 · PROCESS:** User-driven milestones: implement one milestone per session, report, wait for "continue". M0→M9 per PLAN §20. Update MEMORY/PROGRESS/DECISIONS on every change (project law, PLAN §22).
- **PILL 005 · PROVENANCE:** Plan v1.1 = merge of ZCode "OVERDRIVE AR" v1.0 + Codex "Traffic Weave" plan (2026-09-22). Merge changelog in PLAN.md. Originals: `/home/ali/.zcode/workspace/default/OVERDRIVE-AR-MASTER-PLAN.md`, `/home/ali/Documents/Codex/2026-09-22/i/outputs/traffic-weave-game-production-plan.md`.
- **PILL 006 · CRITICAL KNOW-HOW:** MediaPipe handedness labels flip when hands cross (issue #4785) → we MUST use our own 2-track identity tracker (velocity prediction + nearest neighbor), labels only for initial lock (PLAN §5.3). One Euro filter for landmark smoothing. Continuous grip metric (not binary gestures) with hysteresis 0.72/0.52 + 3-of-5 vote.
- **PILL 007 · ENV:** Dev machine: Ubuntu 24.04, i5-1135G7, Iris Xe iGPU, 30 GiB RAM. Node v26.8.1 (nvm), npm 11.19, git 2.43, gh 2.65 authed as AliOmarAbdelhady (repo scope). This machine is the Low-preset perf baseline.
