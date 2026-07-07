/**
 * SkyVector world rendering — terrain, water, sky, clouds, post-FX, shared materials.
 */
(function (global) {
    'use strict';

    if (typeof THREE === 'undefined') {
        return;
    }

    const SUN_DIR = new THREE.Vector3(0.25, 0.82, 0.35).normalize();

    function clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
    }

    function smoothstep(edge0, edge1, x) {
        const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    function hash2(x, z) {
        const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
        return s - Math.floor(s);
    }

    function createGrassTexture() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#8a9a78';
        ctx.fillRect(0, 0, size, size);
        // large soft tonal patches break up tiling
        for (let i = 0; i < 90; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const r = 14 + Math.random() * 42;
            const lum = 120 + Math.random() * 50;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, `rgba(${lum - 15},${lum},${lum - 35},0.16)`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // fine speckle detail
        for (let i = 0; i < 15000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const g = 115 + Math.random() * 65;
            ctx.fillStyle = `rgba(${g - 18},${g},${g - 42},0.28)`;
            ctx.fillRect(x, y, 1.5, 1.5);
        }
        // sparse darker clods
        for (let i = 0; i < 260; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            ctx.fillStyle = `rgba(60,72,48,${0.05 + Math.random() * 0.09})`;
            ctx.beginPath();
            ctx.arc(x, y, 2 + Math.random() * 6, 0, Math.PI * 2);
            ctx.fill();
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(64, 64);
        return tex;
    }

    const BIOME = {
        grassDark: new THREE.Color(0.16, 0.34, 0.14),
        grassLight: new THREE.Color(0.42, 0.54, 0.24),
        alpine: new THREE.Color(0.47, 0.47, 0.3),
        rockDark: new THREE.Color(0.34, 0.29, 0.25),
        rockLight: new THREE.Color(0.56, 0.51, 0.45),
        snow: new THREE.Color(0.94, 0.96, 1.0),
        sand: new THREE.Color(0.82, 0.73, 0.53)
    };

    function paintTerrainVertices(geometry, terrainHeight, waterSurface) {
        const pos = geometry.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        const color = new THREE.Color();
        const rock = new THREE.Color();
        const segments = 200;
        const terrainSize = 10000;
        const half = terrainSize * 0.5;
        const cell = terrainSize / segments;

        for (let i = 0; i < pos.count; i++) {
            const worldX = pos.getX(i);
            const worldZ = -pos.getY(i);
            const h = pos.getZ(i);
            const gx = clamp((worldX + half) / cell, 0, segments);
            const gz = clamp((worldZ + half) / cell, 0, segments);
            const ix = Math.min(Math.floor(gx), segments - 1);
            const iz = Math.min(Math.floor(gz), segments - 1);
            const fx = gx - ix;
            const fz = gz - iz;
            const x0 = -half + ix * cell;
            const z0 = -half + iz * cell;
            const h00 = terrainHeight(x0, z0);
            const h10 = terrainHeight(x0 + cell, z0);
            const h01 = terrainHeight(x0, z0 + cell);
            const h11 = terrainHeight(x0 + cell, z0 + cell);
            const hx = (h10 - h00) * (1 - fz) + (h11 - h01) * fz;
            const hz = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;
            const slope = Math.min(1, Math.sqrt(hx * hx + hz * hz) / cell);

            // low-frequency variation so meadows aren't one flat green
            const meadow = 0.5 + 0.5 * Math.sin(worldX * 0.0016 + Math.sin(worldZ * 0.0011) * 2.1);
            const grit = hash2(ix * 3.7, iz * 5.1);

            color.copy(BIOME.grassDark).lerp(BIOME.grassLight, meadow * 0.8 + grit * 0.2);
            color.lerp(BIOME.alpine, smoothstep(80, 128, h));
            rock.copy(BIOME.rockDark).lerp(BIOME.rockLight, grit);
            color.lerp(rock, smoothstep(0.28, 0.55, slope));
            color.lerp(BIOME.snow, smoothstep(136, 158, h) * (1 - smoothstep(0.3, 0.6, slope) * 0.6));
            color.lerp(BIOME.sand, 1 - smoothstep(waterSurface + 4, waterSurface + 26, h));

            // valley shading + dither to hide banding
            const shade = 0.8 + 0.2 * clamp((h + 40) / 140, 0, 1) + (grit - 0.5) * 0.035;
            colors[i * 3] = color.r * shade;
            colors[i * 3 + 1] = color.g * shade;
            colors[i * 3 + 2] = color.b * shade;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.computeVertexNormals();
    }

    function createTerrainMesh(scene, terrainHeight, waterSurface) {
        const terrainSize = 10000;
        const segments = 200;
        const geometry = new THREE.PlaneGeometry(terrainSize, terrainSize, segments, segments);
        const vertices = geometry.attributes.position.array;
        for (let i = 0; i < vertices.length; i += 3) {
            const worldX = vertices[i];
            const worldZ = -vertices[i + 1];
            vertices[i + 2] = terrainHeight(worldX, worldZ);
        }
        paintTerrainVertices(geometry, terrainHeight, waterSurface);
        const material = new THREE.MeshStandardMaterial({
            map: createGrassTexture(),
            vertexColors: true,
            roughness: 0.96,
            metalness: 0.0,
            envMapIntensity: 0.3
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
        scene.add(mesh);
        return mesh;
    }

    function createWaterMesh(scene, waterSurface, terrainSize) {
        const uniforms = {
            time: { value: 0 },
            waterColor: { value: new THREE.Color(0x073e5c) },
            shallowColor: { value: new THREE.Color(0x2494b8) },
            skyColor: { value: new THREE.Color(0xaad4f0) },
            sunDirection: { value: SUN_DIR.clone() },
            fogColor: { value: new THREE.Color(0x9bcfff) },
            fogDensity: { value: 0.00028 }
        };
        const material = new THREE.ShaderMaterial({
            uniforms,
            transparent: true,
            depthWrite: true,
            vertexShader: `
                varying vec3 vWorldPos;
                void main() {
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 waterColor;
                uniform vec3 shallowColor;
                uniform vec3 skyColor;
                uniform vec3 sunDirection;
                uniform vec3 fogColor;
                uniform float fogDensity;
                varying vec3 vWorldPos;

                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
                }
                // finite-difference height of three drifting wave octaves
                float waveH(vec2 p) {
                    float h = sin(p.x * 0.055 + time * 1.05) * 0.55
                            + sin(p.y * 0.048 - time * 0.85 + sin(p.x * 0.021) * 2.0) * 0.45
                            + sin((p.x + p.y) * 0.11 + time * 1.6) * 0.22
                            + sin((p.x - p.y * 1.3) * 0.19 - time * 2.1) * 0.12;
                    return h;
                }
                void main() {
                    vec2 p = vWorldPos.xz * 0.28;
                    float e = 1.2;
                    float hC = waveH(p);
                    float hX = waveH(p + vec2(e, 0.0));
                    float hZ = waveH(p + vec2(0.0, e));
                    vec3 n = normalize(vec3((hC - hX) * 0.55, 1.0, (hC - hZ) * 0.55));

                    // flatten normals with distance so wave bands don't read as stripes
                    float dist = length(vWorldPos - cameraPosition);
                    float nearness = clamp(1.0 - dist / 5500.0, 0.12, 1.0);
                    n = normalize(mix(vec3(0.0, 1.0, 0.0), n, nearness));

                    vec3 viewDir = normalize(cameraPosition - vWorldPos);
                    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.5);

                    vec3 base = mix(waterColor, shallowColor, 0.25 + hC * 0.07 * nearness);
                    vec3 col = mix(base, skyColor, clamp(fresnel * 0.85 + 0.08, 0.0, 1.0));

                    vec3 refl = reflect(-viewDir, n);
                    float sunSpot = max(dot(refl, sunDirection), 0.0);
                    col += vec3(1.0, 0.93, 0.78) * pow(sunSpot, 60.0) * 0.45;   // broad glint path
                    col += vec3(1.0, 0.98, 0.9) * pow(sunSpot, 700.0) * 2.4;    // sharp sparkle

                    // shimmering micro-sparkle on wave crests
                    float sp = hash(floor(vWorldPos.xz * 0.7) + floor(time * 3.0));
                    col += vec3(0.8) * step(0.992, sp) * clamp(hC, 0.0, 1.0) * pow(sunSpot, 4.0);

                    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * dist * dist);
                    col = mix(col, fogColor, clamp(fogFactor, 0.0, 0.9));
                    gl_FragColor = vec4(col, 0.94);
                }
            `
        });
        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(terrainSize * 2, terrainSize * 2, 1, 1),
            material
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = waterSurface;
        scene.add(mesh);
        return { mesh, uniforms };
    }

    function createSkyMesh(scene) {
        const uniforms = {
            topColor: { value: new THREE.Color(0x2963c4) },
            horizonColor: { value: new THREE.Color(0xcdeeff) },
            glowColor: { value: new THREE.Color(0xffe2ad) },
            sunDirection: { value: SUN_DIR.clone() },
            sunIntensity: { value: 1 },
            nightAmount: { value: 0 }
        };
        const material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 horizonColor;
                uniform vec3 glowColor;
                uniform vec3 sunDirection;
                uniform float sunIntensity;
                uniform float nightAmount;
                varying vec3 vWorldPosition;

                float hash(vec2 p) {
                    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
                }
                void main() {
                    vec3 dir = normalize(vWorldPosition);
                    float elev = dir.y;

                    float skyMix = pow(smoothstep(-0.06, 0.62, elev), 0.85);
                    vec3 color = mix(horizonColor, topColor, skyMix);

                    // hazy band hugging the horizon
                    float haze = pow(1.0 - clamp(abs(elev + 0.015) * 3.2, 0.0, 1.0), 2.0);
                    color = mix(color, horizonColor * 1.05, haze * 0.55);

                    float sunDot = max(dot(dir, sunDirection), 0.0);
                    color += glowColor * pow(sunDot, 6.0) * 0.30 * sunIntensity;
                    color += glowColor * pow(sunDot, 48.0) * 0.55 * sunIntensity;
                    float sunDisc = smoothstep(0.99930, 0.99972, sunDot);
                    color += vec3(1.0, 0.95, 0.82) * sunDisc * 1.35 * sunIntensity;

                    // stars fade in with nightAmount, kept off the horizon haze
                    if (nightAmount > 0.01 && elev > 0.02) {
                        vec2 sp = dir.xz / (dir.y + 1.15) * 210.0;
                        vec2 cellId = floor(sp);
                        float h = hash(cellId);
                        if (h > 0.988) {
                            vec2 starPos = vec2(hash(cellId + 7.1), hash(cellId + 3.7));
                            float d = length(fract(sp) - starPos);
                            float star = smoothstep(0.16, 0.0, d) * (h - 0.988) / 0.012;
                            color += vec3(0.9, 0.94, 1.0) * star * nightAmount * smoothstep(0.02, 0.2, elev);
                        }
                        // moon opposite the sun
                        float moonDot = max(dot(dir, -sunDirection), 0.0);
                        color += vec3(0.92, 0.94, 1.0) * smoothstep(0.99955, 0.99985, moonDot) * nightAmount * 0.85;
                        color += vec3(0.5, 0.6, 0.8) * pow(moonDot, 40.0) * nightAmount * 0.16;
                    }

                    gl_FragColor = vec4(color, 1.0);
                }
            `,
            side: THREE.BackSide,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(40000, 40, 32), material);
        scene.add(mesh);
        return { mesh, material, uniforms };
    }

    function createPostFX(renderer) {
        const w = renderer.domElement.width;
        const h = renderer.domElement.height;
        const rt = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat
        });
        const postScene = new THREE.Scene();
        const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const uniforms = {
            tDiffuse: { value: null },
            resolution: { value: new THREE.Vector2(w, h) },
            exposure: { value: 1.06 },
            bloomStrength: { value: 0.55 },
            saturation: { value: 1.14 },
            contrast: { value: 1.045 },
            vignette: { value: 0.32 },
            sunScreen: { value: new THREE.Vector2(0.5, 0.5) },
            raysAmount: { value: 0 }
        };
        const material = new THREE.ShaderMaterial({
            uniforms,
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tDiffuse;
                uniform vec2 resolution;
                uniform float exposure;
                uniform float bloomStrength;
                uniform float saturation;
                uniform float contrast;
                uniform float vignette;
                uniform vec2 sunScreen;
                uniform float raysAmount;
                varying vec2 vUv;

                vec3 bright(vec2 uv) {
                    return max(texture2D(tDiffuse, uv).rgb - vec3(0.68), vec3(0.0));
                }
                vec3 adjustSaturation(vec3 c, float s) {
                    float l = dot(c, vec3(0.299, 0.587, 0.114));
                    return mix(vec3(l), c, s);
                }
                void main() {
                    vec2 px = 1.0 / resolution;
                    vec3 col = texture2D(tDiffuse, vUv).rgb * exposure;

                    // two-ring highlight blur for a soft bloom halo
                    vec3 bloom = vec3(0.0);
                    float r1 = 2.0;
                    float r2 = 5.5;
                    bloom += bright(vUv + vec2( px.x,  0.0) * r1) + bright(vUv + vec2(-px.x,  0.0) * r1);
                    bloom += bright(vUv + vec2( 0.0,  px.y) * r1) + bright(vUv + vec2( 0.0, -px.y) * r1);
                    bloom += bright(vUv + vec2( px.x,  px.y) * r1 * 0.7) + bright(vUv + vec2(-px.x, -px.y) * r1 * 0.7);
                    bloom += bright(vUv + vec2( px.x, -px.y) * r1 * 0.7) + bright(vUv + vec2(-px.x,  px.y) * r1 * 0.7);
                    bloom += bright(vUv + vec2( px.x,  0.0) * r2) + bright(vUv + vec2(-px.x,  0.0) * r2);
                    bloom += bright(vUv + vec2( 0.0,  px.y) * r2) + bright(vUv + vec2( 0.0, -px.y) * r2);
                    bloom /= 12.0;
                    col += bloom * bloomStrength;

                    // god rays: march toward the sun's screen position accumulating bright sky
                    if (raysAmount > 0.002) {
                        vec2 toSun = sunScreen - vUv;
                        vec2 stepv = toSun / 14.0;
                        vec2 p = vUv;
                        float decay = 1.0;
                        float total = 0.0;
                        for (int i = 0; i < 14; i++) {
                            p += stepv;
                            vec3 s = texture2D(tDiffuse, p).rgb;
                            total += max(max(max(s.r, s.g), s.b) - 0.62, 0.0) * decay;
                            decay *= 0.91;
                        }
                        float falloff = smoothstep(1.5, 0.25, length(toSun));
                        col += vec3(1.0, 0.9, 0.72) * total * (raysAmount / 14.0) * falloff * 0.85;
                    }

                    col = adjustSaturation(col, saturation);
                    col = (col - 0.5) * contrast + 0.5;

                    float vig = smoothstep(1.45, 0.5, length(vUv - 0.5) * 2.0);
                    col *= mix(1.0, vig, vignette);

                    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
                }
            `
        });
        postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
        return {
            rt,
            postScene,
            postCamera,
            uniforms,
            resize(width, height) {
                rt.setSize(width, height);
                uniforms.resolution.value.set(width, height);
            },
            render(renderer, scene, camera) {
                renderer.setRenderTarget(rt);
                renderer.render(scene, camera);
                uniforms.tDiffuse.value = rt.texture;
                renderer.setRenderTarget(null);
                renderer.render(postScene, postCamera);
            }
        };
    }

    function updateShadowCamera(light, position) {
        const s = 520;
        light.position.set(position.x + 280, position.y + 420, position.z + 220);
        light.target.position.copy(position);
        light.target.updateMatrixWorld();
        light.shadow.camera.left = -s;
        light.shadow.camera.right = s;
        light.shadow.camera.top = s;
        light.shadow.camera.bottom = -s;
        light.shadow.camera.near = 40;
        light.shadow.camera.far = 1400;
        light.shadow.camera.updateProjectionMatrix();
    }

    /**
     * Ridged, noise-displaced peak with height-blended rock/snow vertex colors.
     * Replaces the old smooth cone + paintMountainColors pair.
     */
    function createMountainGeometry(radius, height, seed) {
        const geometry = new THREE.ConeGeometry(radius, height, 46, 7);
        const pos = geometry.attributes.position;
        const v = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i);
            const r = Math.sqrt(v.x * v.x + v.z * v.z);
            if (r > 0.001) {
                const ang = Math.atan2(v.z, v.x);
                const rim = r / radius;
                const ridge = Math.sin(ang * 3 + seed) * 0.16
                    + Math.sin(ang * 7 + seed * 2.3) * 0.1
                    + Math.sin(ang * 15 + seed * 4.1 + v.y * 0.012) * 0.06;
                const k = 1 + ridge * (0.35 + rim * 0.65);
                v.x *= k;
                v.z *= k;
                v.y += Math.sin(ang * 5 + seed * 1.7) * height * 0.025 * rim;
            }
            pos.setXYZ(i, v.x, v.y, v.z);
        }
        geometry.computeVertexNormals();

        const colors = new Float32Array(pos.count * 3);
        const c = new THREE.Color();
        const rockA = new THREE.Color(0.33, 0.28, 0.24);
        const rockB = new THREE.Color(0.5, 0.44, 0.38);
        const snow = new THREE.Color(0.93, 0.95, 0.99);
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < pos.count; i++) {
            minY = Math.min(minY, pos.getY(i));
            maxY = Math.max(maxY, pos.getY(i));
        }
        const range = maxY - minY || 1;
        for (let i = 0; i < pos.count; i++) {
            const t = (pos.getY(i) - minY) / range;
            const strata = hash2(Math.round(pos.getX(i) * 0.05), Math.round(pos.getY(i) * 0.05));
            c.copy(rockA).lerp(rockB, strata);
            c.lerp(snow, smoothstep(0.58, 0.78, t + (strata - 0.5) * 0.12));
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        return geometry;
    }

    function buildTreeInstances(scene, treeRecords) {
        if (treeRecords.length === 0) return { trunks: null, crowns: null };
        const trunkGeo = new THREE.CylinderGeometry(1, 1.4, 1, 6);
        const crownGeo = new THREE.ConeGeometry(1, 1, 7);
        const trunkMat = new THREE.MeshStandardMaterial({
            color: 0x4a3520,
            roughness: 0.95,
            metalness: 0
        });
        const crownMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.88,
            metalness: 0
        });
        const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeRecords.length);
        const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeRecords.length);
        trunks.castShadow = true;
        crowns.castShadow = true;
        const matrix = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        const crownColor = new THREE.Color();
        treeRecords.forEach((tree, i) => {
            pos.set(tree.x, tree.groundY + tree.trunkH * 0.5, tree.z);
            scale.set(1.2, tree.trunkH, 1.2);
            matrix.compose(pos, quat, scale);
            trunks.setMatrixAt(i, matrix);
            const crownR = tree.crownR;
            pos.set(tree.x, tree.groundY + tree.trunkH + tree.crownH * 0.5, tree.z);
            scale.set(crownR, tree.crownH, crownR);
            matrix.compose(pos, quat, scale);
            crowns.setMatrixAt(i, matrix);
            const shade = hash2(tree.x * 0.13, tree.z * 0.17);
            crownColor.setRGB(0.12 + shade * 0.14, 0.34 + shade * 0.2, 0.1 + shade * 0.1);
            crowns.setColorAt(i, crownColor);
        });
        trunks.instanceMatrix.needsUpdate = true;
        crowns.instanceMatrix.needsUpdate = true;
        if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
        scene.add(trunks);
        scene.add(crowns);
        return { trunks, crowns };
    }

    /**
     * Raycast against the rendered terrain mesh — authoritative ground height in world space.
     * Optional halfX/halfZ sample a footprint and return the lowest hit (prevents floating on slopes).
     */
    function createGroundSampler(terrainMesh) {
        const raycaster = new THREE.Raycaster();
        const origin = new THREE.Vector3();
        const down = new THREE.Vector3(0, -1, 0);
        terrainMesh.updateMatrixWorld(true);

        function cast(worldX, worldZ) {
            origin.set(worldX, 12000, worldZ);
            raycaster.set(origin, down);
            const hits = raycaster.intersectObject(terrainMesh, false);
            return hits.length > 0 ? hits[0].point.y : null;
        }

        return function getGroundY(worldX, worldZ, halfX, halfZ, blendFootprint) {
            const samples = [[worldX, worldZ]];
            if (halfX > 0 || halfZ > 0) {
                const hx = halfX || 0;
                const hz = halfZ || halfX || 0;
                samples.push(
                    [worldX + hx, worldZ],
                    [worldX - hx, worldZ],
                    [worldX, worldZ + hz],
                    [worldX, worldZ - hz],
                    [worldX + hx, worldZ + hz],
                    [worldX - hx, worldZ - hz]
                );
            }
            let minH = Infinity;
            let sumH = 0;
            let count = 0;
            for (let i = 0; i < samples.length; i++) {
                const h = cast(samples[i][0], samples[i][1]);
                if (h === null) continue;
                minH = Math.min(minH, h);
                sumH += h;
                count++;
            }
            if (count === 0) return 0;
            if (blendFootprint) {
                return sumH / count;
            }
            return minH;
        };
    }

    function createRoads(scene, propGroundHeight, points) {
        const roadMat = new THREE.MeshStandardMaterial({
            color: 0x3d4248,
            roughness: 0.92,
            metalness: 0.05
        });
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            const steps = Math.max(2, Math.floor(len / 80));
            for (let s = 0; s < steps; s++) {
                const t0 = s / steps;
                const t1 = (s + 1) / steps;
                const mx = a.x + dx * (t0 + t1) * 0.5;
                const mz = a.z + dz * (t0 + t1) * 0.5;
                const segLen = len / steps;
                const gy = propGroundHeight(mx, mz, 5, 5);
                const seg = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.35, 10), roadMat);
                seg.position.set(mx, gy + 0.18, mz);
                seg.rotation.y = Math.atan2(dx, dz);
                seg.receiveShadow = true;
                scene.add(seg);
            }
        }
    }

    function createCloudTexture() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, size, size);
        // layered soft blobs make one fluffy puff
        for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = Math.random() * size * 0.22;
            const x = size / 2 + Math.cos(a) * d;
            const y = size / 2 + Math.sin(a) * d * 0.6;
            const r = size * (0.12 + Math.random() * 0.16);
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, 'rgba(255,255,255,0.4)');
            grad.addColorStop(0.6, 'rgba(255,255,255,0.16)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        return new THREE.CanvasTexture(canvas);
    }

    /**
     * Soft billboard cloud clusters. Each cluster is a Group of Sprites;
     * sprite.userData.baseOpacity feeds the distance fade in updateCloudsForCamera.
     */
    function createCloudField(scene, count) {
        const texture = createCloudTexture();
        const clouds = [];
        for (let i = 0; i < count; i++) {
            const group = new THREE.Group();
            const seed = i * 17.31;
            const puffs = 5 + (i % 5);
            for (let j = 0; j < puffs; j++) {
                const material = new THREE.SpriteMaterial({
                    map: texture,
                    transparent: true,
                    depthWrite: false,
                    opacity: 0
                });
                const sprite = new THREE.Sprite(material);
                const s = 420 + hash2(seed, j * 3.3) * 520;
                sprite.scale.set(s * (1.2 + hash2(seed, j) * 0.6), s * 0.48, 1);
                sprite.position.set(
                    Math.sin(seed + j * 1.9) * 430,
                    Math.cos(seed + j * 0.8) * 60,
                    Math.sin(seed * 0.5 + j * 1.3) * 330
                );
                sprite.userData.baseOpacity = 0.4 + hash2(seed, j * 7.7) * 0.26;
                group.add(sprite);
            }
            group.position.set(
                Math.sin(seed) * 4300,
                900 + (i % 9) * 110,
                Math.cos(seed * 1.37) * 4300
            );
            group.userData.drift = 2 + (i % 5) * 0.45;
            clouds.push(group);
            scene.add(group);
        }
        return clouds;
    }

    function updateCloudsForCamera(clouds, cameraPosition) {
        clouds.forEach((group) => {
            const dist = cameraPosition.distanceTo(group.position);
            const fade = clamp(1 - (dist - 900) / 6500, 0.3, 1);
            group.children.forEach((part) => {
                if (part.material) {
                    part.material.opacity = (part.userData.baseOpacity || 0.4) * fade;
                }
            });
        });
    }

    function createFlareTexture() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(255,245,220,0.9)');
        grad.addColorStop(0.18, 'rgba(255,225,170,0.45)');
        grad.addColorStop(0.5, 'rgba(255,200,130,0.12)');
        grad.addColorStop(1, 'rgba(255,190,120,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
        return new THREE.CanvasTexture(canvas);
    }

    /** Additive glow sprite pinned along the sun direction; terrain occludes it naturally. */
    function createSunFlare(scene) {
        const material = new THREE.SpriteMaterial({
            map: createFlareTexture(),
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            opacity: 0.85
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(6500, 6500, 1);
        scene.add(sprite);
        return {
            sprite,
            update(cameraPosition, sunDir, intensity) {
                sprite.position.copy(cameraPosition).addScaledVector(sunDir, 30000);
                material.opacity = clamp(intensity, 0, 1) * 0.85;
            }
        };
    }

    /**
     * Facade materials for one building: canvas window grid as map + emissiveMap so
     * windows glow warm at night. Returns 6 BoxGeometry materials; sides share one
     * instance exposed for per-building emissive control.
     */
    function createBuildingMaterials(seed) {
        const w = 128;
        const h = 256;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const glow = document.createElement('canvas');
        glow.width = w;
        glow.height = h;
        const gtx = glow.getContext('2d');

        const facades = ['#8d939e', '#7d8694', '#9a948a', '#6f7885', '#8a8378'];
        const facade = facades[Math.floor(hash2(seed, 1) * facades.length) % facades.length];
        ctx.fillStyle = facade;
        ctx.fillRect(0, 0, w, h);
        gtx.fillStyle = '#000';
        gtx.fillRect(0, 0, w, h);

        const cols = 5;
        const rows = 14;
        const cw = w / cols;
        const ch = h / rows;
        for (let r = 1; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = c * cw + cw * 0.22;
                const y = r * ch + ch * 0.24;
                const wx = cw * 0.56;
                const wy = ch * 0.5;
                const lit = hash2(seed + c * 7.3, r * 3.1) > 0.62;
                ctx.fillStyle = 'rgba(38,48,62,0.92)';
                ctx.fillRect(x, y, wx, wy);
                ctx.fillStyle = 'rgba(180,200,220,0.25)';
                ctx.fillRect(x, y, wx, wy * 0.35);
                if (lit) {
                    const warm = hash2(seed + c, r) > 0.5;
                    gtx.fillStyle = warm ? '#ffd27a' : '#bcd8ff';
                    gtx.fillRect(x, y, wx, wy);
                }
            }
        }
        const mapTex = new THREE.CanvasTexture(canvas);
        const glowTex = new THREE.CanvasTexture(glow);
        const side = new THREE.MeshStandardMaterial({
            map: mapTex,
            emissiveMap: glowTex,
            emissive: 0xffffff,
            emissiveIntensity: 0,
            roughness: 0.6,
            metalness: 0.25
        });
        const roof = new THREE.MeshStandardMaterial({
            color: 0x4a505a,
            roughness: 0.85,
            metalness: 0.1
        });
        return { materials: [side, side, roof, roof, side, side], side };
    }

    /**
     * Wingtip vapor trails: CPU-simulated point pool with per-point age driving
     * size growth and alpha fade in a small shader.
     */
    function createVaporTrail(scene, max) {
        const MAX = max || 720;
        const LIFE = 2.6;
        const positions = new Float32Array(MAX * 3);
        const ages = new Float32Array(MAX).fill(LIFE);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const alphaAttr = new THREE.BufferAttribute(new Float32Array(MAX), 1);
        const sizeAttr = new THREE.BufferAttribute(new Float32Array(MAX), 1);
        geometry.setAttribute('aAlpha', alphaAttr);
        geometry.setAttribute('aSize', sizeAttr);
        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            vertexShader: `
                attribute float aAlpha;
                attribute float aSize;
                varying float vAlpha;
                void main() {
                    vAlpha = aAlpha;
                    vec4 mv = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = min(aSize * (420.0 / max(-mv.z, 1.0)), 30.0);
                    gl_Position = projectionMatrix * mv;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                void main() {
                    float d = length(gl_PointCoord - 0.5) * 2.0;
                    float soft = smoothstep(1.0, 0.15, d);
                    gl_FragColor = vec4(0.96, 0.98, 1.0, soft * vAlpha);
                }
            `
        });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        scene.add(points);
        let head = 0;

        return {
            points,
            spawn(x, y, z) {
                positions[head * 3] = x;
                positions[head * 3 + 1] = y;
                positions[head * 3 + 2] = z;
                ages[head] = 0;
                head = (head + 1) % MAX;
            },
            update(deltaTime, strength) {
                for (let i = 0; i < MAX; i++) {
                    if (ages[i] >= LIFE) {
                        alphaAttr.array[i] = 0;
                        continue;
                    }
                    ages[i] += deltaTime;
                    const t = ages[i] / LIFE;
                    positions[i * 3 + 1] += deltaTime * 1.5;
                    alphaAttr.array[i] = (1 - t) * (1 - t) * 0.2 * (strength == null ? 1 : strength);
                    sizeAttr.array[i] = 2 + t * 9;
                }
                geometry.attributes.position.needsUpdate = true;
                alphaAttr.needsUpdate = true;
                sizeAttr.needsUpdate = true;
            }
        };
    }

    function updateSkyAndFog(state, skyUniforms, scene, waterUniforms) {
        const day = state.day;
        const dusk = state.dusk;
        const night = clamp(1 - day * 1.6, 0, 1);
        skyUniforms.topColor.value.setRGB(
            clamp(0.015 + day * 0.14 + dusk * 0.09, 0, 1),
            clamp(0.03 + day * 0.31 + dusk * 0.04, 0, 1),
            clamp(0.09 + day * 0.58 + dusk * 0.04, 0, 1)
        );
        skyUniforms.horizonColor.value.setRGB(
            clamp(0.05 + day * 0.66 + dusk * 0.45, 0, 1),
            clamp(0.07 + day * 0.72 + dusk * 0.14, 0, 1),
            clamp(0.12 + day * 0.78 - dusk * 0.08, 0, 1)
        );
        skyUniforms.glowColor.value.setRGB(
            1.0,
            clamp(0.5 + day * 0.4 - dusk * 0.18, 0, 1),
            clamp(0.28 + day * 0.42 - dusk * 0.2, 0, 1)
        );
        skyUniforms.sunIntensity.value = 0.25 + day * 0.85 + dusk * 0.4;
        if (skyUniforms.nightAmount) {
            skyUniforms.nightAmount.value = night;
        }
        const fogColor = new THREE.Color().setRGB(
            clamp(0.1 + day * 0.52 + dusk * 0.22, 0, 1),
            clamp(0.13 + day * 0.58 + dusk * 0.08, 0, 1),
            clamp(0.2 + day * 0.62, 0, 1)
        );
        scene.fog.color.copy(fogColor);
        scene.fog.density = 0.00022 + (1 - day) * 0.00012 + dusk * 0.00008;
        if (waterUniforms) {
            waterUniforms.fogColor.value.copy(fogColor);
            waterUniforms.fogDensity.value = scene.fog.density;
            if (waterUniforms.skyColor) {
                waterUniforms.skyColor.value.copy(skyUniforms.horizonColor.value);
            }
        }
    }

    global.SkyVectorGfx = {
        SUN_DIR,
        createTerrainMesh,
        createGroundSampler,
        createWaterMesh,
        createSkyMesh,
        createPostFX,
        updateShadowCamera,
        createMountainGeometry,
        buildTreeInstances,
        createRoads,
        createCloudField,
        updateCloudsForCamera,
        createSunFlare,
        createBuildingMaterials,
        createVaporTrail,
        updateSkyAndFog,
        stdMaterial(opts) {
            return new THREE.MeshStandardMaterial({
                color: opts.color || 0xffffff,
                roughness: opts.roughness != null ? opts.roughness : 0.72,
                metalness: opts.metalness != null ? opts.metalness : 0.12,
                emissive: opts.emissive || 0x000000,
                emissiveIntensity: opts.emissiveIntensity || 0,
                vertexColors: !!opts.vertexColors,
                map: opts.map || null
            });
        }
    };
})(typeof window !== 'undefined' ? window : global);
