# Changelog

## [1.2.0] — 2026-07-02

Visual overhaul across the whole game — no gameplay/physics changes.

### Added
- Wingtip vapor trails (shader point pool, stronger while banking)
- Stars and moon at night; golden-hour sky at both sunrise and sunset
- Lit building windows at night via per-building canvas map + emissiveMap
- Sun lens-flare sprite; per-instance tree crown color variation
- Navigation lights (port red / starboard green / blinking tail strobe) and propeller blur disk
- Vignette and resolution-aware two-ring bloom in post-FX
- Dynamic camera FOV with speed

### Changed
- Sky shader: horizon haze band, dual sun glow lobes, crisper sun disc
- Terrain colors: smooth-blended biomes (beach/meadow/alpine/rock/snow) with valley shading and dither
- Water shader: three-octave waves, fresnel sky reflection, sun glint + micro-sparkle, distance-flattened normals, day/night dimming
- Clouds rebuilt as soft billboard sprite clusters (was overlapping opaque spheres)
- Mountains rebuilt as noise-displaced ridged cones with strata/snow vertex colors
- Airplane rebuilt: tapered white fuselage, crimson accents, glass canopy, swept wings and fin
- HUD restyled: glass panels, combined flight-data block, tick-mark compass with upright cardinals, gridded minimap with heading triangle, glow warnings, crash dialog
- Title screen redesigned: dusk gradient, ridge silhouettes, glass card, keycap controls grid
- Night lighting darkened substantially (terrain silhouettes at night)

### Fixed
- `meshTerrainHeight` referenced undefined `x`/`z` (fallback path crash)
- Minimap player marker now points along heading
- Buildings previously shared one material, so per-building night emissive never varied

## [1.1.0] — 2026-06-03

### Added
- Obstacle collision (buildings, towers, trees, mountains) with crash recovery
- Full HUD: AGL, attitude panel, top-center compass, mini-map, warnings
- `js/world-graphics.js`: vertex terrain, animated water, sky/sun, post-FX, instanced trees, roads, day/night lights
- Web Audio: engine, wind, stall, scrape, splash, crash
- Raycast terrain grounding for all world props
- README screenshot and updated documentation

### Changed
- City relocated to dry terrain (~1400, -600); runways placed clear of city
- Second runway moved to (2500, -1500)
- Building placement uses blended footprint sampling on slopes

### Fixed
- Terrain mesh world Z coordinate vs prop placement mismatch
- Trees and structures floating above visible ground
- Runway overlapping city

## [1.0.0] — Initial public release

- Browser-based Three.js flight simulator with procedural terrain and arcade controls
