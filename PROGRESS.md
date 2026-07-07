# PROGRESS

## Commands
install: npm install
test: (none — verify with the Playwright screenshot harness, see CLAUDE.md)
start: npm start
capture-demo: npm run capture-demo  (requires ffmpeg + playwright chromium)

## Health budget
N/A for static no-build game. Runtime bars from the v1.3.0 soak: 60fps headless,
heap growth < 3MB / 100s, zero page errors across day/dusk/night/race/crash flows.

## Plan
- [x] units 1-5 (v1.0-1.1): core sim, collision, HUD, audio, release hygiene
- [x] unit 6 (v1.2.0, 2026-07-02): full visual overhaul — sky/stars/moon, biome terrain,
      water shader, sprite clouds, ridged mountains, new airplane + vapor trails,
      night windows, bloom/vignette, glass HUD, title screen
- [x] unit 7 (v1.3.0, 2026-07-06): gameplay + living world via module system —
      js/challenges.js (3 ring races, best times), js/ambient.js (birds/balloons/AI
      traffic/airfield lights), js/skyfx.js (aurora/shooting stars/lightning/fireflies),
      js/soundtrack.js (generative music). Host: module hooks, god rays, gamepad,
      photo mode, crash orbit cam, low sun at dawn/dusk.
- [x] unit 8: 46-agent adversarial review + runtime verification; all confirmed
      findings fixed (see CLAUDE.md quirks section for the list)

## Current signal state
Headless Chromium: zero page errors across all flows; 60fps; heap stable.
All 4 modules registered and surviving the host's error traps.

## Decisions / open questions
- `terrainHeight()` remains gameplay-coupled — never changed for visuals.
- Module ambience is visual-only (no collision): accepted.
- Module init raycast stall (~300 casts, one-time): accepted.
- R mid-race aborts the race (teleport guard) — re-select with 1/2/3 to retry.
- Music unmuted by default (master 0.14); M toggles, also on the crash screen.

## Ideas for a future unit (not started)
- Landing scoring on the two runways (touchdown sink rate + centerline)
- Ghost replay of best race run; shareable seed/time strings
- Touch controls for mobile; pointer-lock mouse mode
- GitHub Pages deploy (static — just enable Pages on main)

## Notes for resume
- Read CLAUDE.md first: module contract, coupling map, screenshot workflow.
- README hero: docs/assets/screenshot.png (race at golden hour) +
  screenshot-aurora.png (night); gameplay.gif regenerated 2026-07-06.
- Version in package.json: 1.3.0.
