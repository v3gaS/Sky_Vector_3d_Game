/**
 * SkyVector challenges — three ring-race courses (window.SkyVectorMods module).
 *
 *   Digit1  HARBOR RUN    8 rings, descending arc over the SW bay to the city outskirts
 *   Digit2  CITY SLALOM   9 rings threading the city street canyons
 *   Digit3  SUMMIT CLIMB  7 rings climbing out through the mountain-ring summit gap
 *   Digit0 / Escape       cancel the active race
 *
 * Everything is placed/cached at init (terrain raycasts + real building boxes);
 * the per-frame path allocates nothing and touches at most 9 rings.
 */
(function () {
    'use strict';

    const RING_RADIUS = 30;
    const RING_TUBE = 2.4;
    const PASS_RADIUS = RING_RADIUS * 1.15;
    const MIN_GROUND_CLEAR = 60;
    const BOX_CLEARANCE = RING_TUBE + 3;
    const FADE_SECONDS = 1.4;
    const RESULT_SECONDS = 4;
    const BEST_KEY_PREFIX = 'svx-best-';

    const STATE_IDLE = 0;
    const STATE_ARMED = 1;      // course selected, timer starts at first ring
    const STATE_RUNNING = 2;
    const STATE_FINISHED = 3;   // result panel showing, auto-clears

    // Ring targets as [x, z, altitudeY]. Altitudes were tuned against the game's
    // deterministic terrain/city layout; init() still re-validates every ring with
    // live terrain raycasts and the real building bounding boxes and raises any
    // ring that would sit closer than BOX_CLEARANCE to a building or < 60u AGL.
    const COURSE_DEFS = [
        {
            name: 'HARBOR RUN',
            rings: [
                [0, -600, 350], [-210, -1030, 325], [-360, -1480, 300],
                [-330, -1950, 275], [-60, -2280, 252], [420, -2280, 238],
                [870, -1950, 230], [1260, -1430, 224]
            ]
        },
        {
            name: 'CITY SLALOM',
            rings: [
                [830, -601, 420], [1057.5, -601, 355], [1287.5, -601, 350],
                [1517.5, -428, 460], [1747.5, -256, 372], [1862.5, -256, 360],
                [2010, -220, 395], [2150, -165, 440], [2295, -105, 480]
            ]
        },
        {
            name: 'SUMMIT CLIMB',
            rings: [
                [-195, -2050, 250], [-265, -2800, 350], [-330, -3480, 460],
                [-390, -3960, 580], [-430, -4330, 720], [-1020, -4940, 750],
                [-180, -4360, 700]
            ]
        }
    ];

    let courses = null;         // built once in init()
    let pillar = null;
    let pillarMat = null;
    let state = STATE_IDLE;
    let activeIndex = -1;
    let nextRing = 0;
    let elapsed = 0;
    let finalTime = 0;
    let resultTimer = 0;
    let newBest = false;
    let pulse = 0;
    let sideValid = false;      // prevSide/_prevPos refer to the armed ring
    let prevSide = 0;
    const bestTimes = [null, null, null];

    // hoisted temps — allocated once in init(), reused every frame
    let _vA = null;
    let _vB = null;
    let _vC = null;
    let _prevPos = null;
    let _colPulse = null;
    let _cyan = null;
    let _gold = null;
    let _dimBlue = null;

    function formatTime(t) {
        if (typeof t !== 'number' || !isFinite(t)) return '--:--.-';
        const total = Math.max(0, t);
        const m = Math.floor(total / 60);
        const s = Math.floor(total - m * 60);
        const tenths = Math.floor((total - m * 60 - s) * 10);
        return (m < 10 ? '0' + m : '' + m) + ':' + (s < 10 ? '0' + s : '' + s) + '.' + tenths;
    }

    function loadBestTimes() {
        for (let i = 0; i < 3; i++) {
            try {
                const raw = localStorage.getItem(BEST_KEY_PREFIX + i);
                const value = raw === null ? NaN : parseFloat(raw);
                bestTimes[i] = isFinite(value) && value > 0 ? value : null;
            } catch (err) {
                bestTimes[i] = null;
            }
        }
    }

    function saveBestTime(index, value) {
        try {
            localStorage.setItem(BEST_KEY_PREFIX + index, String(value));
        } catch (err) {
            // storage unavailable (private mode) — best time lives for the session only
        }
    }

    // ---------------------------------------------------------------- textures

    function makeGlowTexture(T) {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const g = canvas.getContext('2d');
        const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(0.22, 'rgba(175,230,255,0.42)');
        grad.addColorStop(0.55, 'rgba(95,175,255,0.12)');
        grad.addColorStop(1, 'rgba(60,140,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
        return new T.CanvasTexture(canvas);
    }

    function makePillarTexture(T) {
        const w = 32;
        const h = 256;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const g = canvas.getContext('2d');
        const vert = g.createLinearGradient(0, 0, 0, h);
        vert.addColorStop(0, 'rgba(140,225,255,0)');
        vert.addColorStop(0.35, 'rgba(160,232,255,0.55)');
        vert.addColorStop(0.5, 'rgba(215,245,255,0.85)');
        vert.addColorStop(0.65, 'rgba(160,232,255,0.55)');
        vert.addColorStop(1, 'rgba(140,225,255,0)');
        g.fillStyle = vert;
        g.fillRect(0, 0, w, h);
        // soften the vertical edges so the pillar reads as a beam, not a card
        const horiz = g.createLinearGradient(0, 0, w, 0);
        horiz.addColorStop(0, 'rgba(255,255,255,0)');
        horiz.addColorStop(0.5, 'rgba(255,255,255,1)');
        horiz.addColorStop(1, 'rgba(255,255,255,0)');
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = horiz;
        g.fillRect(0, 0, w, h);
        return new T.CanvasTexture(canvas);
    }

    // ------------------------------------------------------------- placement

    function collectBuildingBoxes(ctx) {
        // Buildings are the only meshes tagged with userData.sideMat (see
        // Gfx.createBuildingMaterials usage in index.html).
        const boxes = [];
        const box = new ctx.THREE.Box3();
        ctx.scene.traverse(function (obj) {
            if (obj.isMesh && obj.userData && obj.userData.sideMat) {
                box.setFromObject(obj);
                boxes.push({
                    x0: box.min.x, x1: box.max.x,
                    y0: box.min.y, y1: box.max.y,
                    z0: box.min.z, z1: box.max.z
                });
            }
        });
        return boxes;
    }

    function ringTouchesBoxes(p, nx, nz, boxes) {
        // Sample the torus centerline circle; the ring faces (nx, 0, nz), so the
        // circle spans up=(0,1,0) and the horizontal perpendicular (-nz, 0, nx).
        for (let s = 0; s < 24; s++) {
            const a = s / 24 * Math.PI * 2;
            const px = p.x - RING_RADIUS * Math.sin(a) * nz;
            const py = p.y + RING_RADIUS * Math.cos(a);
            const pz = p.z + RING_RADIUS * Math.sin(a) * nx;
            for (let b = 0; b < boxes.length; b++) {
                const bx = boxes[b];
                if (px > bx.x0 - BOX_CLEARANCE && px < bx.x1 + BOX_CLEARANCE &&
                    py > bx.y0 - BOX_CLEARANCE && py < bx.y1 + BOX_CLEARANCE &&
                    pz > bx.z0 - BOX_CLEARANCE && pz < bx.z1 + BOX_CLEARANCE) {
                    return true;
                }
            }
        }
        return false;
    }

    function resolveRingHeights(positions, boxes) {
        // Raise any ring whose hoop would come within BOX_CLEARANCE of a building.
        for (let i = 0; i < positions.length; i++) {
            const p = positions[i];
            const prev = positions[Math.max(0, i - 1)];
            const next = positions[Math.min(positions.length - 1, i + 1)];
            let nx = next.x - prev.x;
            let nz = next.z - prev.z;
            const len = Math.sqrt(nx * nx + nz * nz) || 1;
            nx /= len;
            nz /= len;
            let guard = 0;
            while (guard++ < 120 && ringTouchesBoxes(p, nx, nz, boxes)) {
                p.y += 6;
            }
        }
    }

    // ------------------------------------------------------------ world build

    function buildCourses(ctx) {
        const T = ctx.THREE;
        const torusGeo = new T.TorusGeometry(RING_RADIUS, RING_TUBE, 12, 44);
        const glowTex = makeGlowTexture(T);
        const boxes = collectBuildingBoxes(ctx);
        const built = [];
        for (let c = 0; c < COURSE_DEFS.length; c++) {
            const def = COURSE_DEFS[c];
            const group = new T.Group();
            group.visible = false;
            ctx.scene.add(group);

            const positions = [];
            for (let i = 0; i < def.rings.length; i++) {
                const r = def.rings[i];
                let y = r[2];
                const groundY = ctx.ground(r[0], r[1]);
                if (typeof groundY === 'number' && isFinite(groundY)) {
                    y = Math.max(y, groundY + MIN_GROUND_CLEAR);
                }
                y = Math.max(y, ctx.waterY + 50);
                positions.push(new T.Vector3(r[0], y, r[1]));
            }
            resolveRingHeights(positions, boxes);

            const rings = [];
            for (let i = 0; i < positions.length; i++) {
                const prev = positions[Math.max(0, i - 1)];
                const next = positions[Math.min(positions.length - 1, i + 1)];
                const normal = new T.Vector3().subVectors(next, prev).normalize();
                const mat = new T.MeshStandardMaterial({
                    color: 0x12222f,
                    emissive: 0x2f5fd8,
                    emissiveIntensity: 0.4,
                    roughness: 0.35,
                    metalness: 0.4,
                    transparent: true,
                    opacity: 0.92
                });
                const torus = new T.Mesh(torusGeo, mat);
                torus.position.copy(positions[i]);
                _vA.copy(positions[i]).add(normal);
                torus.lookAt(_vA);
                group.add(torus);

                const glowMat = new T.SpriteMaterial({
                    map: glowTex,
                    color: 0x2f5fd8,
                    blending: T.AdditiveBlending,
                    transparent: true,
                    depthWrite: false,
                    fog: false,
                    opacity: 0.12
                });
                const glow = new T.Sprite(glowMat);
                glow.scale.set(76, 76, 1);
                glow.position.copy(positions[i]);
                group.add(glow);

                rings.push({ pos: positions[i], normal, torus, mat, glow, glowMat, fade: 1 });
            }
            built.push({ name: def.name, rings, group });
        }
        return built;
    }

    function buildPillar(ctx) {
        const T = ctx.THREE;
        pillarMat = new T.MeshBasicMaterial({
            map: makePillarTexture(T),
            color: 0x8fe2ff,
            transparent: true,
            opacity: 0.14,
            blending: T.AdditiveBlending,
            depthWrite: false,
            side: T.DoubleSide,
            fog: false
        });
        const geo = new T.PlaneGeometry(26, 1500);
        pillar = new T.Group();
        const sheetA = new T.Mesh(geo, pillarMat);
        const sheetB = new T.Mesh(geo, pillarMat);
        sheetB.rotation.y = Math.PI / 2;
        pillar.add(sheetA);
        pillar.add(sheetB);
        pillar.visible = false;
        ctx.scene.add(pillar);
    }

    // ------------------------------------------------------------------ audio

    function tone(ac, freq, when, dur, vol, type) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, when);
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(vol, when + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(when);
        osc.stop(when + dur + 0.05);
    }

    function playSelectBlip(ctx) {
        const ac = ctx.audio();
        if (!ac) return;
        const now = ac.currentTime;
        tone(ac, 660, now, 0.12, 0.04, 'sine');
        tone(ac, 990, now + 0.06, 0.14, 0.035, 'sine');
    }

    function playRingChime(ctx) {
        const ac = ctx.audio();
        if (!ac) return;
        const now = ac.currentTime;
        tone(ac, 920, now, 0.16, 0.06, 'triangle');
        tone(ac, 1380, now + 0.06, 0.2, 0.05, 'triangle');
    }

    function playFinishFanfare(ctx, gotBest) {
        const ac = ctx.audio();
        if (!ac) return;
        const now = ac.currentTime;
        tone(ac, 659.26, now, 0.3, 0.05, 'triangle');
        tone(ac, 830.61, now + 0.11, 0.3, 0.05, 'triangle');
        tone(ac, 987.77, now + 0.22, 0.3, 0.05, 'triangle');
        tone(ac, 1318.51, now + 0.33, 0.42, 0.05, 'triangle');
        if (gotBest) {
            tone(ac, 1661.22, now + 0.52, 0.4, 0.045, 'sine');
            tone(ac, 1975.53, now + 0.64, 0.5, 0.04, 'sine');
        }
    }

    // ------------------------------------------------------------- race state

    function clearCourse() {
        if (activeIndex >= 0 && courses) {
            courses[activeIndex].group.visible = false;
        }
        if (pillar) pillar.visible = false;
        state = STATE_IDLE;
        activeIndex = -1;
        sideValid = false;
    }

    function selectCourse(index, ctx) {
        clearCourse();
        activeIndex = index;
        nextRing = 0;
        elapsed = 0;
        finalTime = 0;
        newBest = false;
        state = STATE_ARMED;
        sideValid = false;
        const rings = courses[index].rings;
        for (let i = 0; i < rings.length; i++) {
            rings[i].fade = 1;
            rings[i].torus.visible = true;
            rings[i].glow.visible = true;
        }
        courses[index].group.visible = true;
        _prevPos.copy(ctx.plane.position);
        playSelectBlip(ctx);
    }

    function finishRace(ctx) {
        state = STATE_FINISHED;
        resultTimer = RESULT_SECONDS;
        const previous = bestTimes[activeIndex];
        newBest = typeof previous !== 'number' || finalTime < previous;
        if (newBest) {
            bestTimes[activeIndex] = finalTime;
            saveBestTime(activeIndex, finalTime);
        }
        playFinishFanfare(ctx, newBest);
    }

    function passRing(ctx, f, dt) {
        // f = fraction of this frame's motion at which the ring plane was crossed
        if (state === STATE_ARMED) {
            state = STATE_RUNNING;
            elapsed = (1 - f) * dt;         // timer starts exactly at the crossing
        }
        nextRing++;
        sideValid = false;
        if (nextRing >= courses[activeIndex].rings.length) {
            finalTime = Math.max(0, elapsed - (1 - f) * dt);
            finishRace(ctx);
        } else {
            playRingChime(ctx);
        }
    }

    function animateRings(dt) {
        const rings = courses[activeIndex].rings;
        const k = 0.5 + 0.5 * Math.sin(pulse * 5.2);
        _colPulse.copy(_cyan).lerp(_gold, k);
        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            if (i < nextRing || state === STATE_FINISHED) {
                // passed (or race over) — fade away
                ring.fade = Math.max(0, ring.fade - dt / FADE_SECONDS);
                ring.mat.opacity = 0.92 * ring.fade;
                ring.mat.emissiveIntensity = 0.5 * ring.fade;
                ring.glowMat.opacity = 0.25 * ring.fade;
                const visible = ring.fade > 0.01;
                ring.torus.visible = visible;
                ring.glow.visible = visible;
            } else if (i === nextRing) {
                // armed ring — cyan/gold pulse
                ring.mat.emissive.copy(_colPulse);
                ring.mat.emissiveIntensity = 0.95 + 0.75 * k;
                ring.mat.opacity = 1;
                ring.glowMat.color.copy(_colPulse);
                ring.glowMat.opacity = 0.32 + 0.34 * k;
                const s = 76 * (1 + 0.16 * k);
                ring.glow.scale.set(s, s, 1);
            } else {
                // upcoming — dim blue
                ring.mat.emissive.copy(_dimBlue);
                ring.mat.emissiveIntensity = 0.4;
                ring.mat.opacity = 0.9;
                ring.glowMat.color.copy(_dimBlue);
                ring.glowMat.opacity = 0.12;
            }
        }
        const hasTarget = state !== STATE_FINISHED && nextRing < rings.length;
        pillar.visible = hasTarget;
        if (hasTarget) {
            pillar.position.copy(rings[nextRing].pos);
            pillar.rotation.y += dt * 0.5;
            pillarMat.opacity = 0.1 + 0.08 * k;
        }
    }

    // -------------------------------------------------------------- HUD bits

    function drawChevron(g2, cx, cy, rel, color) {
        g2.save();
        g2.translate(cx, cy);
        g2.rotate(rel);
        g2.beginPath();
        g2.moveTo(0, -11);
        g2.lineTo(8, 9);
        g2.lineTo(0, 4);
        g2.lineTo(-8, 9);
        g2.closePath();
        g2.fillStyle = color;
        g2.fill();
        g2.restore();
    }

    // ------------------------------------------------------------------- mod

    const mod = {
        name: 'challenges',

        init(ctx) {
            if (courses) return;                    // guard against double init
            const T = ctx.THREE;
            _vA = new T.Vector3();
            _vB = new T.Vector3();
            _vC = new T.Vector3();
            _prevPos = new T.Vector3();
            _colPulse = new T.Color();
            _cyan = new T.Color(0x5ce4ff);
            _gold = new T.Color(0xffd685);
            _dimBlue = new T.Color(0x2f5fd8);
            loadBestTimes();
            courses = buildCourses(ctx);
            buildPillar(ctx);
        },

        update(dt, ctx) {
            if (!courses || state === STATE_IDLE) return;
            pulse += dt;
            const plane = ctx.plane;

            if (state === STATE_FINISHED) {
                resultTimer -= dt;
                animateRings(dt);
                if (resultTimer <= 0 || !plane.isPlaying) {
                    clearCourse();
                }
                return;
            }

            if (!plane.isPlaying || plane.crashed) {
                clearCourse();                      // crashing aborts the race
                return;
            }

            // a teleport (host R-reset) is not flight — abort rather than count the
            // jump as a flown segment or keep the timer running from spawn
            if (_prevPos && sideValid) {
                _vA.subVectors(plane.position, _prevPos);
                if (_vA.lengthSq() > 300 * 300) {
                    clearCourse();
                    return;
                }
            }

            if (state === STATE_RUNNING) {
                elapsed += dt;
            }

            // pass detection against the armed ring only
            const target = courses[activeIndex].rings[nextRing];
            _vA.subVectors(plane.position, target.pos);
            const side = _vA.dot(target.normal);
            let crossed = false;
            if (sideValid && (side > 0) !== (prevSide > 0)) {
                const f = prevSide / (prevSide - side);
                _vB.copy(_prevPos).lerp(plane.position, f);
                _vC.subVectors(_vB, target.pos);
                _vC.addScaledVector(target.normal, -_vC.dot(target.normal));
                if (_vC.lengthSq() <= PASS_RADIUS * PASS_RADIUS) {
                    passRing(ctx, f, dt);
                    crossed = true;
                }
            }
            if (!crossed) {
                prevSide = side;
                sideValid = true;
            }
            _prevPos.copy(plane.position);

            animateRings(dt);
        },

        drawHUD(hud, ctx) {
            if (!courses || state === STATE_IDLE || !ctx.plane.isPlaying) return;
            const g2 = hud.ctx2d;
            const course = courses[activeIndex];
            const centerX = hud.w / 2;
            const top = 146;                        // clear of the compass + heading pill

            if (state === STATE_FINISHED) {
                const w = 340;
                const x = centerX - w / 2;
                hud.panel(x, top, w, 86, 12);
                g2.save();
                g2.textAlign = 'center';
                g2.fillStyle = hud.colors.label;
                g2.font = '600 11px ' + hud.mono;
                g2.fillText(course.name + '  ·  FINISHED', centerX, top + 22);
                if (!newBest) {
                    g2.fillText('BEST ' + formatTime(bestTimes[activeIndex]), centerX, top + 74);
                }
                g2.restore();
                hud.glow(formatTime(finalTime), centerX, top + 52, '700 26px ' + hud.mono, hud.colors.accent, 14);
                if (newBest) {
                    hud.glow('NEW BEST', centerX, top + 74, '700 13px ' + hud.mono, hud.colors.warn, 12);
                }
                return;
            }

            // slim race strip: name · ring i/N · timer · best · bearing chevron
            const w = 490;
            const h = 58;
            const x = centerX - w / 2;
            hud.panel(x, top, w, h, 12);
            hud.label(course.name, x + 16, top + 21);
            hud.label('TIME', x + 196, top + 21);
            hud.label('BEST', x + 320, top + 21);

            const total = course.rings.length;
            g2.fillStyle = hud.colors.value;
            g2.font = '700 15px ' + hud.mono;
            g2.fillText('RING ' + Math.min(nextRing + 1, total) + '/' + total, x + 16, top + 45);

            g2.fillStyle = state === STATE_RUNNING ? hud.colors.accent : hud.colors.value;
            g2.font = '700 20px ' + hud.mono;
            g2.fillText(formatTime(state === STATE_RUNNING ? elapsed : 0), x + 196, top + 46);

            g2.fillStyle = hud.colors.label;
            g2.font = '600 13px ' + hud.mono;
            g2.fillText(formatTime(bestTimes[activeIndex]), x + 320, top + 45);

            // bearing to the armed ring, relative to the plane's heading
            const target = course.rings[nextRing];
            const p = ctx.plane.position;
            const fwd = ctx.plane.forward;
            const right = ctx.plane.right;
            const dx = target.pos.x - p.x;
            const dy = target.pos.y - p.y;
            const dz = target.pos.z - p.z;
            const rel = Math.atan2(dx * right.x + dz * right.z, dx * fwd.x + dz * fwd.z);
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const chevX = x + w - 46;
            drawChevron(g2, chevX, top + 27, rel, hud.colors.accent);
            g2.save();
            g2.textAlign = 'center';
            g2.fillStyle = hud.colors.label;
            g2.font = '600 10px ' + hud.mono;
            g2.fillText(Math.round(dist) + ' m', chevX, top + 50);
            g2.restore();
        },

        onKey(code, ctx) {
            if (!courses || !ctx.plane.isPlaying) return false;
            if (code === 'Digit0' || code === 'Escape') {
                if (state === STATE_IDLE) return false;
                clearCourse();                      // cancel race / dismiss result
                return true;
            }
            if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') {
                if (state === STATE_FINISHED) return false;   // let the result clear first
                if (ctx.plane.crashed) return false;
                selectCourse(code === 'Digit1' ? 0 : code === 'Digit2' ? 1 : 2, ctx);
                return true;
            }
            return false;
        }
    };

    (window.SkyVectorMods = window.SkyVectorMods || []).push(mod);
})();
