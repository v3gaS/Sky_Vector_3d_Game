# PROGRESS

## Commands
install: npm install
test: (none — static browser game)
test-one: (none)
typecheck: (none)
lint: (none)
build: (none — static assets)
health: (none configured)
coverage: (none)
start: npm start
capture-demo: npm run capture-demo

## Health budget
N/A for single-file static HTML release.

## Baseline
Manual play-test via local server; no automated test suite.

## Plan
- [x] unit 1: public release hygiene
- [x] unit 2: collision, HUD, audio, world content
- [x] unit 3: world graphics (`js/world-graphics.js`)
- [x] unit 4: ground raycast + terrain world-Z fix
- [x] unit 5: GitHub release prep (README screenshot, docs)

## Current signal state
test: n/a | typecheck: n/a | lint: n/a | build: n/a | manual: verify after pull — city ~1400,-600, hard refresh

## Decisions / open questions
- Props use `createGroundSampler()` raycasts on terrain mesh; buildings use blended footprint height on slopes.
- Flight floor remains `terrainHeight + 35` (gameplay only, not visual prop height).
- `package-lock.json` gitignored; run `npm install` locally for capture-demo.

## Notes for resume
- README hero: `docs/assets/screenshot.png`; GIF optional below fold.
- Run `npm run capture-demo` to refresh `docs/assets/gameplay.gif` after visual changes.
- Version in `package.json`: 1.1.0.
