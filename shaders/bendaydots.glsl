// ============================================================================ 
// MODULE: Multi-Topology Parametric Ben-Day Dot Engine
// ============================================================================ 

struct BenDayOutput {
    float intensity; // Coverage/Mask [0.0 - 1.0]
    vec3 color;      // Evaluated dot emission/tint color
};

// Internal Hash Helper
float benDayHash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

/*
  Topology Types (uDotType):
  0.0 = Standard Circular Grid
  1.0 = Angled Elliptical Screen (CMYK Print Style)
  2.0 = Soft Emissive Bloom Dots
*/
BenDayOutput evaluateBenDayDots(
    vec2 uv,
    float lightValue,
    float scale,
    float blur,
    float dotType,
    vec3 dotColor,
    float emissiveBoost
) {
    BenDayOutput result;
    result.intensity = 0.0;
    result.color = vec3(0.0);

    // Apply 45-degree angle rotation for standard comic-book screen feel
    float angle = 0.785398; // 45 deg in radians
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    vec2 st = rot * (uv * scale);

    vec2 gridId = floor(st);
    vec2 gridUv = fract(st) - 0.5;

    // Per-dot micro jitter
    float rnd = benDayHash21(gridId);
    gridUv += (vec2(rnd, fract(rnd * 10.0)) - 0.5) * 0.1;

    // Radius maps directly to incoming light threshold
    float targetRadius = clamp((lightValue - 0.5) * 2.0, 0.0, 1.0) * 0.45;

    float dist = 0.0;

    if (dotType < 0.5) {
        // Type 0: Circular Dots
        dist = length(gridUv);
    } else if (dotType < 1.5) {
        // Type 1: Angled Ellipses
        vec2 animUv = vec2(gridUv.x * 1.4, gridUv.y * 0.7);
        dist = length(animUv);
    } else {
        // Type 2: Soft Emissive Bloom Dots
        dist = length(gridUv);
        targetRadius *= 1.2;
    }

    // Soft edge decay / blur control
    float edgeSmoothing = max(blur, 0.001);
    result.intensity = smoothstep(targetRadius, targetRadius - edgeSmoothing, dist);

    // Apply color and emissive scaling
    result.color = dotColor * (1.0 + emissiveBoost * result.intensity);

    return result;
}