import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ============================================================================
// 1. SCENE SETUP & RENDERER INITIALIZATION
// ============================================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0c);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100.0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0a0a0c, 1.0);
document.body.appendChild(renderer.domElement);

async function loadShaderFile(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to load shader file from: ${url}`);
    }
    return await response.text();
}

function bindInput(id, eventType, callback) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(eventType, callback);
    }
}

// ============================================================================
// 2. MAIN APPLICATION INITIALIZATION
// ============================================================================

async function init() {
    // Load Shader Sources
    const pass1VS = await loadShaderFile('shaders/pass1.vert');
    const pass1FS = await loadShaderFile('shaders/pass1.frag');
    const pass2FS = await loadShaderFile('shaders/pass2.frag');

    // Default Pass-Through Vertex Shader for Full-Screen Post-Process Quad
    const pass2VS = `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4(position, 1.0);
        }
    `;

    // Primary Pass 1 Material
    const spiderVerseMaterial = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0.0 },
            uStripColor: { value: 0.0 },
            uEnableLowPoly: { value: 0.0 },
            uEnableCurvatureView: { value: 0.0 },
            uFacetSteps: { value: 12.0 },
            uBaseTexture: { value: null },
            uHasTexture: { value: 0.0 },

            // Interactive Light Control
            uLightDirection: { value: new THREE.Vector3(0.5, 0.8, 1.0).normalize() },
            uLightStrength: { value: 1.0 },
            uLightSoftness: { value: 0.1 },

            // Impasto Brush Engine
            uEnableImpasto: { value: 1.0 },
            uBrushScale: { value: 12.0 },
            uImpastoHeight: { value: 0.35 },
            uImpastoStrength: { value: 0.95 },
            uBristleDensity: { value: 0.1 },

            // Ben-Day Dots Engine
            uEnableBenDay: { value: 1.0 },
            uBenDayStrength: { value: 1.0 },
            uBenDayType: { value: 1.0 },
            uBenDayScale: { value: 120.0 },
            uBenDayBlur: { value: 0.10 },
            uBenDayEmissive: { value: 0.3 },

            // Glitch & Anamorphic Rim Lighting
            uEnableGlitch: { value: 0.0 },
            uGlitchIntensity: { value: 0.5 },
            uEnableRimLight: { value: 1.0 },
            uRimStrength: { value: 1.0 },
            uRimWidth: { value: 0.2 },
            uRimColorMode: { value: 1.0 },

            // Graffiti Emission Shader
            uEnableGraffiti: { value: 1.0 },
            uGraffitiScale: { value: 10.0 },
            uGraffitiThreshold: { value: 0.3 },
            uGraffitiGlow: { value: 1.5 },
            uGraffitiColor: { value: new THREE.Color(0x00f0ff) },
            uGraffitiExtrude: { value: 0.05 }
        },
        vertexShader: pass1VS,
        fragmentShader: pass1FS,
        side: THREE.DoubleSide
    });

    // Pass 2 Post-Processing Material
    const pass2Material = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },
            uTime: { value: 0.0 },
            uEnableGlitch: { value: 0.0 },
            uGlitchIntensity: { value: 0.5 },
            uGraffitiGlow: { value: 2.5 }
        },
        vertexShader: pass2VS,
        fragmentShader: pass2FS
    });

    // ============================================================================
    // 3. INTERACTIVE ORBIT CONTROLS & 3S SMOOTH AUTO-RESET ENGINE
    // ============================================================================

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    const initialCameraPos = new THREE.Vector3();
    const initialTargetPos = new THREE.Vector3(0, 0, 0);

    let isUserInteracting = false;
    let idleTimeoutId = null;
    let isReturningToHome = false;
    const IDLE_TIME_MS = 3000; // 3 seconds timeout

    function startIdleTimer() {
        clearTimeout(idleTimeoutId);
        idleTimeoutId = setTimeout(() => {
            isReturningToHome = true;
        }, IDLE_TIME_MS);
    }

    controls.addEventListener('start', () => {
        isUserInteracting = true;
        isReturningToHome = false;
        clearTimeout(idleTimeoutId);
    });

    controls.addEventListener('end', () => {
        isUserInteracting = false;
        startIdleTimer();
    });

    // ============================================================================
    // 4. MODEL LOADING & CENTERING
    // ============================================================================

    const loader = new GLTFLoader();
    loader.load(
        'model.glb',
        (gltf) => {
            const model = gltf.scene;

            model.traverse((child) => {
                if (child.isMesh) {
                    if (child.material && child.material.map) {
                        spiderVerseMaterial.uniforms.uBaseTexture.value = child.material.map;
                        spiderVerseMaterial.uniforms.uHasTexture.value = 1.0;
                    }
                    child.material = spiderVerseMaterial;
                }
            });

            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            model.position.sub(center);

            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = camera.fov * (Math.PI / 180);
            let cameraZ = Math.abs(maxDim / (2 * Math.tan(fov / 2))) * 1.5;

            camera.position.set(0, 0, cameraZ);
            camera.lookAt(0, 0, 0);

            // Store initial camera/target state for smooth fallback
            initialCameraPos.copy(camera.position);
            initialTargetPos.set(0, 0, 0);
            controls.target.copy(initialTargetPos);
            controls.update();

            scene.add(model);
            startIdleTimer();
        },
        undefined,
        (error) => {
            console.error('An error occurred loading model.glb:', error);
        }
    );

    // ============================================================================
    // 5. UI HUD BINDINGS
    // ============================================================================

    // Lighting Direction Bindings
    bindInput('slider-light-x', 'input', (e) => {
        spiderVerseMaterial.uniforms.uLightDirection.value.x = parseFloat(e.target.value);
        spiderVerseMaterial.uniforms.uLightDirection.value.normalize();
    });

    bindInput('slider-light-y', 'input', (e) => {
        spiderVerseMaterial.uniforms.uLightDirection.value.y = parseFloat(e.target.value);
        spiderVerseMaterial.uniforms.uLightDirection.value.normalize();
    });

    bindInput('slider-light-z', 'input', (e) => {
        spiderVerseMaterial.uniforms.uLightDirection.value.z = parseFloat(e.target.value);
        spiderVerseMaterial.uniforms.uLightDirection.value.normalize();
    });

    bindInput('slider-light-strength', 'input', (e) => {
        spiderVerseMaterial.uniforms.uLightStrength.value = parseFloat(e.target.value);
    });

    bindInput('slider-light-softness', 'input', (e) => {
        spiderVerseMaterial.uniforms.uLightSoftness.value = parseFloat(e.target.value);
    });

    // Base Controls
    bindInput('toggle-base-color', 'change', (e) => {
        const isChecked = e.target.checked;
        spiderVerseMaterial.uniforms.uStripColor.value = isChecked ? 1.0 : 0.0;
        const backgroundColor = 0x0a0a0c;
        scene.background = new THREE.Color(backgroundColor);
        renderer.setClearColor(backgroundColor, 1.0);
    });

    bindInput('toggle-low-poly', 'change', (e) => {
        spiderVerseMaterial.uniforms.uEnableLowPoly.value = e.target.checked ? 1.0 : 0.0;
    });

    bindInput('slider-facet-steps', 'input', (e) => {
        spiderVerseMaterial.uniforms.uFacetSteps.value = parseFloat(e.target.value);
    });

    bindInput('toggle-curvature', 'change', (e) => {
        spiderVerseMaterial.uniforms.uEnableCurvatureView.value = e.target.checked ? 1.0 : 0.0;
    });

    // Impasto Controls
    bindInput('toggle-impasto', 'change', (e) => {
        spiderVerseMaterial.uniforms.uEnableImpasto.value = e.target.checked ? 1.0 : 0.0;
    });

    bindInput('slider-brush-scale', 'input', (e) => {
        spiderVerseMaterial.uniforms.uBrushScale.value = parseFloat(e.target.value);
    });

    bindInput('slider-bristle-density', 'input', (e) => {
        spiderVerseMaterial.uniforms.uBristleDensity.value = parseFloat(e.target.value);
    });

    bindInput('slider-impasto-strength', 'input', (e) => {
        spiderVerseMaterial.uniforms.uImpastoStrength.value = parseFloat(e.target.value);
    });

    // Ben-Day Dots Controls
    bindInput('toggle-benday', 'change', (e) => {
        spiderVerseMaterial.uniforms.uEnableBenDay.value = e.target.checked ? 1.0 : 0.0;
    });

    bindInput('slider-benday-strength', 'input', (e) => {
        spiderVerseMaterial.uniforms.uBenDayStrength.value = parseFloat(e.target.value);
    });

    bindInput('slider-benday-scale', 'input', (e) => {
        spiderVerseMaterial.uniforms.uBenDayScale.value = parseFloat(e.target.value);
    });

    // Rim Light & Glitch Controls
    bindInput('toggle-rimlight', 'change', (e) => {
        spiderVerseMaterial.uniforms.uEnableRimLight.value = e.target.checked ? 1.0 : 0.0;
    });

    bindInput('slider-rim-strength', 'input', (e) => {
        spiderVerseMaterial.uniforms.uRimStrength.value = parseFloat(e.target.value);
    });

    bindInput('toggle-glitch', 'change', (e) => {
        const val = e.target.checked ? 1.0 : 0.0;
        spiderVerseMaterial.uniforms.uEnableGlitch.value = val;
        pass2Material.uniforms.uEnableGlitch.value = val;
    });

    // Graffiti Controls
    bindInput('toggle-graffiti', 'change', (e) => {
        spiderVerseMaterial.uniforms.uEnableGraffiti.value = e.target.checked ? 1.0 : 0.0;
    });

    bindInput('slider-graffiti-scale', 'input', (e) => {
        spiderVerseMaterial.uniforms.uGraffitiScale.value = parseFloat(e.target.value);
    });

    bindInput('slider-graffiti-threshold', 'input', (e) => {
        spiderVerseMaterial.uniforms.uGraffitiThreshold.value = parseFloat(e.target.value);
    });

    bindInput('slider-graffiti-glow', 'input', (e) => {
        const val = parseFloat(e.target.value);
        spiderVerseMaterial.uniforms.uGraffitiGlow.value = val;
        pass2Material.uniforms.uGraffitiGlow.value = val;
    });

    // ============================================================================
    // 6. POST-PROCESSING SETUP & ANIMATION LOOP
    // ============================================================================

    const renderTarget = new THREE.WebGLRenderTarget(
        window.innerWidth * Math.min(window.devicePixelRatio, 2),
        window.innerHeight * Math.min(window.devicePixelRatio, 2),
        {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat
        }
    );

    const postScene = new THREE.Scene();
    const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const postQuad = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        pass2Material
    );
    postScene.add(postQuad);

    window.addEventListener('resize', () => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        const dpr = Math.min(window.devicePixelRatio, 2);

        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        renderer.setSize(width, height);
        renderer.setPixelRatio(dpr);

        renderTarget.setSize(width * dpr, height * dpr);
    });

    const clock = new THREE.Clock();

    function animate() {
        requestAnimationFrame(animate);

        const deltaTime = clock.getDelta();
        const elapsedTime = clock.getElapsedTime();

        // Buttery-smooth exponential ease-out fallback glide
        if (isReturningToHome && !isUserInteracting) {
            // Lower base (0.0002) creates a luxurious, seamless glide curve
            const lerpFactor = 1.0 - Math.pow(0.0002, deltaTime);

            camera.position.lerp(initialCameraPos, lerpFactor);
            controls.target.lerp(initialTargetPos, lerpFactor);
            controls.update();

            if (
                camera.position.distanceTo(initialCameraPos) < 0.001 &&
                controls.target.distanceTo(initialTargetPos) < 0.001
            ) {
                camera.position.copy(initialCameraPos);
                controls.target.copy(initialTargetPos);
                isReturningToHome = false;
            }
        } else {
            controls.update();
        }

        spiderVerseMaterial.uniforms.uTime.value = elapsedTime;
        pass2Material.uniforms.uTime.value = elapsedTime;

        // Pass 1: Render Model Scene to Texture
        renderer.setRenderTarget(renderTarget);
        renderer.render(scene, camera);

        // Pass 2: Screen-space Bloom/Halo Post-process
        renderer.setRenderTarget(null);
        pass2Material.uniforms.tDiffuse.value = renderTarget.texture;
        renderer.render(postScene, postCamera);
    }

    animate();
}

init().catch((err) => {
    console.error('Initialization failed:', err);
});