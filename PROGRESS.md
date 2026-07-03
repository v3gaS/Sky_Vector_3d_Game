# PROGRESS

## Commands
install: npm install
test: (none — static browser game; verify with the Playwright screenshot harness, see CLAUDE.md)
test-one: (none)
typecheck: (none)
lint: (none)
build: (none — static assets)
health: (none configured)
coverage: (none)
start: npm start
capture-demo: npm run capture-demo  (requires ffmpeg + playwright chromium)

## Health budget
N/A for single-file static HTML release.

## Baseline
Manual play-test via local server + headless Playwright screenshots; no automated test suite.

## Plan
- [x] unit 1: public release hygiene
- [x] unit 2: collision, HUD, audio, world content
- [x] unit 3: world graphics (`js/world-graphics.js`)
- [x] unit 4: ground raycast + terrain world-Z fix
- [x] unit 5: GitHub release prep (README screenshot, docs)
- [x] unit 6 (v1.2.0, 2026-07-02): full visual overhaul — sky/stars/moon, biome terrain,
      water shader, sprite clouds, ridged mountains, new airplane + vapor trails + nav
      lights, night building windows, lens flare, bloom/vignette, glass HUD, new title
      screen. Verified via headless screenshots (day/dusk/night/cockpit/crash/reset).

## Current signal state
No page errors in headless Chromium. README screenshot + gameplay.gif regenerated.
Physics/collision intentionally untouched in v1.2.0.

## Decisions / open questions
- Props use `createGroundSampler()` raycasts on terrain mesh; buildings use blended footprint height on slopes.
- Flight floor remains `terrainHeight + 35` (gameplay only, not visual prop height).
- `terrainHeight()` in index.html is gameplay-coupled (collision, AGL, prop placement) — visual work must not change it.
- Diagonal chains of ponds/inlets near the coast are an artifact of the sinusoidal terrain function; accepted as "marshland" rather than risk gameplay changes.
- `package-lock.json` gitignored; run `npm install` locally for capture-demo.

## Notes for resume
- See CLAUDE.md for architecture, the Gfx API surface, and the screenshot-verification workflow.
- README hero: `docs/assets/screenshot.png` (dusk city shot); GIF below fold.
- Version in `package.json`: 1.2.0.
