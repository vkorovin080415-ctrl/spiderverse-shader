varying vec3 vNormal;
varying vec2 vUV;
varying vec3 vPosition;
varying vec3 vDisplacedPosition;

// Base Uniforms
uniform float uTime;
uniform float uStripColor;
uniform float uEnableLowPoly;
uniform float uEnableCurvatureView;
uniform float uFacetSteps;
uniform sampler2D uBaseTexture;
uniform float uHasTexture;

// Interactive Light Controls
uniform vec3 uLightDirection;
uniform float uLightStrength;
uniform float uLightSoftness;

// Impasto Brush Engine
uniform float uEnableImpasto;
uniform float uBrushScale;
uniform float uImpastoHeight;
uniform float uBristleDensity;
uniform float uImpastoStrength; // Default around 0.3 - 0.5 for subtle texture
// Ben-Day Dots Engine
uniform float uEnableBenDay;
uniform float uBenDayStrength;
uniform float uBenDayType;
uniform float uBenDayScale;
uniform float uBenDayBlur;
uniform float uBenDayEmissive;

// Graffiti Emission Engine Uniforms
uniform float uEnableGraffiti;
uniform float uGraffitiScale;
uniform float uGraffitiThreshold;
uniform float uGraffitiGlow;
uniform vec3 uGraffitiColor;

// Glitch & Anamorphic Rim Lighting
uniform float uEnableGlitch;
uniform float uGlitchIntensity;
uniform float uEnableRimLight;
uniform float uRimStrength;
uniform float uRimWidth;
uniform float uRimColorMode;

#define PI 3.14159265359

// ============================================================================
// HELPER FUNCTIONS & NOISE GENERATORS
// ============================================================================

struct BrushStroke {
    float mask;
    float height;
    vec2 normalOffset;
    float bristle;
    float strokeSeed;
};

struct BenDayOutput {
    float intensity;
    vec3 color;
};

struct HatchOutput {
    float mask;
    vec3 color;
};

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
    vec2 b = p / vec2(0.2, 0.3);
    float body = length(b) - 0.5;
    float leg1 = length(p - vec2(0.25, 0.15)) - 0.04;
    float leg2 = length(p - vec2(0.35, -0.10)) - 0.04;
    float leg3 = length(p - vec2(0.28, -0.30)) - 0.04;
    return min(body, min(leg1, min(leg2, leg3)));
}

GraffitiOutput evaluateGraffitiEmission(vec2 uv, float scale, float threshold, float glowPower, float time, vec3 neonColor) {
    GraffitiOutput outG;
    outG.color = vec3(0.0);
    outG.intensity = 0.0;

    vec2 st = uv * scale;
    vec2 gridId = floor(st);
    vec2 gridUv = fract(st) - 0.5;

    float patchSeed = sprayNoise(gridId * 17.31);
    if (patchSeed < (1.0 - threshold)) return outG;

    float grain = sprayNoise(st * 120.0);
    float aerosolDrip = sprayNoise(vec2(gridUv.x * 30.0, floor(gridUv.y * 10.0)));

    float dist = sdSpiderTag(gridUv * 1.8);
    float coreTag = smoothstep(0.05, 0.0, dist);
    float haloGlow = smoothstep(0.35, 0.0, dist) * 0.5;
    float sprayTexture = mix(0.75, 1.25, grain);

    float tagMask = (coreTag + haloGlow) * sprayTexture;

    if (gridUv.y < -0.1 && abs(gridUv.x) < 0.25) {
        float dripLine = smoothstep(0.08, 0.0, abs(gridUv.x + (aerosolDrip - 0.5) * 0.05));
        tagMask += dripLine * smoothstep(-0.45, -0.10, gridUv.y) * 0.4 * grain;
    }

    float pulse = sin(time * 3.5 + patchSeed * 6.28) * 0.15 + 0.85;
    float flicker = step(0.05, sprayNoise(vec2(time * 15.0, patchSeed))) * 0.15 + 0.85;

    float finalAlpha = clamp(tagMask, 0.0, 1.0) * pulse * flicker;
    outG.intensity = finalAlpha;
    outG.color = neonColor * finalAlpha * glowPower;

    return outG;
}

vec2 strokeHash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195));
    p3 += dot(p3, p3.yzx + 19.19);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// Distance to quadratic Bezier curve segment
float sdBezier(vec2 pos, vec2 A, vec2 B, vec2 C, out float outT) {
    vec2 a = B - A;
    vec2 b = A - 2.0 * B + C;
    vec2 c = a * 2.0;
    vec2 d = A - pos;

    float kk = 1.0 / dot(b, b);
    float kx = kk * dot(a, b);
    float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
    float kz = kk * dot(d, a);

    float p = ky - kx * kx;
    float p3 = p * p * p;
    float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
    float h = q * q + 4.0 * p3;

    if (h >= 0.0) {
        h = sqrt(h);
        vec2 x = (vec2(h, -h) - q) / 2.0;
        vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
        float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
        outT = t;
        vec2 qpos = d + (c + b * t) * t;
        return length(qpos);
    }

    float z = sqrt(-p);
    float v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0;
    float m = cos(v);
    float n = sin(v) * 1.732050808;
    vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
    vec2 qpos1 = d + (c + b * t.x) * t.x;
    float d1 = dot(qpos1, qpos1);
    vec2 qpos2 = d + (c + b * t.y) * t.y;
    float d2 = dot(qpos2, qpos2);
    if (d1 < d2) { outT = t.x; return sqrt(d1); }
    else { outT = t.y; return sqrt(d2); }
}

// ============================================================================
// IMPASTO BRUSH ENGINE
// ============================================================================

BrushStroke evaluateParametricStroke(vec2 uv, vec2 cellId, vec2 flowDir, float scale, float bristleDensity, float strokeType) {
    BrushStroke s;
    s.mask = 0.0; s.height = 0.0; s.normalOffset = vec2(0.0); s.bristle = 0.0;
    s.strokeSeed = strokeHash22(cellId + vec2(strokeType * 13.37, strokeType * 71.91)).x;

    vec2 rnd = strokeHash22(cellId + vec2(strokeType * 47.11, strokeType * 89.23));
    vec2 offsetJitter = (rnd - 0.5) * 1.4;
    vec2 P0 = (cellId + 0.5 + offsetJitter) / scale;
    float angleMult = mix(0.75, 1.80, strokeType);
    float angleJitter = (rnd.y - 0.5) * angleMult;
    float cosA = cos(angleJitter), sinA = sin(angleJitter);
    vec2 dir = vec2(flowDir.x * cosA - flowDir.y * sinA, flowDir.x * sinA + flowDir.y * cosA);
    float minLen = mix(1.2, 0.25, strokeType);
    float maxLen = mix(2.2, 0.55, strokeType);
    float strokeLen = mix(minLen, maxLen, rnd.x) / scale;
    vec2 P2 = P0 + dir * strokeLen;
    vec2 orth = vec2(-dir.y, dir.x);
    float curvatureMult = mix(0.5, 0.2, strokeType);
    vec2 P1 = mix(P0, P2, 0.5) + orth * (rnd.x - 0.5) * (strokeLen * curvatureMult);

    float t;
    float dist = sdBezier(uv, P0, P1, P2, t);

    float pressure = sin(smoothstep(0.0, 1.0, t) * 3.14159265);
    float radiusMult = mix(0.40, 0.22, strokeType);
    float maxRadius = (radiusMult / scale) * (0.6 + pressure * 0.8) * mix(0.7, 1.3, rnd.y);

    float bristleStrands = sin(dist * bristleDensity * 800.0 + t * 20.0);
    float edgeFray = bristleStrands * maxRadius * 0.2;

    float effectiveDist = dist + edgeFray;
    s.mask = smoothstep(maxRadius, maxRadius * 0.1, effectiveDist);

    if (s.mask > 0.0) {
        float edgeRidge = smoothstep(maxRadius * 0.3, maxRadius, effectiveDist);
        s.height = edgeRidge * pressure * s.mask;
        s.bristle = bristleStrands;
        vec2 strokeTangent = normalize(mix(P1 - P0, P2 - P1, t) + 1e-5);
        vec2 strokeNormal = vec2(-strokeTangent.y, strokeTangent.x);
        float sideSign = sign(dot(uv - P0, strokeNormal));
        s.normalOffset = (strokeNormal * sideSign * edgeRidge + strokeTangent * (1.0 - t)) * s.mask;
    }

    return s;
}

BrushStroke evaluateStrokeLayer(vec2 uv, vec2 flowDirection, float scale, float bristleDensity, float strokeType) {
    BrushStroke layerStroke;
    layerStroke.mask = 0.0; layerStroke.height = 0.0; layerStroke.normalOffset = vec2(0.0);
    layerStroke.bristle = 0.0; layerStroke.strokeSeed = 0.0;

    vec2 gridUv = uv * scale;
    vec2 currentCell = floor(gridUv);

    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            vec2 cellId = currentCell + vec2(float(x), float(y));
            BrushStroke stroke = evaluateParametricStroke(uv, cellId, flowDirection, scale, bristleDensity, strokeType);

            if (stroke.mask > 0.001) {
                float blendFactor = smoothstep(0.0, 0.4, stroke.mask);
                layerStroke.mask = max(layerStroke.mask, stroke.mask);
                layerStroke.height = mix(layerStroke.height, stroke.height, blendFactor);
                layerStroke.normalOffset = mix(layerStroke.normalOffset, stroke.normalOffset, blendFactor);
                layerStroke.bristle = mix(layerStroke.bristle, stroke.bristle, blendFactor);
                if (stroke.mask > layerStroke.mask * 0.7) {
                    layerStroke.strokeSeed = stroke.strokeSeed;
                }
            }
        }
    }
    return layerStroke;
}

BrushStroke evaluateBrushStroke(
    vec2 uv, 
    vec2 flowDirection, 
    float scale, 
    float impastoDepth, 
    float bristleDensity, 
    float impastoStrength
) {
    BrushStroke longStrokes = evaluateStrokeLayer(uv, flowDirection, scale * 0.75, bristleDensity, 0.0);
    BrushStroke shortStrokes = evaluateStrokeLayer(uv, flowDirection, scale * 2.20, bristleDensity * 1.5, 1.0);

    BrushStroke finalStroke;
    float blendAlpha = smoothstep(0.1, 0.6, shortStrokes.mask);

    finalStroke.mask = max(longStrokes.mask, shortStrokes.mask);
    
    // Smoothly scale both height and tangent displacement to zero
    finalStroke.height = mix(longStrokes.height, shortStrokes.height, blendAlpha) * impastoDepth * impastoStrength;
    finalStroke.normalOffset = mix(longStrokes.normalOffset, shortStrokes.normalOffset, blendAlpha) * impastoDepth * impastoStrength * 12.0;
    
    finalStroke.bristle = mix(longStrokes.bristle, shortStrokes.bristle, blendAlpha);
    finalStroke.strokeSeed = mix(longStrokes.strokeSeed, shortStrokes.strokeSeed, step(0.5, blendAlpha));

    return finalStroke;
}

// ============================================================================
// STENCIL BEN-DAY DOTS ENGINE
// ============================================================================

float evaluateHalftoneChannel(vec2 uv, float angle, float scale, float lightVal, float dotType) {
    float rad = radians(angle);
    mat2 rot = mat2(cos(rad), -sin(rad), sin(rad), cos(rad));
    vec2 st = rot * (uv * scale);

    vec2 gridId = floor(st);
    vec2 gridUv = fract(st) - 0.5;

    float rnd = hash12(gridId);
    gridUv += (vec2(rnd, fract(rnd * 13.37)) - 0.5) * 0.05;

    float maxRadius = 0.45;
    float targetRadius = clamp(lightVal, 0.0, 1.0) * maxRadius;

    float dist = length(gridUv);
    if (dotType > 0.5 && dotType < 1.5) {
        dist = length(gridUv * vec2(1.2, 0.8));
    } else if (dotType >= 1.5) {
        dist = abs(gridUv.y);
    }

    return smoothstep(targetRadius, targetRadius - 0.08, dist);
}

BenDayOutput evaluateBenDayDots(vec2 uv, float lightValue, float scale, float blur, float dotType, float emissiveBoost) {
    BenDayOutput result;
    result.intensity = 0.0;
    result.color = vec3(0.0);

    if (lightValue <= 0.01) return result;

    float stencilNoise = hash12(floor(uv * scale * 0.15)) * 0.5 + hash12(floor(uv * scale * 0.4)) * 0.5;
    float patchMask = smoothstep(0.35, 0.65, stencilNoise);

    if (patchMask <= 0.01) return result;

    float cyanDot    = evaluateHalftoneChannel(uv, 15.0,  scale,       lightValue,       dotType);
    float magentaDot = evaluateHalftoneChannel(uv, 75.0,  scale * 1.1, lightValue * 0.9, dotType);
    float yellowDot  = evaluateHalftoneChannel(uv, 0.0,   scale * 0.95,lightValue * 1.1, dotType);

    vec3 colorCyan    = vec3(0.0, 0.85, 0.95);
    vec3 colorMagenta = vec3(0.95, 0.10, 0.50);
    vec3 colorYellow  = vec3(1.0, 0.88, 0.10);

    vec3 cmykComposite = (colorCyan * cyanDot) + (colorMagenta * magentaDot) + (colorYellow * yellowDot);
    float totalDotAlpha = clamp(cyanDot + magentaDot + yellowDot, 0.0, 1.0);

    float linearOpacity = smoothstep(0.05, 0.95, lightValue) * patchMask;

    result.intensity = totalDotAlpha * linearOpacity;
    result.color = cmykComposite * (1.0 + emissiveBoost * totalDotAlpha);

    return result;
}

// ============================================================================
// PHYSICAL PENCIL HATCHING ENGINE
// ============================================================================

HatchOutput evaluatePencilHatching(vec2 uv, vec2 flowDir, float shadowMask, float scale, float thickness, float hatchType, vec3 graphiteColor) {
    HatchOutput result;
    result.mask = 0.0; 
    result.color = graphiteColor;

    if (shadowMask <= 0.01) return result;

    mat2 flowRot = mat2(flowDir.x, flowDir.y, -flowDir.y, flowDir.x);
    vec2 objectUv = flowRot * uv * scale;

    float uPencilJitter = 0.08;
    float uPencilGraphite = 0.25;

    float handJitter = (hash12(floor(objectUv.xx * 2.0)) - 0.5) * uPencilJitter;
    vec2 jitteredUv = objectUv + vec2(0.0, handJitter);

    float linePos1 = fract(jitteredUv.y);
    float strokeCenter1 = abs(linePos1 - 0.5) * 2.0;
    
    float lineMask1 = smoothstep(thickness, thickness - 0.08, strokeCenter1);

    float lineMask2 = 0.0;
    if (hatchType > 0.5 || shadowMask > 0.6) {
        mat2 crossAngle = mat2(0.7071, -0.7071, 0.7071, 0.7071);
        vec2 crossUv = crossAngle * jitteredUv;
        float linePos2 = fract(crossUv.y);
        float strokeCenter2 = abs(linePos2 - 0.5) * 2.0;
        lineMask2 = smoothstep(thickness * 0.85, (thickness * 0.85) - 0.08, strokeCenter2);
    }

    float layeredStroke = max(lineMask1, lineMask2 * step(0.4, shadowMask));

    float paperTooth = hash12(floor(objectUv * 80.0));
    float graphiteGrain = mix(1.0 - uPencilGraphite, 1.0, paperTooth);

    float totalPencilStroke = clamp(layeredStroke * graphiteGrain * shadowMask, 0.0, 1.0);

    result.mask = totalPencilStroke;
    return result;
}

vec3 quantizeNormalSpherical(vec3 N, float steps) {
    float theta = acos(clamp(N.z, -1.0, 1.0));
    float phi = atan(N.y, N.x);
    theta = floor(theta * (steps / PI) + 0.5) * (PI / steps);
    phi = floor(phi * (steps / PI) + 0.5) * (PI / steps);
    return vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
}

vec3 applyVibrantPalette(vec3 baseTexColor, float lightValue, vec3 normal) {
    float hueShift = lightValue * 1.8 + (normal.y * 0.35 + normal.x * 0.25);
    vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (hueShift + vec3(0.0, 0.33, 0.67)));
    return baseTexColor * rainbow * 1.35;
}

// ============================================================================
// MAIN SHADER PIPELINE
// ============================================================================

void main() {
    vec2 renderUv = vUV;

    if (uEnableGlitch > 0.5) {
        float glitchJitter = (hash12(vec2(floor(vUV.y * 40.0), 1.0)) - 0.5) * uGlitchIntensity * 0.05;
        renderUv.x += glitchJitter;
    }

    vec3 dpdx = dFdx(vDisplacedPosition);
    vec3 dpdy = dFdy(vDisplacedPosition);
    vec3 physicalNormal = cross(dpdx, dpdy);
    physicalNormal = (dot(physicalNormal, physicalNormal) < 1e-8) ? normalize(vNormal) : normalize(physicalNormal);

    vec3 dNdx = dFdx(physicalNormal);
    vec3 dNdy = dFdy(physicalNormal);
    float curvature = clamp(sqrt(dot(dNdx, dNdx) + dot(dNdy, dNdy)) * 2.5, 0.0, 1.0);

    if (uEnableCurvatureView > 0.5) {
        gl_FragColor = vec4(vec3(curvature), 1.0);
        return;
    }

    vec3 lightDir = normalize(uLightDirection);

    vec3 crossFlow = cross(physicalNormal, lightDir);
    vec2 flowDirection = normalize(crossFlow.xy + vec2(dNdx.x, dNdy.y) * 0.4);
    if (dot(flowDirection, flowDirection) < 1e-5) flowDirection = vec2(1.0, 0.0);

    vec3 N_final = (uEnableLowPoly > 0.5) ? quantizeNormalSpherical(physicalNormal, uFacetSteps) : physicalNormal;

    // --- Impasto Calculation ---
    BrushStroke stroke;
    stroke.mask = 0.0; stroke.height = 0.0; stroke.normalOffset = vec2(0.0); stroke.bristle = 0.0; stroke.strokeSeed = 0.0;
    vec3 N_impasto = N_final;

    if (uEnableImpasto > 0.5 && uImpastoStrength > 0.001) {
        stroke = evaluateBrushStroke(renderUv, flowDirection, uBrushScale, uImpastoHeight, uBristleDensity, uImpastoStrength);
        
        vec3 T = normalize(cross(N_final, vec3(0.0, 1.0, 0.0)));
        if (length(T) < 0.001) T = normalize(cross(N_final, vec3(1.0, 0.0, 0.0)));
        vec3 B = normalize(cross(N_final, T));

        vec3 perturbation = T * stroke.normalOffset.x + B * stroke.normalOffset.y;
        N_impasto = normalize(N_final + perturbation);
    }

    // --- Lighting & Color ---
    float rawNdotL = dot(N_impasto, lightDir);
    float strokeNdotL = clamp((rawNdotL + uLightSoftness) / (1.0 + uLightSoftness), 0.0, 1.0) * uLightStrength;

    // Scale seed jitter with strength so flat setting has zero luminance variation
    if (uEnableImpasto > 0.5 && stroke.mask > 0.0) {
        strokeNdotL = clamp(strokeNdotL + (stroke.strokeSeed - 0.5) * 0.25 * uImpastoStrength, 0.0, 1.0);
    }

    vec3 rawTextureColor = (uHasTexture > 0.5) ? texture2D(uBaseTexture, renderUv).rgb : vec3(1.0);
    vec3 baseColor = mix(rawTextureColor, N_impasto * 0.5 + 0.5, uStripColor);

    vec3 strokeColor = applyVibrantPalette(baseColor, strokeNdotL, N_impasto);
    
    // Blend stroke colors based on effective strength
    float strokeBlend = smoothstep(0.01, 0.25, stroke.mask) * uImpastoStrength;
    vec3 painterlyColor = mix(baseColor * vec3(0.05, 0.02, 0.10), strokeColor, mix(1.0, strokeBlend, uImpastoStrength));

    if (uEnableImpasto > 0.5 && stroke.mask > 0.1) {
        painterlyColor += vec3(stroke.height * 0.35);
    }
    // Ben-Day Dots Pass
    if (uEnableBenDay > 0.5) {
        BenDayOutput benDay = evaluateBenDayDots(renderUv, strokeNdotL, uBenDayScale, uBenDayBlur, uBenDayType, uBenDayEmissive);
        painterlyColor = mix(painterlyColor, benDay.color, benDay.intensity * uBenDayStrength);
    }

    // Graffiti Emission Pass
    if (uEnableGraffiti > 0.5) {
        GraffitiOutput graffiti = evaluateGraffitiEmission(
            renderUv, 
            uGraffitiScale, 
            uGraffitiThreshold, 
            uGraffitiGlow, 
            uTime, 
            uGraffitiColor
        );
        painterlyColor += graffiti.color;
    }

    // Rim Light Pass
    if (uEnableRimLight > 0.5) {
        vec3 viewDir = normalize(-vPosition);
        float NdotV = clamp(dot(viewDir, N_impasto), 0.0, 1.0);
        float rimFactor = 1.0 - NdotV;

        float edgeThreshold = 1.0 - clamp(uRimWidth, 0.01, 0.95);
        float edgeSharpness = 0.02;
        float rimIntensity = smoothstep(edgeThreshold, edgeThreshold + edgeSharpness, rimFactor);

        vec3 rimPrimary = (uRimColorMode > 0.5) ? vec3(1.0, 0.1, 0.2) : vec3(0.0, 0.9, 1.0);
        vec3 rimSecondary = (uRimColorMode > 0.5) ? vec3(0.1, 0.3, 1.0) : vec3(1.0, 0.0, 0.8);
        vec3 rimColor = mix(rimPrimary, rimSecondary, step(0.0, dot(cross(viewDir, vec3(0.0, 1.0, 0.0)), N_impasto)));

        painterlyColor += rimColor * rimIntensity * uRimStrength;
    }

    gl_FragColor = vec4(painterlyColor, curvature);
}