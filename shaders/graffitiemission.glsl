// ============================================================================
// GRAFFITI EMISSION ENGINE (CONTROLLED)
// ============================================================================

struct GraffitiOutput {
    vec3 color;
    float intensity;
};

float sprayNoise(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float sdSpiderTag(vec2 p) {
    p.x = abs(p.x);
    
    // Core body
    vec2 b = p / vec2(0.2, 0.3);
    float body = length(b) - 0.5;

    // Angled leg strokes
    float leg1 = length(p - vec2(0.25, 0.15)) - 0.04;
    float leg2 = length(p - vec2(0.35, -0.10)) - 0.04;
    float leg3 = length(p - vec2(0.28, -0.30)) - 0.04;

    return min(body, min(leg1, min(leg2, leg3)));
}

GraffitiOutput evaluateGraffitiEmission(
    vec2 uv, 
    float scale, 
    float threshold, 
    float glowPower, 
    float time, 
    vec3 neonColor
) {
    GraffitiOutput outG;
    outG.color = vec3(0.0);
    outG.intensity = 0.0;

    // Guard against zero scale
    float safeScale = max(scale, 0.1);
    vec2 st = uv * safeScale;
    vec2 gridId = floor(st);
    vec2 gridUv = fract(st) - 0.5;

    // Fixed noise seed per cell
    float cellSeed = sprayNoise(gridId * 17.31);

    // Smooth density cutoff controlled by uGraffitiThreshold [0.0 to 1.0]
    float spawnProbability = smoothstep(1.0 - threshold, 1.0 - threshold + 0.15, cellSeed);
    if (spawnProbability <= 0.001) return outG;

    // Micro spray aerosol texture
    float grain = sprayNoise(st * 120.0);
    float aerosolDrip = sprayNoise(vec2(gridUv.x * 30.0, floor(gridUv.y * 10.0)));

    // Tag Distance Field
    float dist = sdSpiderTag(gridUv * 1.8);

    // Sharp paint core + aerosol soft halo
    float coreTag = smoothstep(0.05, 0.0, dist);
    float haloGlow = smoothstep(0.35, 0.0, dist) * 0.5;
    float sprayTexture = mix(0.75, 1.25, grain);

    float tagMask = (coreTag + haloGlow) * sprayTexture;

    // Downward spray drip line
    if (gridUv.y < -0.1 && abs(gridUv.x) < 0.25) {
        float dripLine = smoothstep(0.08, 0.0, abs(gridUv.x + (aerosolDrip - 0.5) * 0.05));
        tagMask += dripLine * smoothstep(-0.45, -0.10, gridUv.y) * 0.4 * grain;
    }

    // Animation flicker
    float pulse = sin(time * 3.5 + cellSeed * 6.28) * 0.15 + 0.85;
    float flicker = step(0.05, sprayNoise(vec2(time * 15.0, cellSeed))) * 0.15 + 0.85;

    // Modulate intensity by spawn probability and threshold
    float finalAlpha = clamp(tagMask, 0.0, 1.0) * spawnProbability * pulse * flicker;
    
    outG.intensity = finalAlpha;
    outG.color = neonColor * finalAlpha * glowPower;

    return outG;
}