# Changelog

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
