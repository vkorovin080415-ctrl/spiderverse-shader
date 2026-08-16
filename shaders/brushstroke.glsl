// ============================================================================ 
// MODULE: Dual-Layer Organic Parametric Brush Stroke Engine
// ============================================================================ 

struct BrushStroke {
    float mask;         // Alpha coverage [0.0 - 1.0]
    float height;       // Physical impasto elevation profile
    vec2 normalOffset;  // Derivative gradient offset for specular light catches
    float bristle;      // Internal micro-groove texture value
    float strokeSeed;   // Discrete ID for per-stroke color picking
};

// --- INTERNAL HELPERS ---

vec2 strokeHash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(443.897, 441.423, 437.195));
    p3 += dot(p3, p3.yzx + 19.19);
    return fract((p3.xx + p3.yz) * p3.zy);
}

// Distance to quadratic Bezier curve segment
float sdBezier(vec2 pos, vec2 A, vec2 B, vec2 C, out float outT) {    
    vec2 a = B - A;
    vec2 b = A - 2.0*B + C;
    vec2 c = a * 2.0;
    vec2 d = A - pos;

    float kk = 1.0 / dot(b,b);
    float kx = kk * dot(a,b);
    float ky = kk * (2.0*dot(a,a)+dot(d,b)) / 3.0;
    float kz = kk * dot(d,a);      

    float p = ky - kx*kx;
    float p3 = p*p*p;
    float q = kx*(2.0*kx*kx - 3.0*ky) + kz;
    float h = q*q + 4.0*p3;

    if(h >= 0.0) { 
        h = sqrt(h);
        vec2 x = (vec2(h, -h) - q) / 2.0;
        vec2 uv = sign(x)*pow(abs(x), vec2(1.0/3.0));
        float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
        outT = t;
        vec2 qpos = d + (c + b*t)*t;
        return length(qpos);
    }

    float z = sqrt(-p);
    float v = acos(clamp(q/(p*z*2.0), -1.0, 1.0)) / 3.0;
    float m = cos(v);
    float n = sin(v)*1.732050808;
    vec3 t = clamp(vec3(m+m, -n-m, n-m)*z - kx, 0.0, 1.0);
    
    vec2 qpos1 = d + (c + b*t.x)*t.x;
    float d1 = dot(qpos1, qpos1);
    vec2 qpos2 = d + (c + b*t.y)*t.y;
    float d2 = dot(qpos2, qpos2);
    
    if (d1 < d2) { outT = t.x; return sqrt(d1); }
    else { outT = t.y; return sqrt(d2); }
}

// Parametric Stroke Evaluator: Supports long sweeps and natural oil dabs
BrushStroke evaluateParametricStroke(
    vec2 uv,
    vec2 cellId,
    vec2 flowDir,
    float scale,
    float bristleDensity,
    float strokeType // 0.0 = Long Sweeping Stroke, 1.0 = Short Oil Dab Stroke
) {
    BrushStroke s;
    s.mask = 0.0;
    s.height = 0.0;
    s.normalOffset = vec2(0.0);
    s.bristle = 0.0;
    s.strokeSeed = strokeHash22(cellId + vec2(strokeType * 13.37, strokeType * 71.91)).x;

    vec2 rnd = strokeHash22(cellId + vec2(strokeType * 47.11, strokeType * 89.23));
    
    // Position offset jitter
    vec2 offsetJitter = (rnd - 0.5) * 1.1; 
    vec2 P0 = (cellId + 0.5 + offsetJitter) / scale;
    
    // Directional flow alignment: tight alignment for dabs prevents starburst/leaf shapes
    float angleMult = mix(0.75, 0.35, strokeType);
    float angleJitter = (rnd.y - 0.5) * angleMult;
    float cosA = cos(angleJitter), sinA = sin(angleJitter);
    vec2 dir = vec2(
        flowDir.x * cosA - flowDir.y * sinA,
        flowDir.x * sinA + flowDir.y * cosA
    );
    
    // Elongated stroke length to ensure oil stroke continuity
    float minLen = mix(1.2, 0.75, strokeType);
    float maxLen = mix(2.2, 1.30, strokeType);
    float strokeLen = mix(minLen, maxLen, rnd.x) / scale;
    
    // Curved trajectory control points
    vec2 P2 = P0 + dir * strokeLen;
    vec2 orth = vec2(-dir.y, dir.x);
    float curvatureMult = mix(0.5, 0.15, strokeType);
    vec2 P1 = mix(P0, P2, 0.5) + orth * (rnd.x - 0.5) * (strokeLen * curvatureMult);

    // Distance evaluation
    float t;
    float dist = sdBezier(uv, P0, P1, P2, t);

    // Pressure profile
    float pressure = sin(smoothstep(0.0, 1.0, t) * 3.14159265);
    float radiusMult = mix(0.40, 0.18, strokeType);
    float maxRadius = (radiusMult / scale) * (0.4 + pressure * 0.6) * mix(0.85, 1.15, rnd.y);

    // Parallel bristle grooves running along stroke length
    vec2 strokeTangent = normalize(mix(P1 - P0, P2 - P1, t) + 1e-5);
    vec2 strokeNormal  = vec2(-strokeTangent.y, strokeTangent.x);
    float sideDist = dot(uv - P0, strokeNormal);

    float bristleStrands = sin(sideDist * bristleDensity * (1000.0 + strokeType * 400.0) + s.strokeSeed * 15.0);
    float edgeFray = bristleStrands * maxRadius * mix(0.18, 0.06, strokeType);

    float effectiveDist = dist + edgeFray;
    s.mask = smoothstep(maxRadius, maxRadius * 0.15, effectiveDist);

    if (s.mask > 0.0) {
        float edgeRidge = smoothstep(maxRadius * 0.25, maxRadius, effectiveDist);
        s.height = edgeRidge * pressure * s.mask;
        s.bristle = bristleStrands;
        
        float sideSign = sign(sideDist);
        s.normalOffset = (strokeNormal * sideSign * edgeRidge * 0.85 + strokeTangent * (0.5 - t) * 0.4) * s.mask;
    }

    return s;
}

// Single-Layer Search Window Evaluator
BrushStroke evaluateStrokeLayer(
    vec2 uv,
    vec2 flowDirection,
    float scale,
    float bristleDensity,
    float strokeType
) {
    BrushStroke layerStroke;
    layerStroke.mask = 0.0;
    layerStroke.height = 0.0;
    layerStroke.normalOffset = vec2(0.0);
    layerStroke.bristle = 0.0;
    layerStroke.strokeSeed = 0.0;

    vec2 gridUv = uv * scale;
    vec2 currentCell = floor(gridUv);

    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            vec2 cellId = currentCell + vec2(float(x), float(y));
            
            BrushStroke stroke = evaluateParametricStroke(
                uv,
                cellId,
                flowDirection,
                scale,
                bristleDensity,
                strokeType
            );

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

// Multi-Pass Dual Engine: Combines Long Sweeps and Refined Oil Accent Strokes
BrushStroke evaluateBrushStroke(
    vec2 uv,
    vec2 flowDirection,
    float scale,
    float impastoDepth,
    float bristleDensity
) {
    // Pass 1: Long Sweeping Primary Strokes (original parameters preserved)
    BrushStroke longStrokes = evaluateStrokeLayer(
        uv,
        flowDirection,
        scale * 0.75, // Coarser grid for broad sweeps
        bristleDensity,
        0.0           // Long type
    );

    // Pass 2: Refined Oil Accent Strokes (controlled density)
    BrushStroke shortStrokes = evaluateStrokeLayer(
        uv,
        flowDirection,
        scale * 1.50, // Moderate grid scale for continuous oil strokes
        bristleDensity * 1.6,
        1.0           // Short type
    );

    // Composite Pass: Overlay short accents onto long sweeps
    BrushStroke finalStroke;
    float blendAlpha = smoothstep(0.12, 0.70, shortStrokes.mask);

    finalStroke.mask         = max(longStrokes.mask, shortStrokes.mask);
    finalStroke.height       = mix(longStrokes.height, shortStrokes.height, blendAlpha) * impastoDepth;
    finalStroke.normalOffset = mix(longStrokes.normalOffset, shortStrokes.normalOffset, blendAlpha) * impastoDepth * 12.0;
    finalStroke.bristle      = mix(longStrokes.bristle, shortStrokes.bristle, blendAlpha);
    finalStroke.strokeSeed   = mix(longStrokes.strokeSeed, shortStrokes.strokeSeed, step(0.5, blendAlpha));

    return finalStroke;
}