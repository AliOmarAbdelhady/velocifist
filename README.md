# ROBEN VELOCIFIST ⚡

**Made for [RobEn Club](https://roben.club)** (AAST — Robotic Entrepreneur ·
"Design Your Future"). A third-person, chase-camera traffic-weaving racer:
200 km/h constant-gas cruise, rivals that read your line and close the door,
escalating traffic, invite-code 1v1 versus races — driven by keyboard,
PS4 controller, your phone as a wheel (drag or tilt), or your bare hands in
front of a webcam (fists = throttle, open palms = brake, turn the invisible
wheel — cross your right hand over your left for full lock).

Everything runs **100% locally in your browser** — hand tracking (MediaPipe)
executes on-device, the video never leaves your machine, nothing is recorded
or uploaded.

**Play:** https://aliomarabdelhady.github.io/velocifist/ (Chrome/Edge
recommended — hand tracking needs a webcam and decent light)

---

## How to play

| Action | Hands | Keyboard |
|---|---|---|
| Accelerate | both fists on the wheel | `W` / `↑` |
| Brake | both palms open | `S` / `↓` / `Space` |
| Steer | turn the invisible wheel (cross hands for full lock) | `A` / `D` |
| One-handed mode | fist = go · open palm = brake · wrist steers | — |
| Camera views | — | `C` |
| Theme cycle | — | `T` |
| Quality cycle | — | `Q` |
| Switch car | — | `1` `2` `3` (unlocks by lifetime score) |
| Reverse | — (hold brake at a stop) | `S` held at standstill |
| Options (sensitivity, comfort, PiP, volume, data) | — | `O` / `⚙` |

**Other controllers (M12):** PlayStation DualShock 4 (Bluetooth/USB — press a
button to wake it, left stick steers, ✕/R2 gas, ○/□/L2 brake) and a **phone
remote** — run `node scripts/remote-relay.mjs --serve` on the machine that
plays, open the printed `http://<lan-ip>:8080/phone` on your phone (same
WiFi): a real steering wheel you drag + gas/brake pedals, vibration on
crashes, ~1-5 ms LAN latency. All controllers merge — the last one you touch
drives.

First camera run shows a short calibration wizard (hold both hands at 9 and
3, fists closed). The picture-in-picture AR dashboard shows your tracked
skeletons, grip gauges, the live steering wheel with your hands on it, pedal
meters and a plain-language banner of what your hands are commanding.

The game is **easy-first by design**: a forward-collision assist coaxes the
brakes for you (your own braking always wins), traffic is relaxed, and risk
is opt-in — drive *close* and *fast* past cars to score near-miss combos.

## Quickstart (development)

```bash
npm install
npm run dev        # dev server on http://localhost:5173
npm test           # unit suite (node-only, no GPU/browser needed)
npm run build      # typecheck + production build → dist/
npm run preview    # serve the production build locally
```

Headless end-to-end verification (dev server on :5173 + global playwright
with Chrome):

```bash
node scripts/e2e-m6.mjs   # crash chain: sparks, smoke, audio, wreck, results
node scripts/e2e-m7.mjs   # hand pipeline: demo autonomy, assist, fake camera
node scripts/e2e-m8.mjs   # variety events + telemetry export (real download)
node scripts/e2e-m9.mjs   # options overlay: pause, persist, one-handed, reset
node scripts/e2e-m10.mjs  # ship gates: boot budgets, PWA offline, base paths
node scripts/e2e-m11.mjs  # cruise regime: 80 km/h plateau, traffic at t≈0
node scripts/e2e-m12.mjs  # phone remote drives via the real relay + reverse
```

Dev backdoors (query params): `?pipdemo=1` synthetic hands drive the whole
game through the real pipeline (no camera) · `?smash=1` re-arming ghost truck
· `?instantwreck=1` scripted wreck · `?theme=neon` pin a theme · regenerate
PWA icons with `node scripts/make-icons.mjs`.

## Architecture (milestone map)

| Layer | What's there |
|---|---|
| Core (`src/core`) | fixed-timestep 60 Hz loop + interpolation, quality presets + EMA autoscaler, motion-comfort policy, run telemetry |
| Sim (`src/sim`) | bicycle-model car with feel layer, seeded 256 m chunk world (3 themes), fairness-checked IDM traffic, six set-piece event injectors, forward-collision assist, damage/scoring/director |
| Input (`src/input`) | MediaPipe HandLandmarker in a module worker (GPU→CPU fallback), identity tracker, One Euro filtering, virtual-wheel + pedal gesture solver (regrip-aware, one-handed capable), hysteresis arbiter |
| Render (`src/render`) | procedural hero cars, pooled GPU particles + speed lines, single-quad grade pass (ACES), AR dashboard PiP, chase/hood/far camera rig |
| Audio (`src/audio`) | 100% procedural WebAudio — per-cylinder ignition synthesis, load distortion, turbo, beds, crashes. Zero audio files |
| UI (`src/ui`) | HUD, garage, results, calibration wizard, options overlay |

Design history and rationale live in [`docs/PLAN.md`](docs/PLAN.md) (spec +
changelog), [`docs/DECISIONS.md`](docs/DECISIONS.md) (ADRs),
[`docs/MEMORY.md`](docs/MEMORY.md) (implementation pills) and
[`docs/PROGRESS.md`](docs/PROGRESS.md) (session log).

## Deployment

GitHub Actions deploys `main` to GitHub Pages automatically
(`.github/workflows/deploy.yml`, built with `--base=/velocifist/`).
CI runs typecheck + tests + build on every push (`.github/workflows/ci.yml`).

> The repo is private; the Pages **site** is publicly readable by default —
> that's how GitHub Pages works. Disable it in *Settings → Pages* if that's
> not wanted.

The build is an installable **PWA**: after your first visit it works fully
offline — including hand tracking (the wasm + model are runtime-cached by the
service worker; ~20 MB, fetched only when you enable the camera).

## Credits & licenses

- Code: MIT (this repository).
- [Three.js](https://threejs.org) (MIT) for rendering; [MediaPipe
  Hands Landmarker](https://developers.google.com/mediapipe) (Apache-2.0) for
  on-device hand tracking.
- All art and audio are **generated by code at runtime** (ADR-009) — no
  third-party images, models, fonts or sounds ship with the game.
