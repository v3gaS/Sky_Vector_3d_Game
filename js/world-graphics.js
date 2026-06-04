/**
 * SkyVector world rendering — terrain, water, sky, post-FX, shared materials.
 */
(function (global) {
    'use strict';

    if (typeof THREE === 'undefined') {
        return;
    }

    const SUN_DIR = new THREE.Vector3(0.25, 0.82, 0.35).normalize();

    function createGrassTexture() {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#4a8f45';
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 12000; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            const g = 70 + Math.random() * 50;
            ctx.fillStyle = `rgba(${g - 10},${g + 20},${g - 25},0.35)`;
            ctx.fillRect(x, y, 2, 2);
        }
        for (let i = 0; i < 400; i++) {
            const x = Math.random() * size;
            const y = Math.random() * size;
            ctx.fillStyle = `rgba(55,75,40,${0.08 + Math.random() * 0.12})`;
            ctx.beginPath();
            ctx.arc(x, y, 3 + Math.random() * 8, 0, Math.PI * 2);
            ctx.fill();
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(48, 48);
        return tex;
    }

    function paintTerrainVertices(geometry, terrainHeight, waterSurface) {
        const pos = geometry.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        const color = new THREE.Color();
        const segments = 200;
        const terrainSize = 10000;
        const half = terrainSize * 0.5;
        const cell = terrainSize / segments;
        const tmp = new THREE.Vector3();

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

            if (h < waterSurface + 6) {
                color.setRGB(0.76, 0.7, 0.52);
            } else if (slope > 0.42) {
                color.setRGB(0.42 + slope * 0.12, 0.38 + slope * 0.08, 0.32);
            } else if (h > 155) {
                color.setRGB(0.92, 0.94, 0.97);
            } else if (h > 115) {
                color.setRGB(0.55, 0.62, 0.48);
            } else {
                const n = (Math.sin(worldX * 0.04) + Math.cos(worldZ * 0.035)) * 0.04;
                color.setRGB(0.22 + n, 0.48 + n, 0.2 + n * 0.5);
            }
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.computeVertexNormals();
    }

    function clamp(v, a, b) {
        return Math.max(a, Math.min(b, v));
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
            roughness: 0.94,
            metalness: 0.02,
            envMapIntensity: 0.35
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
            waterColor: { value: new THREE.Color(0x0a5f7a) },
            shallowColor: { value: new THREE.Color(0x1a9cb8) },
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
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    vec4 wp = modelMatrix * vec4(position, 1.0);
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                uniform float time;
                uniform vec3 waterColor;
                uniform vec3 shallowColor;
                uniform vec3 sunDirection;
                uniform vec3 fogColor;
                uniform float fogDensity;
                varying vec3 vWorldPos;
                varying vec2 vUv;
                float wave(vec2 p) {
                    return sin(p.x * 0.08 + time * 1.2) * 0.5 + sin(p.y * 0.06 - time) * 0.5;
                }
                void main() {
                    vec2 uv = vWorldPos.xz * 0.015 + time * 0.03;
                    float w = wave(uv) * 0.35 + wave(uv * 1.7 + 1.3) * 0.2;
                    vec3 n = normalize(vec3(w * 0.25, 1.0, w * 0.2));
                    vec3 viewDir = normalize(cameraPosition - vWorldPos);
                    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
                    vec3 base = mix(waterColor, shallowColor, fresnel * 0.65 + 0.15);
                    float spec = pow(max(dot(reflect(-viewDir, n), sunDirection), 0.0), 120.0);
                    vec3 col = base + vec3(1.0, 0.95, 0.85) * spec * 0.55;
                    float fogFactor = 1.0 - exp(-fogDensity * fogDensity * length(vWorldPos - cameraPosition) * length(vWorldPos - cameraPosition));
                    col = mix(col, fogColor, clamp(fogFactor, 0.0, 0.85));
                    gl_FragColor = vec4(col, 0.88);
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
            topColor: { value: new THREE.Color(0x1d68d8) },
            horizonColor: { value: new THREE.Color(0xcdeeff) },
            glowColor: { value: new THREE.Color(0xffe2ad) },
            sunDirection: { value: SUN_DIR.clone() },
            sunIntensity: { value: 1 }
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
                varying vec3 vWorldPosition;
                void main() {
                    vec3 direction = normalize(vWorldPosition);
                    float skyMix = smoothstep(-0.08, 0.88, direction.y);
                    float sunDot = max(dot(direction, sunDirection), 0.0);
                    float sunGlow = pow(sunDot, 12.0) * sunIntensity;
                    float sunDisc = smoothstep(0.998, 0.9996, sunDot) * sunIntensity;
                    vec3 color = mix(horizonColor, topColor, skyMix);
                    color = mix(color, glowColor, sunGlow * 0.5);
                    color += vec3(1.0, 0.92, 0.75) * sunDisc * 0.9;
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
            exposure: { value: 1.08 },
            bloomStrength: { value: 0.28 },
            saturation: { value: 1.12 },
            contrast: { value: 1.05 }
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
                uniform float exposure;
                uniform float bloomStrength;
                uniform float saturation;
                uniform float contrast;
                varying vec2 vUv;
                vec3 adjustSaturation(vec3 c, float s) {
                    float l = dot(c, vec3(0.299, 0.587, 0.114));
                    return mix(vec3(l), c, s);
                }
                void main() {
                    vec4 base = texture2D(tDiffuse, vUv);
                    vec3 col = base.rgb * exposure;
                    vec2 px = vec2(1.0 / 512.0, 1.0 / 512.0);
                    vec3 s0 = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb;
                    vec3 s1 = texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb;
                    vec3 s2 = texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb;
                    vec3 s3 = texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
                    vec3 bloom = max(s0 - vec3(0.72), vec3(0.0)) + max(s1 - vec3(0.72), vec3(0.0))
                        + max(s2 - vec3(0.72), vec3(0.0)) + max(s3 - vec3(0.72), vec3(0.0));
                    bloom *= 0.25;
                    col += bloom * bloomStrength;
                    col = adjustSaturation(col, saturation);
                    col = (col - 0.5) * contrast + 0.5;
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

    function paintMountainColors(geometry, baseColor, snowLine) {
        const pos = geometry.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        const c = new THREE.Color();
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < pos.count; i++) {
            const y = pos.getY(i);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        const range = maxY - minY || 1;
        for (let i = 0; i < pos.count; i++) {
            const t = (pos.getY(i) - minY) / range;
            if (t > 0.72) {
                c.setRGB(0.88, 0.9, 0.92);
            } else if (t > 0.45) {
                c.setRGB(0.45, 0.38, 0.32);
            } else {
                c.copy(baseColor);
            }
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
            color: 0x2d6b2a,
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
        });
        trunks.instanceMatrix.needsUpdate = true;
        crowns.instanceMatrix.needsUpdate = true;
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

    function updateCloudsForCamera(clouds, cameraPosition) {
        clouds.forEach((group) => {
            const dist = cameraPosition.distanceTo(group.position);
            const fade = clamp(1 - (dist - 800) / 6000, 0.35, 1);
            group.children.forEach((part) => {
                if (part.material) {
                    part.material.opacity = 0.42 * fade;
                }
            });
        });
    }

    function updateSkyAndFog(state, skyUniforms, scene, waterUniforms) {
        const day = state.day;
        const dusk = state.dusk;
        skyUniforms.topColor.value.setRGB(
            0.05 + day * 0.06 + dusk * 0.2,
            0.12 + day * 0.28 + dusk * 0.15,
            0.28 + day * 0.42
        );
        skyUniforms.horizonColor.value.setRGB(
            0.2 + day * 0.6 + dusk * 0.35,
            0.35 + day * 0.55 + dusk * 0.2,
            0.55 + day * 0.35
        );
        skyUniforms.glowColor.value.setRGB(0.9 + dusk * 0.1, 0.55 + dusk * 0.35, 0.25 + day * 0.15);
        skyUniforms.sunIntensity.value = 0.25 + day * 0.85 + dusk * 0.4;
        const fogColor = new THREE.Color().setRGB(
            0.45 + day * 0.2,
            0.62 + day * 0.18,
            0.78 + day * 0.12
        );
        scene.fog.color.copy(fogColor);
        scene.fog.density = 0.00022 + (1 - day) * 0.00012 + dusk * 0.00008;
        if (waterUniforms) {
            waterUniforms.fogColor.value.copy(fogColor);
            waterUniforms.fogDensity.value = scene.fog.density;
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
        paintMountainColors,
        buildTreeInstances,
        createRoads,
        updateCloudsForCamera,
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
