/**
 * SkyVector ambient module — living-world ambience.
 *
 * Adds: coastal bird flocks (boids-lite over wandering anchor waypoints),
 * drifting hot-air balloons with a night burner glow, two AI gliders on fixed
 * circuits trailing vapor, runway edge/threshold lighting with a rotating
 * white/green airport beacon, and blinking red strobes on the radio-tower tops.
 *
 * Purely visual — nothing here registers with the collision system.
 * Every ctx.ground() raycast happens once inside init(); the per-frame path
 * allocates nothing (all Vector3/Quaternion/Matrix4 temps are hoisted).
 */
(function () {
    'use strict';

    const TWO_PI = Math.PI * 2;

    function clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
    }

    function smoothstep(edge0, edge1, x) {
        const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    // ---- hoisted per-frame temps (no allocations inside update) ----
    // Assigned in initTemps() so this file only needs THREE once init() runs.
    let _vecA, _vecB, _vecC, _steer, _centroid;
    let _quat, _quatBank, _scale, _mat4, _up, _axisZ;

    function initTemps(THREE) {
        _vecA = new THREE.Vector3();
        _vecB = new THREE.Vector3();
        _vecC = new THREE.Vector3();
        _steer = new THREE.Vector3();
        _centroid = new THREE.Vector3();
        _quat = new THREE.Quaternion();
        _quatBank = new THREE.Quaternion();
        _scale = new THREE.Vector3();
        _mat4 = new THREE.Matrix4();
        _up = new THREE.Vector3(0, 1, 0);
        _axisZ = new THREE.Vector3(0, 0, 1);
    }

    let clock = 0;

    // ============================== birds ==============================

    const FLOCK_COUNT = 3;
    const FLOCK_SIZE = 22;
    const BIRD_COUNT = FLOCK_COUNT * FLOCK_SIZE;
    const BIRD_CRUISE = 34;
    const BIRD_SCATTER_SPEED = 56;
    const BIRD_MIN_SPEED = 13;

    let birdMesh = null;
    let birdAnchors = [];
    let birdFloorY = 12;
    const flocks = [];
    const birds = [];

    /**
     * Sparse ring scan of ctx.ground to find shoreline spots (terrain within a
     * small band of the water level). All raycasts happen here, once.
     */
    function pickCoastalAnchors(ctx) {
        const water = ctx.waterY;
        const anchors = [];
        for (let ring = 0; ring < 6 && anchors.length < 10; ring++) {
            const radius = 1000 + ring * 580;
            for (let s = 0; s < 14 && anchors.length < 10; s++) {
                const ang = (s / 14) * TWO_PI + ring * 0.23;
                const x = Math.cos(ang) * radius;
                const z = Math.sin(ang) * radius;
                const g = ctx.ground(x, z);
                if (g < water - 3 || g > water + 22) continue;
                let tooClose = false;
                for (let a = 0; a < anchors.length; a++) {
                    const dx = anchors[a].x - x;
                    const dz = anchors[a].z - z;
                    if (dx * dx + dz * dz < 700 * 700) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;
                anchors.push(new THREE.Vector3(x, Math.max(g, water) + 55 + Math.random() * 75, z));
            }
        }
        // guarantee at least 6 waypoints even if the shoreline scan comes up short
        let fi = 0;
        while (anchors.length < 6) {
            const ang = fi * 1.13 + 0.4;
            const x = Math.cos(ang) * 2300;
            const z = Math.sin(ang) * 2300;
            const g = ctx.ground(x, z);
            anchors.push(new THREE.Vector3(x, Math.max(g, water) + 90, z));
            fi++;
        }
        return anchors;
    }

    function buildBirds(ctx) {
        birdFloorY = ctx.waterY + 22;
        birdAnchors = pickCoastalAnchors(ctx);

        // flattened stretched tetrahedron, nose toward -Z, ~4u wingspan
        const geometry = new THREE.ConeGeometry(1.1, 3.0, 3);
        geometry.rotateX(-Math.PI / 2);
        geometry.scale(1.8, 0.45, 1);
        const material = new THREE.MeshStandardMaterial({
            color: 0x20262c,
            roughness: 1,
            metalness: 0
        });
        birdMesh = new THREE.InstancedMesh(geometry, material, BIRD_COUNT);
        birdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        birdMesh.frustumCulled = false; // instances span the whole map
        ctx.scene.add(birdMesh);

        for (let f = 0; f < FLOCK_COUNT; f++) {
            const fromIdx = f % birdAnchors.length;
            const toIdx = (fromIdx + 1 + f) % birdAnchors.length;
            const travel = Math.max(10, birdAnchors[fromIdx].distanceTo(birdAnchors[toIdx]) / 26);
            flocks.push({
                fromIdx,
                toIdx,
                progress: Math.random() * 0.4,
                travelTime: travel,
                anchor: birdAnchors[fromIdx].clone(),
                scatterT: 0
            });
            for (let i = 0; i < FLOCK_SIZE; i++) {
                const pos = birdAnchors[fromIdx].clone();
                pos.x += (Math.random() - 0.5) * 70;
                pos.y += (Math.random() - 0.5) * 24;
                pos.z += (Math.random() - 0.5) * 70;
                const ang = Math.random() * TWO_PI;
                birds.push({
                    pos,
                    vel: new THREE.Vector3(Math.cos(ang) * 20, 0, Math.sin(ang) * 20),
                    phase: Math.random() * TWO_PI,
                    size: 0.85 + Math.random() * 0.5
                });
            }
        }
    }

    function updateBirds(dt, ctx) {
        if (!birdMesh) return;
        const planePos = ctx.plane.position;

        for (let f = 0; f < FLOCK_COUNT; f++) {
            const flock = flocks[f];

            // slowly wandering anchor waypoint: glide between coastal anchors
            flock.progress += dt / flock.travelTime;
            if (flock.progress >= 1) {
                flock.fromIdx = flock.toIdx;
                let next = Math.floor(Math.random() * birdAnchors.length);
                if (next === flock.fromIdx) next = (next + 1) % birdAnchors.length;
                flock.toIdx = next;
                flock.travelTime = Math.max(10, birdAnchors[flock.fromIdx].distanceTo(birdAnchors[flock.toIdx]) / 26);
                flock.progress = 0;
            }
            const et = smoothstep(0, 1, flock.progress);
            flock.anchor.copy(birdAnchors[flock.fromIdx]).lerp(birdAnchors[flock.toIdx], et);

            // steer the anchor around downtown so flocks never thread the skyscrapers
            const cdx = flock.anchor.x - 1402;
            const cdz = flock.anchor.z - (-598);
            const cDistSq = cdx * cdx + cdz * cdz;
            if (cDistSq < 850 * 850 && cDistSq > 1) {
                const cDist = Math.sqrt(cDistSq);
                const push = (850 - cDist) / 850;
                flock.anchor.x += (cdx / cDist) * push * 620;
                flock.anchor.z += (cdz / cDist) * push * 620;
                flock.anchor.y += push * 160;      // and climb over the outskirts
            }

            const start = f * FLOCK_SIZE;
            _centroid.set(0, 0, 0);
            for (let i = 0; i < FLOCK_SIZE; i++) {
                _centroid.add(birds[start + i].pos);
            }
            _centroid.multiplyScalar(1 / FLOCK_SIZE);

            if (flock.scatterT > 0) flock.scatterT -= dt;
            if (planePos.distanceToSquared(_centroid) < 80 * 80) flock.scatterT = 2.2;
            const scattering = flock.scatterT > 0;
            const maxSpeed = scattering ? BIRD_SCATTER_SPEED : BIRD_CRUISE;
            const flapRate = scattering ? 17 : 9.5;

            for (let i = 0; i < FLOCK_SIZE; i++) {
                const bird = birds[start + i];

                // cohesion toward flock centroid
                _steer.copy(_centroid).sub(bird.pos).multiplyScalar(0.55);

                // seek the moving anchor, offset by a per-bird wander orbit
                const w = clock * 1.6 + bird.phase;
                _vecA.set(
                    flock.anchor.x + Math.sin(w) * 28,
                    flock.anchor.y + Math.sin(w * 0.63 + 1.7) * 12,
                    flock.anchor.z + Math.cos(w * 0.83) * 28
                ).sub(bird.pos).multiplyScalar(1.05);
                _steer.add(_vecA);

                // separation from close neighbours
                for (let j = 0; j < FLOCK_SIZE; j++) {
                    if (j === i) continue;
                    const other = birds[start + j];
                    const dsq = bird.pos.distanceToSquared(other.pos);
                    if (dsq < 36) {
                        _vecB.copy(bird.pos).sub(other.pos);
                        _steer.addScaledVector(_vecB, 24 / (dsq + 1));
                    }
                }

                // burst away from the player while scattering
                if (scattering) {
                    _vecB.copy(bird.pos).sub(planePos);
                    const dsq = Math.max(_vecB.lengthSq(), 25);
                    _steer.addScaledVector(_vecB.normalize(), 90000 / dsq);
                }

                bird.vel.addScaledVector(_steer, dt);
                const sp = bird.vel.length();
                if (sp > maxSpeed) {
                    bird.vel.multiplyScalar(maxSpeed / sp);
                } else if (sp > 0.001 && sp < BIRD_MIN_SPEED) {
                    bird.vel.multiplyScalar(BIRD_MIN_SPEED / sp);
                }
                bird.pos.addScaledVector(bird.vel, dt);
                if (bird.pos.y < birdFloorY) {
                    bird.pos.y = birdFloorY;
                    if (bird.vel.y < 0) bird.vel.y *= -0.5;
                }

                // orient nose (-Z) along velocity, flap via Y-scale oscillation
                _vecC.copy(bird.pos).add(bird.vel);
                _mat4.lookAt(bird.pos, _vecC, _up);
                _quat.setFromRotationMatrix(_mat4);
                const flap = 1 + Math.sin(clock * flapRate + bird.phase * 7) * 0.5;
                _scale.set(bird.size, bird.size * flap, bird.size);
                _mat4.compose(bird.pos, _quat, _scale);
                birdMesh.setMatrixAt(start + i, _mat4);
            }
        }
        birdMesh.instanceMatrix.needsUpdate = true;
    }

    // ============================ balloons =============================

    const BALLOON_COUNT = 5;
    const balloons = [];

    function makeStripeTexture(colors) {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const g = canvas.getContext('2d');
        const stripes = 10;
        for (let i = 0; i < stripes; i++) {
            g.fillStyle = colors[i % colors.length];
            g.fillRect(Math.floor(i * 128 / stripes), 0, Math.ceil(128 / stripes) + 1, 128);
        }
        // soft top-down shading so the crown reads rounded
        const shade = g.createLinearGradient(0, 0, 0, 128);
        shade.addColorStop(0, 'rgba(255,255,255,0.22)');
        shade.addColorStop(0.55, 'rgba(0,0,0,0)');
        shade.addColorStop(1, 'rgba(0,0,0,0.28)');
        g.fillStyle = shade;
        g.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(canvas);
    }

    /** Sphere pinched below the equator into a teardrop envelope (unit scale). */
    function makeEnvelopeGeometry() {
        const geo = new THREE.SphereGeometry(1, 20, 14);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            if (y < 0) {
                const t = -y;
                const pinch = 1 - t * t * 0.72;
                pos.setX(i, pos.getX(i) * pinch);
                pos.setZ(i, pos.getZ(i) * pinch);
                pos.setY(i, y * 1.25);
            }
        }
        geo.computeVertexNormals();
        return geo;
    }

    function buildBalloons(ctx) {
        const schemes = [
            ['#d84b3a', '#f4e9cf'],
            ['#2e66c9', '#f2cf4c'],
            ['#3f9d5a', '#f4f0e6', '#d84b3a']
        ];
        const textures = schemes.map(makeStripeTexture);
        const envelopeGeo = makeEnvelopeGeometry();
        const basketGeo = new THREE.BoxGeometry(4.2, 3.6, 4.2);
        const ropeGeo = new THREE.BoxGeometry(0.14, 6.4, 0.14);
        const basketMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.9, metalness: 0 });
        const ropeMat = new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 0.95, metalness: 0 });

        // keep drift loops clear of the city block and the radio-tower ring
        const cityMinX = 1000 - 32;
        const cityMaxX = 1000 + 7 * 115 + 32;
        const cityMinZ = -1000 - 32;
        const cityMaxZ = -1000 + 7 * 115 + 32;
        function clearOfStructures(cx, cz, margin) {
            if (cx > cityMinX - margin && cx < cityMaxX + margin &&
                cz > cityMinZ - margin && cz < cityMaxZ + margin) {
                return false;
            }
            for (let t = 0; t < 8; t++) {
                const ta = t / 8 * TWO_PI;
                const dx = cx - Math.cos(ta) * 2600;
                const dz = cz - Math.sin(ta) * 2600;
                if (dx * dx + dz * dz < (margin + 60) * (margin + 60)) return false;
            }
            return true;
        }

        for (let i = 0; i < BALLOON_COUNT; i++) {
            // find a spot over land (all raycasts at init only)
            let x = 0;
            let z = 0;
            let g = 0;
            let ok = false;
            for (let attempt = 0; attempt < 24 && !ok; attempt++) {
                const ang = Math.random() * TWO_PI;
                const rad = 700 + Math.random() * 2300;
                x = Math.cos(ang) * rad;
                z = Math.sin(ang) * rad;
                g = ctx.ground(x, z);
                ok = g > ctx.waterY + 12 && clearOfStructures(x, z, 430);
            }
            let radius = 150 + Math.random() * 250;
            if (ok) {
                // shrink the drift loop if its extremes stray over water
                for (let pass = 0; pass < 2; pass++) {
                    const onLand =
                        ctx.ground(x + radius, z) > ctx.waterY + 6 &&
                        ctx.ground(x - radius, z) > ctx.waterY + 6 &&
                        ctx.ground(x, z + radius) > ctx.waterY + 6 &&
                        ctx.ground(x, z - radius) > ctx.waterY + 6;
                    if (onLand) break;
                    radius *= 0.45;
                }
            } else {
                // fallback spots sit high enough to clear every structure anyway
                radius = 120;
            }
            const baseY = Math.max(ok ? 300 + Math.random() * 300 : 520, g + 170);

            const tex = textures[i % textures.length];
            const envMat = new THREE.MeshStandardMaterial({
                map: tex,
                emissiveMap: tex,
                emissive: 0xffc78a,
                emissiveIntensity: 0,
                roughness: 0.6,
                metalness: 0
            });
            const group = new THREE.Group();
            const envelope = new THREE.Mesh(envelopeGeo, envMat);
            envelope.scale.set(15, 15, 15);
            envelope.castShadow = true;
            group.add(envelope);
            for (let r = 0; r < 4; r++) {
                const rope = new THREE.Mesh(ropeGeo, ropeMat);
                rope.position.set(r < 2 ? -2 : 2, -21.4, r % 2 === 0 ? -2 : 2);
                group.add(rope);
            }
            const basket = new THREE.Mesh(basketGeo, basketMat);
            basket.position.y = -26;
            basket.castShadow = true;
            group.add(basket);
            group.position.set(x + radius, baseY, z);
            ctx.scene.add(group);

            balloons.push({
                group,
                envMat,
                cx: x,
                cz: z,
                radius,
                ang: Math.random() * TWO_PI,
                angSpeed: (0.02 + Math.random() * 0.03) * (Math.random() < 0.5 ? -1 : 1),
                baseY,
                bobRate: 0.25 + Math.random() * 0.2,
                bobPhase: Math.random() * TWO_PI,
                bobAmp: 10 + Math.random() * 8,
                spin: (Math.random() - 0.5) * 0.12,
                burnRate: 0.8 + Math.random() * 0.5,
                burnPhase: Math.random() * TWO_PI
            });
        }
    }

    function updateBalloons(dt, ctx) {
        const night = ctx.time.night;
        for (let i = 0; i < balloons.length; i++) {
            const b = balloons[i];
            b.ang += b.angSpeed * dt;
            const bob = Math.sin(clock * b.bobRate + b.bobPhase) * b.bobAmp;
            b.group.position.set(
                b.cx + Math.cos(b.ang) * b.radius,
                b.baseY + bob,
                b.cz + Math.sin(b.ang) * b.radius
            );
            b.group.rotation.y += dt * b.spin;
            // burner pulse: short warm burst inside the envelope every few seconds
            const burn = Math.pow(Math.max(0, Math.sin(clock * b.burnRate + b.burnPhase)), 16);
            b.envMat.emissiveIntensity = night * (0.14 + burn * 1.4);
        }
    }

    // ============================ AI traffic ===========================

    const gliders = [];

    function makeGliderGroup() {
        const mat = new THREE.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.35, metalness: 0.05 });
        const group = new THREE.Group();
        const fuselageGeo = new THREE.CylinderGeometry(0.32, 0.5, 9, 7);
        fuselageGeo.rotateX(Math.PI / 2); // nose toward -Z
        const fuselage = new THREE.Mesh(fuselageGeo, mat);
        group.add(fuselage);
        const wings = new THREE.Mesh(new THREE.BoxGeometry(26, 0.25, 2.4), mat);
        wings.position.set(0, 0.4, -0.8);
        group.add(wings);
        const tailplane = new THREE.Mesh(new THREE.BoxGeometry(7, 0.18, 1.5), mat);
        tailplane.position.set(0, 0.3, 4.1);
        group.add(tailplane);
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 1.9), mat);
        fin.position.set(0, 1.3, 4.1);
        group.add(fin);
        return group;
    }

    function buildTraffic(ctx) {
        const circuits = [
            { cx: -1500, cz: 700, radius: 1900, alt: 860, speed: 70, dir: 1 },
            { cx: 900, cz: -300, radius: 2450, alt: 1080, speed: 78, dir: -1 }
        ];
        for (let i = 0; i < circuits.length; i++) {
            const c = circuits[i];
            const group = makeGliderGroup();
            ctx.scene.add(group);
            gliders.push({
                group,
                cx: c.cx,
                cz: c.cz,
                radius: c.radius,
                alt: c.alt,
                ang: Math.random() * TWO_PI,
                angSpeed: (c.speed / c.radius) * c.dir,
                bobPhase: i * 2.4,
                trail: ctx.Gfx.createVaporTrail(ctx.scene, 48),
                spawnAcc: 0
            });
        }
    }

    function updateTraffic(dt) {
        for (let i = 0; i < gliders.length; i++) {
            const g = gliders[i];
            g.ang += g.angSpeed * dt;
            const cosA = Math.cos(g.ang);
            const sinA = Math.sin(g.ang);
            _vecA.set(
                g.cx + cosA * g.radius,
                g.alt + Math.sin(clock * 0.32 + g.bobPhase) * 9,
                g.cz + sinA * g.radius
            );
            const turnSign = g.angSpeed >= 0 ? 1 : -1;
            _vecB.set(-sinA * turnSign, 0, cosA * turnSign); // unit tangent

            // face the tangent (nose is -Z), then bank into the turn:
            // local +X points at the circle centre when turnSign is +1,
            // so a negative roll about local Z drops the inside wing.
            _vecC.copy(_vecA).add(_vecB);
            _mat4.lookAt(_vecA, _vecC, _up);
            _quat.setFromRotationMatrix(_mat4);
            _quatBank.setFromAxisAngle(_axisZ, -0.38 * turnSign);
            _quat.multiply(_quatBank);
            g.group.quaternion.copy(_quat);
            g.group.position.copy(_vecA);

            // faint vapor trail from the tail
            _vecC.copy(_vecA).addScaledVector(_vecB, -6.5);
            g.spawnAcc += dt;
            while (g.spawnAcc >= 0.1) {
                g.spawnAcc -= 0.1;
                g.trail.spawn(_vecC.x, _vecC.y, _vecC.z);
            }
            g.trail.update(dt, 0.5);
        }
    }

    // ========================== night airfield =========================

    let edgeMat = null;
    let threshMat = null;
    let beaconGroup = null;
    let beamMatWhite = null;
    let beamMatGreen = null;
    let lampMat = null;

    function makeBeamTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 32;
        const g = canvas.getContext('2d');
        const grad = g.createLinearGradient(0, 0, 128, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 32);
        return new THREE.CanvasTexture(canvas);
    }

    function buildAirfield(ctx) {
        const runways = ctx.world.runways;
        const edgeRecords = [];
        const threshRecords = [];
        const perSide = 14;

        for (let r = 0; r < runways.length; r++) {
            const rw = runways[r];
            const dirX = Math.cos(rw.heading);
            const dirZ = -Math.sin(rw.heading);
            const perpX = Math.sin(rw.heading);
            const perpZ = Math.cos(rw.heading);
            const half = rw.length * 0.5;
            const side = rw.width * 0.5 + 2.5;
            for (let i = 0; i < perSide; i++) {
                const t = -half + (i + 0.5) * (rw.length / perSide);
                for (let s = -1; s <= 1; s += 2) {
                    const x = rw.x + dirX * t + perpX * side * s;
                    const z = rw.z + dirZ * t + perpZ * side * s;
                    edgeRecords.push({ x, y: ctx.ground(x, z) + 1.2, z });
                }
            }
            for (let e = -1; e <= 1; e += 2) {
                for (let s = -1; s <= 1; s += 2) {
                    const x = rw.x + dirX * (half + 8) * e + perpX * rw.width * 0.28 * s;
                    const z = rw.z + dirZ * (half + 8) * e + perpZ * rw.width * 0.28 * s;
                    threshRecords.push({ x, y: ctx.ground(x, z) + 1.2, z });
                }
            }
        }

        edgeMat = new THREE.MeshStandardMaterial({
            color: 0x574733,
            emissive: 0xffc36b,
            emissiveIntensity: 0,
            roughness: 0.5,
            metalness: 0.1
        });
        threshMat = new THREE.MeshStandardMaterial({
            color: 0x5a5f66,
            emissive: 0xf4f8ff,
            emissiveIntensity: 0,
            roughness: 0.5,
            metalness: 0.1
        });
        const edgeMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1.2, 6, 5), edgeMat, edgeRecords.length);
        const threshMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1.5, 6, 5), threshMat, threshRecords.length);
        edgeMesh.frustumCulled = false;
        threshMesh.frustumCulled = false;
        for (let i = 0; i < edgeRecords.length; i++) {
            _mat4.makeTranslation(edgeRecords[i].x, edgeRecords[i].y, edgeRecords[i].z);
            edgeMesh.setMatrixAt(i, _mat4);
        }
        for (let i = 0; i < threshRecords.length; i++) {
            _mat4.makeTranslation(threshRecords[i].x, threshRecords[i].y, threshRecords[i].z);
            threshMesh.setMatrixAt(i, _mat4);
        }
        edgeMesh.instanceMatrix.needsUpdate = true;
        threshMesh.instanceMatrix.needsUpdate = true;
        ctx.scene.add(edgeMesh);
        ctx.scene.add(threshMesh);

        // rotating white/green beacon on a small tower beside runway 1
        const rw = runways[0];
        const perpX = Math.sin(rw.heading);
        const perpZ = Math.cos(rw.heading);
        const bx = rw.x + perpX * (rw.width * 0.5 + 70);
        const bz = rw.z + perpZ * (rw.width * 0.5 + 70);
        const gy = ctx.ground(bx, bz);

        const towerMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.7, metalness: 0.25 });
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.4, 26, 8), towerMat);
        tower.position.set(bx, gy + 13, bz);
        tower.castShadow = true;
        ctx.scene.add(tower);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(4.5, 3, 4.5),
            new THREE.MeshStandardMaterial({ color: 0x39424d, roughness: 0.6, metalness: 0.2 }));
        cab.position.set(bx, gy + 27.5, bz);
        ctx.scene.add(cab);
        lampMat = new THREE.MeshStandardMaterial({
            color: 0x777d84,
            emissive: 0xffffff,
            emissiveIntensity: 0,
            roughness: 0.4,
            metalness: 0.1
        });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), lampMat);
        lamp.position.set(bx, gy + 30, bz);
        ctx.scene.add(lamp);

        const beamTex = makeBeamTexture();
        beamMatWhite = new THREE.MeshBasicMaterial({
            map: beamTex,
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: false
        });
        beamMatGreen = beamMatWhite.clone();
        beamMatGreen.color.setHex(0x35ff7d);
        const beamGeo = new THREE.PlaneGeometry(230, 6);
        beamGeo.translate(115, 0, 0); // pivot at the lamp, beam extends outward
        beaconGroup = new THREE.Group();
        const beamWhite = new THREE.Mesh(beamGeo, beamMatWhite);
        beamWhite.rotateZ(0.05);
        beaconGroup.add(beamWhite);
        const beamGreen = new THREE.Mesh(beamGeo, beamMatGreen);
        beamGreen.rotateY(Math.PI);
        beamGreen.rotateZ(0.05);
        beaconGroup.add(beamGreen);
        beaconGroup.position.set(bx, gy + 30, bz);
        ctx.scene.add(beaconGroup);
    }

    function updateAirfield(ctx) {
        const lit = smoothstep(0.35, 0.6, ctx.time.night);
        edgeMat.emissiveIntensity = lit * 2.6;
        threshMat.emissiveIntensity = lit * 3.2;
        if (beaconGroup) {
            beaconGroup.rotation.y = clock * 1.7;
            beamMatWhite.opacity = lit * 0.85;
            beamMatGreen.opacity = lit * 0.75;
            lampMat.emissiveIntensity = lit * 3.0;
        }
    }

    // =========================== tower strobes =========================

    const strobes = [];

    function makeStrobeTexture() {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const g = canvas.getContext('2d');
        const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,90,80,1)');
        grad.addColorStop(0.25, 'rgba(255,40,40,0.55)');
        grad.addColorStop(1, 'rgba(255,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(canvas);
    }

    function buildStrobes(ctx) {
        const tex = makeStrobeTexture();
        for (let i = 0; i < ctx.world.towers; i++) {
            const angle = (i / ctx.world.towers) * TWO_PI;
            const tx = Math.cos(angle) * 2600;
            const tz = Math.sin(angle) * 2600;
            const g = ctx.ground(tx, tz);
            if (g <= ctx.waterY + 4) continue; // host skips underwater towers too
            const mat = new THREE.SpriteMaterial({
                map: tex,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                fog: false
            });
            const sprite = new THREE.Sprite(mat);
            sprite.scale.set(18, 18, 1);
            sprite.position.set(tx, g + 302, tz);
            ctx.scene.add(sprite);
            strobes.push({
                mat,
                rate: TWO_PI / (1.7 + (i % 4) * 0.23),
                phase: i * 1.71
            });
        }
    }

    function updateStrobes() {
        for (let i = 0; i < strobes.length; i++) {
            const s = strobes[i];
            const wave = Math.sin(clock * s.rate + s.phase);
            s.mat.opacity = 0.05 + 0.95 * smoothstep(0.6, 0.88, wave);
        }
    }

    // =============================== module ============================

    const mod = {
        name: 'ambient',
        init(ctx) {
            initTemps(ctx.THREE);
            buildBirds(ctx);
            buildBalloons(ctx);
            buildTraffic(ctx);
            buildAirfield(ctx);
            buildStrobes(ctx);
        },
        update(dt, ctx) {
            const step = Math.min(dt, 0.1); // guard against tab-back spikes
            clock += step;
            updateBirds(step, ctx);
            updateBalloons(step, ctx);
            updateTraffic(step);
            updateAirfield(ctx);
            updateStrobes();
        }
    };
    (window.SkyVectorMods = window.SkyVectorMods || []).push(mod);
})();
