/**
 * SkyVector mod: skyfx — night-sky drama.
 *
 * Four independent effects, all procedural and fully preallocated in init():
 *   1. Aurora borealis — 3 waving shader curtains in the northern sky.
 *   2. Shooting stars — pooled additive streaks crossing high overhead.
 *   3. Heat lightning — distant storm cells beyond the mountains that flicker.
 *   4. Fireflies — one Points cloud drifting over a coastal marsh patch.
 *
 * update() only writes uniforms, pooled transforms and typed-array attributes;
 * there are no allocations in the per-frame path. All time-of-day gating reads
 * ctx.time each frame (night 0.45+ aurora, 0.5+ stars, dusk 0.3 / night 0.6
 * lightning, night 0.4 fireflies).
 */
(function () {
    'use strict';

    function clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
    }

    function smoothstep(edge0, edge1, x) {
        const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    // ------------------------------------------------------------------ state
    let skyTime = 0;

    // aurora
    const auroras = [];              // { mesh, uniforms }

    // shooting stars
    const STAR_POOL = 6;
    const stars = [];                // { mesh, material, vel, active, age, life }
    let starTimer = 4;
    let starUp = null;               // temp Vector3 (world up axis)
    let starFlatQ = null;            // quaternion: plane -> lying flat in XZ
    let tmpQ = null;

    // heat lightning
    const BOLT_CELLS = 3;
    const boltCells = [];            // { sprite, material }
    let boltTimer = 14;
    let boltActive = false;
    let boltAge = 0;
    let boltDuration = 0.34;
    let boltCell = 0;
    let boltPeak = 0.22;

    // fireflies
    const FIREFLY_COUNT = 48;
    let fireflies = null;            // { points, posAttr, alphaAttr, sizeAttr, base, phase, freq, amp, twinkle, center }

    // ------------------------------------------------------------- aurora
    const AURORA_VERT = `
        uniform float uTime;
        uniform float uSeed;
        uniform float uAmp;
        varying vec2 vUv;
        void main() {
            vUv = uv;
            vec3 p = position;
            // three drifting sine octaves fold the curtain; folds grow toward the top
            float sway = sin(uv.x * 10.7 + uTime * 0.21 + uSeed)
                       + 0.6 * sin(uv.x * 24.5 - uTime * 0.34 + uSeed * 2.0)
                       + 0.35 * sin(uv.x * 52.0 + uTime * 0.53 + uSeed * 3.3);
            p.z += sway * uAmp * (0.35 + uv.y * 0.65);
            p.x += sway * uAmp * 0.3 * uv.y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
    `;

    const AURORA_FRAG = `
        uniform float uTime;
        uniform float uSeed;
        uniform float uMaster;
        varying vec2 vUv;
        void main() {
            vec3 green  = vec3(0.227, 1.0, 0.612);   // #3aff9c
            vec3 teal   = vec3(0.16, 0.78, 0.8);
            vec3 purple = vec3(0.541, 0.361, 1.0);   // #8a5cff
            float y = vUv.y;
            vec3 col = mix(green, teal, smoothstep(0.05, 0.45, y));
            col = mix(col, purple, smoothstep(0.38, 0.95, y));

            // bright lower rim fading upward — classic curtain profile
            float body = smoothstep(0.0, 0.06, y) * pow(1.0 - y, 1.6);
            body += smoothstep(0.0, 0.03, y) * exp(-y * 9.0) * 0.8;
            body = min(body, 1.0);

            // soft falloff at the left/right ends
            float edge = smoothstep(0.0, 0.14, vUv.x) * smoothstep(1.0, 0.86, vUv.x);

            // slow-scrolling vertical bands (rays)
            float band = 0.72 + 0.28 * sin(vUv.x * 68.0 + uSeed * 7.0 + uTime * 0.24
                       + sin(vUv.x * 19.0 - uTime * 0.11) * 1.8);

            gl_FragColor = vec4(col, body * edge * band * uMaster);
        }
    `;

    function createAurora(scene) {
        const defs = [
            { width: 12500, height: 3400, x: -1800, y: 1250, z: -14600, seed: 0.0, amp: 380 },
            { width: 9200, height: 2700, x: 3600, y: 950, z: -12800, seed: 11.7, amp: 290 },
            { width: 7600, height: 2100, x: -6400, y: 800, z: -12200, seed: 23.9, amp: 240 }
        ];
        defs.forEach((d) => {
            const geometry = new THREE.PlaneGeometry(d.width, d.height, 140, 4);
            const uniforms = {
                uTime: { value: 0 },
                uSeed: { value: d.seed },
                uAmp: { value: d.amp },
                uMaster: { value: 0 }
            };
            const material = new THREE.ShaderMaterial({
                uniforms,
                vertexShader: AURORA_VERT,
                fragmentShader: AURORA_FRAG,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(d.x, d.y + d.height * 0.5, d.z);
            mesh.visible = false;
            scene.add(mesh);
            auroras.push({ mesh, uniforms });
        });
    }

    // ------------------------------------------------------ shooting stars
    function createStreakTexture() {
        const w = 128;
        const h = 32;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx2 = canvas.getContext('2d');
        // bright head near the +X end, long fading tail behind it
        const tail = ctx2.createLinearGradient(0, 0, w, 0);
        tail.addColorStop(0, 'rgba(255,255,255,0)');
        tail.addColorStop(0.55, 'rgba(190,215,255,0.35)');
        tail.addColorStop(0.88, 'rgba(255,255,255,1)');
        tail.addColorStop(1, 'rgba(255,255,255,0)');
        ctx2.fillStyle = tail;
        ctx2.fillRect(0, 0, w, h);
        // soften the streak edges vertically
        const across = ctx2.createLinearGradient(0, 0, 0, h);
        across.addColorStop(0, 'rgba(255,255,255,0)');
        across.addColorStop(0.35, 'rgba(255,255,255,0.9)');
        across.addColorStop(0.5, 'rgba(255,255,255,1)');
        across.addColorStop(0.65, 'rgba(255,255,255,0.9)');
        across.addColorStop(1, 'rgba(255,255,255,0)');
        ctx2.globalCompositeOperation = 'destination-in';
        ctx2.fillStyle = across;
        ctx2.fillRect(0, 0, w, h);
        return new THREE.CanvasTexture(canvas);
    }

    function createStars(scene) {
        starUp = new THREE.Vector3(0, 1, 0);
        starFlatQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
        tmpQ = new THREE.Quaternion();
        const texture = createStreakTexture();
        const geometry = new THREE.PlaneGeometry(1, 1);
        for (let i = 0; i < STAR_POOL; i++) {
            const material = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                fog: false,
                opacity: 0
            });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            scene.add(mesh);
            stars.push({
                mesh,
                material,
                vel: new THREE.Vector3(),
                active: false,
                age: 0,
                life: 0.7
            });
        }
    }

    function launchStar(cameraPosition) {
        let star = null;
        for (let i = 0; i < STAR_POOL; i++) {
            if (!stars[i].active) {
                star = stars[i];
                break;
            }
        }
        if (!star) return;
        const azimuth = Math.random() * Math.PI * 2;
        const speed = 2300 + Math.random() * 900;
        star.mesh.position.set(
            cameraPosition.x + (Math.random() - 0.5) * 3200,
            Math.max(2600, cameraPosition.y + 1500) + Math.random() * 1200,
            cameraPosition.z + (Math.random() - 0.5) * 3200
        );
        // yaw about world Y maps local +X (streak head) onto the velocity
        star.vel.set(Math.cos(azimuth) * speed, -120 - Math.random() * 160, -Math.sin(azimuth) * speed);
        tmpQ.setFromAxisAngle(starUp, azimuth).multiply(starFlatQ);
        star.mesh.quaternion.copy(tmpQ);
        star.mesh.scale.set(620 + Math.random() * 280, 7 + Math.random() * 5, 1);
        star.life = 0.6 + Math.random() * 0.25;
        star.age = 0;
        star.active = true;
        star.mesh.visible = true;
        star.material.opacity = 0;
    }

    function updateStars(dt, night, cameraPosition) {
        starTimer -= dt;
        if (starTimer <= 0) {
            starTimer = 3 + Math.random() * 5;
            if (night > 0.5) launchStar(cameraPosition);
        }
        for (let i = 0; i < STAR_POOL; i++) {
            const star = stars[i];
            if (!star.active) continue;
            star.age += dt;
            const t = star.age / star.life;
            if (t >= 1) {
                star.active = false;
                star.mesh.visible = false;
                star.material.opacity = 0;
                continue;
            }
            star.mesh.position.addScaledVector(star.vel, dt);
            star.material.opacity = Math.min(t * 7, 1) * Math.pow(1 - t, 1.6) * 0.85;
        }
    }

    // ------------------------------------------------------ heat lightning
    function createBoltTexture() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx2 = canvas.getContext('2d');
        const grad = ctx2.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(235,242,255,0.85)');
        grad.addColorStop(0.25, 'rgba(190,214,255,0.4)');
        grad.addColorStop(0.6, 'rgba(140,170,255,0.12)');
        grad.addColorStop(1, 'rgba(120,150,255,0)');
        ctx2.fillStyle = grad;
        ctx2.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(canvas);
    }

    function createLightning(scene) {
        const texture = createBoltTexture();
        const baseAzimuth = Math.random() * Math.PI * 2;
        for (let i = 0; i < BOLT_CELLS; i++) {
            // fixed storm-cell azimuths, spread roughly evenly around the horizon
            const azimuth = baseAzimuth + i * (Math.PI * 2 / BOLT_CELLS) + (Math.random() - 0.5) * 0.5;
            const radius = 8200 + Math.random() * 900;
            const material = new THREE.SpriteMaterial({
                map: texture,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                fog: false,
                opacity: 0
            });
            const sprite = new THREE.Sprite(material);
            sprite.position.set(
                Math.sin(azimuth) * radius,
                420 + Math.random() * 240,
                Math.cos(azimuth) * radius
            );
            sprite.scale.set(3600 + Math.random() * 1400, 2200 + Math.random() * 700, 1);
            sprite.visible = false;
            scene.add(sprite);
            boltCells.push({ sprite, material });
        }
    }

    function boltPulse(p, center, width) {
        const x = (p - center) / width;
        return Math.max(0, 1 - x * x);
    }

    function updateLightning(dt, dusk, night) {
        const gate = Math.max(smoothstep(0.3, 0.55, dusk), smoothstep(0.6, 0.8, night));
        if (!boltActive) {
            boltTimer -= dt;
            if (boltTimer <= 0) {
                if (gate > 0.02) {
                    boltActive = true;
                    boltAge = 0;
                    boltDuration = 0.28 + Math.random() * 0.12;
                    boltPeak = (0.16 + Math.random() * 0.1) * gate;
                    boltCell = Math.floor(Math.random() * BOLT_CELLS) % BOLT_CELLS;
                    boltCells[boltCell].sprite.visible = true;
                } else {
                    // conditions not met yet — check again soon
                    boltTimer = 4 + Math.random() * 5;
                }
            }
            return;
        }
        boltAge += dt;
        const p = boltAge / boltDuration;
        const cell = boltCells[boltCell];
        if (p >= 1) {
            boltActive = false;
            cell.material.opacity = 0;
            cell.sprite.visible = false;
            boltTimer = 18 + Math.random() * 22;
            return;
        }
        // 3 decaying flickers over ~300ms
        const env = boltPulse(p, 0.1, 0.1) + 0.7 * boltPulse(p, 0.48, 0.12) + 0.5 * boltPulse(p, 0.84, 0.1);
        cell.material.opacity = env * boltPeak;
    }

    // ---------------------------------------------------------- fireflies
    function findMarshPatch(ground, waterY) {
        // coastal lowland south of the city: scan a coarse grid, favour ground
        // sitting a few units above the water table
        let bestX = 1500;
        let bestZ = 1000;
        let bestScore = Infinity;
        for (let x = 700; x <= 2300; x += 320) {
            for (let z = 300; z <= 2100; z += 300) {
                const rel = ground(x, z) - waterY;
                let score = Math.abs(rel - 6);
                if (rel < 0.5 || rel > 15) score += 50;
                if (score < bestScore) {
                    bestScore = score;
                    bestX = x;
                    bestZ = z;
                }
            }
        }
        return { x: bestX, z: bestZ };
    }

    function createFireflies(scene, ground, waterY) {
        const patch = findMarshPatch(ground, waterY);
        const R = 260;

        // 4x4 height grid over the patch, bilinearly interpolated per firefly
        // so we only pay a handful of terrain raycasts at init
        const GRID = 4;
        const step = (R * 2) / (GRID - 1);
        const heights = new Float32Array(GRID * GRID);
        for (let iz = 0; iz < GRID; iz++) {
            for (let ix = 0; ix < GRID; ix++) {
                heights[iz * GRID + ix] = ground(patch.x - R + ix * step, patch.z - R + iz * step);
            }
        }
        function sampleH(x, z) {
            const gx = clamp((x - (patch.x - R)) / step, 0, GRID - 1.001);
            const gz = clamp((z - (patch.z - R)) / step, 0, GRID - 1.001);
            const ix = Math.floor(gx);
            const iz = Math.floor(gz);
            const fx = gx - ix;
            const fz = gz - iz;
            const h00 = heights[iz * GRID + ix];
            const h10 = heights[iz * GRID + ix + 1];
            const h01 = heights[(iz + 1) * GRID + ix];
            const h11 = heights[(iz + 1) * GRID + ix + 1];
            return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
        }

        const positions = new Float32Array(FIREFLY_COUNT * 3);
        const base = new Float32Array(FIREFLY_COUNT * 3);
        const phase = new Float32Array(FIREFLY_COUNT);
        const freq = new Float32Array(FIREFLY_COUNT);
        const amp = new Float32Array(FIREFLY_COUNT);
        const twinkle = new Float32Array(FIREFLY_COUNT);
        for (let i = 0; i < FIREFLY_COUNT; i++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * R * 0.9;
            const x = patch.x + Math.cos(a) * r;
            const z = patch.z + Math.sin(a) * r;
            const y = Math.max(sampleH(x, z), waterY) + 2 + Math.random() * 6;
            base[i * 3] = positions[i * 3] = x;
            base[i * 3 + 1] = positions[i * 3 + 1] = y;
            base[i * 3 + 2] = positions[i * 3 + 2] = z;
            phase[i] = Math.random() * Math.PI * 2;
            freq[i] = 0.25 + Math.random() * 0.4;
            amp[i] = 4 + Math.random() * 6;
            twinkle[i] = 1.6 + Math.random() * 2.6;
        }

        const geometry = new THREE.BufferGeometry();
        const posAttr = new THREE.BufferAttribute(positions, 3);
        const alphaAttr = new THREE.BufferAttribute(new Float32Array(FIREFLY_COUNT), 1);
        const sizeAttr = new THREE.BufferAttribute(new Float32Array(FIREFLY_COUNT), 1);
        geometry.setAttribute('position', posAttr);
        geometry.setAttribute('aAlpha', alphaAttr);
        geometry.setAttribute('aSize', sizeAttr);
        geometry.computeBoundingSphere();
        geometry.boundingSphere.radius += 24;

        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexShader: `
                attribute float aAlpha;
                attribute float aSize;
                varying float vAlpha;
                void main() {
                    vAlpha = aAlpha;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = min(aSize * (300.0 / max(-mv.z, 1.0)), 18.0);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                void main() {
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    float glow = smoothstep(1.0, 0.0, d);
                    float core = smoothstep(0.35, 0.0, d);
                    vec3 col = vec3(0.78, 1.0, 0.36) * glow + vec3(1.0, 1.0, 0.75) * core * 0.6;
                    gl_FragColor = vec4(col, vAlpha * (glow * 0.75 + core * 0.5));
                }
            `
        });
        const points = new THREE.Points(geometry, material);
        points.visible = false;
        scene.add(points);

        fireflies = {
            points,
            posAttr,
            alphaAttr,
            sizeAttr,
            base,
            phase,
            freq,
            amp,
            twinkle,
            center: new THREE.Vector3(patch.x, sampleH(patch.x, patch.z), patch.z)
        };
    }

    function updateFireflies(night, cameraPosition) {
        const ff = fireflies;
        if (!ff) return;
        const gate = smoothstep(0.4, 0.65, night);
        if (gate <= 0.001) {
            ff.points.visible = false;
            return;
        }
        const dist = cameraPosition.distanceTo(ff.center);
        const fade = 1 - smoothstep(1000, 1300, dist);
        if (fade <= 0.001) {
            ff.points.visible = false;
            return;
        }
        ff.points.visible = true;
        const strength = gate * fade;
        const pos = ff.posAttr.array;
        const t = skyTime;
        for (let i = 0; i < FIREFLY_COUNT; i++) {
            const b = i * 3;
            const ph = ff.phase[i];
            const f = ff.freq[i];
            pos[b] = ff.base[b] + Math.sin(t * f + ph) * ff.amp[i];
            pos[b + 1] = ff.base[b + 1] + Math.sin(t * f * 0.7 + ph * 1.7) * 2.2;
            pos[b + 2] = ff.base[b + 2] + Math.cos(t * f * 0.83 + ph * 0.6) * ff.amp[i];
            const tw = 0.5 + 0.5 * Math.sin(t * ff.twinkle[i] + ph * 3.1);
            const glow = tw * tw;
            ff.alphaAttr.array[i] = (0.25 + glow * 0.75) * strength;
            ff.sizeAttr.array[i] = 7 + glow * 9;
        }
        ff.posAttr.needsUpdate = true;
        ff.alphaAttr.needsUpdate = true;
        ff.sizeAttr.needsUpdate = true;
    }

    // -------------------------------------------------------------- module
    const mod = {
        name: 'skyfx',

        init(ctx) {
            if (typeof THREE === 'undefined' || !ctx || !ctx.scene) return;
            createAurora(ctx.scene);
            createStars(ctx.scene);
            createLightning(ctx.scene);
            createFireflies(ctx.scene, ctx.ground, ctx.waterY);
        },

        update(dt, ctx) {
            if (auroras.length === 0) return;   // init never ran
            if (dt > 0.1) dt = 0.1;
            skyTime += dt;
            const night = ctx.time.night;
            const dusk = ctx.time.dusk;

            // aurora: appears from night ~0.45, peak alpha 0.35 deep at night
            const master = smoothstep(0.45, 0.8, night) * 0.35;
            for (let i = 0; i < auroras.length; i++) {
                auroras[i].uniforms.uTime.value = skyTime;
                auroras[i].uniforms.uMaster.value = master;
                auroras[i].mesh.visible = master > 0.003;
            }

            updateStars(dt, night, ctx.camera.position);
            updateLightning(dt, dusk, night);
            updateFireflies(night, ctx.camera.position);
        }
    };

    (window.SkyVectorMods = window.SkyVectorMods || []).push(mod);
})();
