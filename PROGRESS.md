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
N/A for single-file static HTML release prep.

## Baseline
Release prep only; no automated test suite.

## Plan
- [x] unit 1: public release hygiene (.gitignore, LICENSE, package.json, README)
- [x] unit 2: clean index.html (meta, remove debug logs, branding)
- [x] unit 3: capture gameplay GIF for README

## Current signal state
test: n/a | typecheck: n/a | lint: n/a | build: n/a | manual: static server + play verified via capture script

## Decisions / open questions
- `three.js-master/` excluded from git; only `vendor/three.js` ships.
- Agent tooling (`.cursor/`, `project_config.json`, `data/`) gitignored.

## Notes for resume
- README clone URL points to `github.com/V3gaS/Sky_Vector_3d_Game`.
- Run `npm run capture-demo` after visual changes to refresh `docs/assets/gameplay.gif`.
