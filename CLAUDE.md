# SkyVector — agent notes

Browser 3D flight sim. **No build step, no framework, no modules**: `index.html` +
`js/world-graphics.js` + bundled `vendor/three.js` (Three.js r150, classic global
`THREE` build — `three.js-master/` is only the upstream source drop, nothing imports it).
Serve statically (`npm start` → python http.server 8080); `file://` won't work.

## Layout

| Path | What lives there |
| --- | --- |
| `index.html` | All game logic in one inline script: GameState, FlightModel (physics), CollisionSystem, AudioFX (Web Audio), world assembly, HUD (2D canvas), input, title-screen CSS/markup |
| `js/world-graphics.js` | `window.SkyVectorGfx` (aka `Gfx`) — rendering module: terrain mesh + biome vertex colors, water/sky shaders, post-FX, cloud sprites, mountain geometry, building facade materials, vapor trail, sun flare, tree instancing, ground raycaster |
| `scripts/capture-readme-gif.mjs` | Playwright + ffmpeg → `docs/assets/gameplay.gif` |

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
