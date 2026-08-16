uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uEnableGlitch;
uniform float uGlitchIntensity;
uniform float uGraffitiGlow;

varying vec2 vUv;

#define GOLDEN_ANGLE 2.39996323
#define NUM_SAMPLES 32

float glowHash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// 2D Box Signed Distance Field
float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// ============================================================================
// GOAL 4: 3 DISCRETE JUMPING GLITCH MAGNIFIERS
// ============================================================================

vec3 evaluateGlitchRectangles(sampler2D tex, vec2 uv, float intensity, float time) {
    if (intensity <= 0.01) return texture2D(tex, uv).rgb;

    vec2 distortedUv = uv;
    vec3 borderHighlight = vec3(0.0);
    float activeChromaticOffset = 0.0;

    // Evaluate 3 distinct jumping glitch boxes
    for (int i = 0; i < 3; i++) {
        float id = float(i) + 1.0;

        // Snap interval: jump every N frames using stepped time
        float jumpRate = 8.0 + id * 2.0; // Jump speed per box
        float timeStep = floor(time * jumpRate);

        // Seed discrete screen position [0.25 to 0.75] per jump step
        vec2 boxCenter = vec2(
            0.25 + 0.50 * glowHash12(vec2(timeStep, id * 17.13)),
            0.25 + 0.50 * glowHash12(vec2(timeStep, id * 43.71))
        );

        // Stepped size changes per jump
        vec2 boxSize = vec2(
            0.10 + 0.08 * glowHash12(vec2(timeStep, id * 71.19)),
            0.06 + 0.06 * glowHash12(vec2(timeStep, id * 91.33))
        ) * intensity;

        // Check distance inside box
        vec2 localUv = uv - boxCenter;
        float dist = sdBox(localUv, boxSize);

        if (dist < 0.0) {
            // Lens magnification zoom factor
            float zoomFactor = 1.35 + 0.25 * glowHash12(vec2(timeStep, id));
            distortedUv = boxCenter + localUv / zoomFactor;

            // Chromatic separation offset
            activeChromaticOffset += 0.015 * intensity * (1.0 + 0.4 * id);

            // Thin border outline
            float borderMask = smoothstep(0.0, -0.005, dist) - smoothstep(-0.005, -0.010, dist);
            borderHighlight += vec3(0.0, 0.9, 1.0) * borderMask * 1.8;
        }
    }

    // Sample texture with Chromatic Aberration (RGB split)
    vec3 col;
    if (activeChromaticOffset > 0.0001) {
        vec2 dir = normalize(distortedUv - vec2(0.5) + vec2(1e-5));
        col.r = texture2D(tex, distortedUv + dir * activeChromaticOffset).r;
        col.g = texture2D(tex, distortedUv).g;
        col.b = texture2D(tex, distortedUv - dir * activeChromaticOffset).b;
    } else {
        col = texture2D(tex, distortedUv).rgb;
    }

    return col + borderHighlight;
}

// ============================================================================
// GOAL 3: DYNAMIC ANIMATED POISSON RADIAL GLOW
// ============================================================================

vec3 evaluateSmoothHalo(sampler2D tex, vec2 uv, float glowAmount, float time) {
    vec3 baseColor = texture2D(tex, uv).rgb;
    if (glowAmount <= 0.01) return baseColor;

    vec3 bloomAcc = vec3(0.0);
    float totalWeight = 0.0;

    // Temporal jitter re-enabled for lively moving halo
    float randomJitter = glowHash12(uv * 1000.0 + fract(time));
    
    // Increased base spread radius further for a wider reach
    float radius = 0.035 * (glowAmount * 0.12);

    for (int i = 0; i < NUM_SAMPLES; i++) {
        float fi = float(i) + randomJitter;
        
        float normalizedIndex = fi / float(NUM_SAMPLES);
        float r = mix(0.15, 1.0, sqrt(normalizedIndex)) * radius;
        float theta = fi * GOLDEN_ANGLE;

        vec2 sampleOffset = vec2(cos(theta), sin(theta)) * r;
        vec3 sampleColor = texture2D(tex, uv + sampleOffset).rgb;

        float luminance = max(sampleColor.r, max(sampleColor.g, sampleColor.b));
        float thresholdMask = smoothstep(0.7, 1.4, luminance);
        
        // Softer weight decay to let outer samples carry the wider spread
        float weight = exp(-1.2 * (r / radius) * (r / radius));

        bloomAcc += sampleColor * thresholdMask * weight;
        totalWeight += weight;
    }

    bloomAcc /= max(totalWeight, 0.0001);

    // Soft-knee compression to keep mid-to-high ranges clean and unclipped
    vec3 compressedBloom = bloomAcc / (1.0 + bloomAcc * 0.5);

    return baseColor + compressedBloom * min(glowAmount, 2.0);
}

void main() {
    vec2 uv = vUv;

    // 1. Evaluate discrete jumping glitch magnifiers
    vec3 color = (uEnableGlitch > 0.5) 
        ? evaluateGlitchRectangles(tDiffuse, uv, uGlitchIntensity, uTime)
        : texture2D(tDiffuse, uv).rgb;

    // 2. Composite dynamic animated halo
    vec3 finalColor = evaluateSmoothHalo(tDiffuse, uv, uGraffitiGlow, uTime);

    gl_FragColor = vec4(color + (finalColor - texture2D(tDiffuse, uv).rgb), 1.0);
}