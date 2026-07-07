# SkyVector — agent notes

Browser 3D flight sim. **No build step, no framework, no modules**: `index.html` +
`js/world-graphics.js` + bundled `vendor/three.js` (Three.js r150, classic global
`THREE` build — `three.js-master/` is only the upstream source drop, nothing imports it).
Serve statically (`npm start` → python http.server 8080); `file://` won't work.

## Layout

| Path | What lives there |
| --- | --- |
| `index.html` | Core game in one inline script: GameState, FlightModel (physics), CollisionSystem, AudioFX (Web Audio), world assembly, HUD (2D canvas), input, gamepad, module host (`initModules`/`drawModuleHUDs`/onKey dispatch), god-ray sun tracking, crash orbit cam, title screen |
| `js/world-graphics.js` | `window.SkyVectorGfx` (aka `Gfx`) — rendering module: terrain mesh + biome vertex colors, water/sky shaders, post-FX (bloom/vignette/god rays), cloud sprites, mountain geometry, building facade materials, vapor trail, sun flare, tree instancing, ground raycaster |
| `js/challenges.js` | Module: 3 ring-race courses, timing, localStorage best times (`svx-best-0/1/2`), race HUD strip |
| `js/ambient.js` | Module: bird boids, balloons, AI gliders, runway/beacon/tower night lights |
| `js/skyfx.js` | Module: aurora curtains, shooting stars, heat lightning, fireflies |
| `js/soundtrack.js` | Module: generative Web Audio score, M mute, crash duck |
| `scripts/capture-readme-gif.mjs` | Playwright + ffmpeg → `docs/assets/gameplay.gif` |

## Module system (v1.3.0)

Feature modules are plain IIFE scripts that push `{ name, init(ctx), update(dt, ctx),
drawHUD(hud, ctx)?, onKey(code, ctx)? }` onto `window.SkyVectorMods`. Script tags load
after `world-graphics.js`, before the inline game script. The host (index.html):

- `initModules()` builds `modCtx` (THREE, scene, camera, Gfx, `ground(x,z)` raycast,
  `waterY`, `world` layout facts, live-getter `plane` view, shared `time` object,
  `audio()` accessor) and calls each `init` in a try/catch — a throwing module is
  disabled, not fatal.
- `update(dt, ctx)` runs each frame while playing (so module clocks pause with the game);
  `drawHUD(hud, ctx)` gets the glass-panel helpers (`panel/label/glow/mono/colors`);
  `onKey` fires on non-repeat keydown, first-consumer-wins, ordered by script-tag order
  (challenges → ambient → skyfx → soundtrack), BEFORE the host's own P/V/R handling.
- Contract details modules rely on: `ctx.plane.position/forward/...` are live Vector3
  references; scalars are getters; `ctx.time` is mutated by `updateDayNight` every frame;
  `ctx.ground` raycasts (init-time only by convention — never per frame).
- Races consume Escape/Digit0-3 while active. Music is unmuted by default at master 0.14.
- Photo mode (`hudHidden`, KeyP) suppresses module HUDs too (crash overlay still shows).

## Verification workflow (do this after any visual/logic change)

Playwright is in `node_modules` (import it by absolute path from scripts outside the
repo). Pattern: serve the folder with `node:http`, `page.keyboard.press('Space')` to
start, fly via `page.mouse.move` / `keyboard.down`, screenshot, and collect
`pageerror`/console errors. Day/night cycle is ~55 s (`timeOfDay += dt * 0.018`, starts
at t=0.32): wait ~14 s for dusk, ~23 s for night. Check dusk AND night — several bugs
only show there. `npm run capture-demo` refreshes the README GIF (needs ffmpeg on PATH).

## Coupling map (what breaks what)

- `terrainHeight(x, z)` in index.html is **gameplay + visuals**: it shapes the rendered
  mesh, and collision/AGL/prop placement all flow from that mesh via
  `Gfx.createGroundSampler` raycasts. Changing it moves the city/runways and alters
  difficulty. Don't touch for visual work.
- `updateDayNight()` (index.html) drives `Gfx.updateSkyAndFog`, light intensities,
  water color dimming, building-window emissive, and the sun flare. Sky/water/fog
  uniforms are shared objects — `updateSkyAndFog` writes into them each frame, so
  hand-set uniform values will be overwritten.
- `Gfx.SUN_DIR` is mutated every frame by `updateDayNight` (sun elevation follows day).
  Sky, water, and flare all read it.
- Buildings: `Gfx.createBuildingMaterials(seed)` returns 6 materials for BoxGeometry;
  the shared side material is stored on `mesh.userData.sideMat` and its
  `emissiveIntensity` is animated at night. Each building has unique canvas textures.
- HUD label letter-spacing uses U+200A hair spaces in `hudLabel()` (canvas has no
  letter-spacing) — invisible in editors, don't "clean up".
- Vapor trail spawns from `wingTipLocal` (±19.2, 0.9, 2.1) — matches the wing meshes in
  `createAirplane()`; move wings → update these.
- r150 quirks used: `renderer.outputEncoding = sRGBEncoding`, `InstancedMesh.setColorAt`.
  No examples/jsm post-processing available (standalone build) — post-FX is a hand-rolled
  single-pass shader in `Gfx.createPostFX` (bloom taps + vignette + grade).

## Tuning cheatsheet (v1.2.0 visual overhaul)

- Trail look: `createVaporTrail` (life 2.6 s, alpha 0.2·(1−t)², point cap 30 px) and
  spawn strength in `updateAirplane` (`0.12 + |roll|·1.4`, needs speed >105).
- Bloom/vignette/saturation: uniforms in `Gfx.createPostFX`.
- Biome palette: `BIOME` table + blend thresholds in `paintTerrainVertices`
  (sand band `waterSurface+4..+26`, rock slope `0.28..0.55`, snow `136..158`).
- Day/night palettes: `updateSkyAndFog` (sky/fog/glow), `updateDayNight`
  (light intensities, water dim factor `0.22 + day·0.78`).
- Cloud density/size: `createCloudField(scene, count)` — 34 clusters, puff scale
  420–940, baseOpacity 0.4–0.66, distance fade in `updateCloudsForCamera`.

## Known accepted quirks

- Diagonal pond/inlet chains near the coast: artifact of the sinusoidal terrain —
  accepted (reads as marshland); fixing means changing gameplay-coupled terrain.
- `AGENTS.md` is a generic build-loop policy document, not project facts.
- Audio only starts after user gesture (Space/click) — AudioContext resume.
- Ambient/skyfx objects are visual-only (no CollisionSystem registration for modules) —
  you fly through birds, balloons, gliders, rings' pillars, beacon tower.
- Aurora sits ~12-15 km north (-Z); from the far south of the map it reads subtler.
- `Gfx.SUN_DIR` elevation now follows the day (`0.09 + day*0.75` in `updateDayNight`) —
  the sun sets/rises near the horizon; god-ray strength is tied to facing it.
- v1.3.0 sequence for takeoff-adjacent work: `initModules()` must run after the world
  is built (challenges raycasts terrain + traverses buildings; ambient places lights).
- Module init performs ~300 one-time terrain raycasts (no BVH in r150) — a small load
  stall accepted by design; NEVER call `ctx.ground` per frame.
- Adversarially reviewed 2026-07-06 (46-agent workflow): fixed gamepad input latching,
  crash-cam obstacle clearance + cockpit-crash visibility, module hotkeys while crashed,
  night god-ray gating, race teleport aborts, balloon/bird city avoidance, hidden-tab
  audio suspend. Soak: 60fps, +2.3MB heap over 100s, zero page errors.
