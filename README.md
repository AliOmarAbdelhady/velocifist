# VELOCIFIST 🔥✊

**Weave traffic at 300 km/h with your bare hands.**

VELOCIFIST is a third-person arcade traffic-weaving racer you control with your real hands in
front of a webcam: grab an invisible steering wheel with both fists to accelerate to the car's
limit, open your hands to brake, and turn the wheel — right hand over left for full lock — to
thread through dense highway traffic. Near-misses build combos; crashes eat your car's health
until it's destroyed. Best drivers die around the five-minute mark. On purpose.

- **Zero install** — runs in Chrome/Edge on a normal laptop (integrated GPU OK)
- **Private by design** — hand tracking runs 100% locally in your browser; nothing is uploaded
- **Deterministic sim** — fair leaderboards, testable physics

## Status

🚧 **M0 (Foundation)** — architecture docs merged, project scaffold, fixed-timestep engine core,
placeholder drivable scene, benchmark HUD, unit tests. See [docs/PROGRESS.md](docs/PROGRESS.md).

## Run it (dev)

```bash
npm install
npm run dev        # open the printed localhost URL, click START, drive with W/A/S/D
```

```bash
npm test           # vitest unit suites (loop math, vehicle determinism)
npm run build      # typecheck + production build
npm run preview    # serve the production build
```

Camera + hand tracking arrive in **M2** (webcam permission will be requested there).

## Docs (read in this order)

1. [docs/PLAN.md](docs/PLAN.md) — the canonical master production plan (v1.1 merged)
2. [docs/PROGRESS.md](docs/PROGRESS.md) — milestone tracker + session log
3. [docs/MEMORY.md](docs/MEMORY.md) — memory pills (updated every change)
4. [docs/DECISIONS.md](docs/DECISIONS.md) — architecture decision records

## Controls (M0 placeholder: keyboard; hands arrive in M2)

| Key | Action |
|---|---|
| `W` / `↑` | Throttle |
| `S` / `↓` / `Space` | Brake |
| `A` `D` / `←` `→` | Steer |
| `C` | Cycle camera: chase / hood / far |
| `1` `2` `3` | Switch car (Falcone / Vipera / Bruto) |

---
Private repo. © 2026 — original archetype car designs; CC0 base assets (Kenney/Quaternius) reworked.
