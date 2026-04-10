// Max supported tokens to track simultaneously
const int MAX_TOKENS = 10;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;

uniform vec2  uTokenPos[MAX_TOKENS];   // Token center positions (normalized UV)
uniform float uTokenClear[MAX_TOKENS]; // 1.0 = infinite clear vision, 0.0 = normal

uniform int   uTokenCount;             // Number of active tokens
uniform float uRingDistances[10];      // Ring boundary distances (normalized UV)
uniform float uRingBlurs[10];          // Blur strength at each ring boundary
uniform int   uRingCount;              // Number of rings configured
uniform float uTransitionFactor;       // Fade in/out multiplier (0.0–1.0)

uniform vec2  uResolution;             // Screen resolution in pixels

const float GOLDEN_ANGLE = 2.39996323;
const float ITERATIONS   = 40.0;

// Bokeh-style blur (Golden Angle spiral sampling)
vec4 bokehBlur(sampler2D sampler, vec2 uv, float strength) {
    vec4  color  = vec4(0.0);
    float total  = 0.0;
    float radius = strength * 2.0;
    float aspect = uResolution.x / uResolution.y;

    for (float i = 0.0; i < ITERATIONS; i++) {
        float r     = sqrt(i) * radius / uResolution.x;
        float theta = i * GOLDEN_ANGLE;
        vec2  offset = vec2(cos(theta), sin(theta)) * r;
        offset.y *= aspect;
        color += texture2D(sampler, uv + offset);
        total += 1.0;
    }
    return color / total;
}

void main() {
    // Aspect-corrected UV for distance calculations
    vec2 aspectVec  = uResolution / min(uResolution.x, uResolution.y);
    vec2 uvCorrected = vTextureCoord * aspectVec;

    // ── Compute maxBlur (blur beyond the outermost ring) ─────────────────────
    // We loop with a constant upper bound (no dynamic uniform indexing in GLSL ES).
    // Each iteration overwrites maxBlur, so it ends up as the LAST ring's blur.
    float maxBlur = 0.0;
    for (int r = 0; r < 10; r++) {
        if (r >= uRingCount) break;
        maxBlur = uRingBlurs[r];
    }

    // Default: this pixel is outside every token's vision → fully blurred
    float finalPixelBlur = maxBlur;

    const float EDGE = 0.05; // Soft transition width at ring boundaries (UV space)

    // ── Per-token evaluation ──────────────────────────────────────────────────
    for (int i = 0; i < MAX_TOKENS; i++) {
        if (i >= uTokenCount) break;

        // Token with globally clear vision clears the entire screen for all tokens
        if (uTokenClear[i] > 0.5) {
            finalPixelBlur = 0.0;
            break;
        }

        vec2  posCorrected = uTokenPos[i] * aspectVec;
        float dist         = distance(uvCorrected, posCorrected);

        // ── Evaluate blur granted by this token at `dist` ─────────────────
        // Ring semantics:
        //   • d < ring[0].dist         → blur = 0       (perfectly clear zone)
        //   • ring[N-1].dist ≤ d < ring[N].dist → blur = ring[N].blur
        //   • d ≥ ring[last].dist       → blur = maxBlur
        //
        // We walk outward through rings, tracking prevBlur at each step.
        // Using only loop-variable indices to stay valid in GLSL ES 1.0.

        float tokenBlur = 0.0;  // inside all rings → clear
        float prevBlur  = 0.0;

        for (int r = 0; r < 10; r++) {
            if (r >= uRingCount) break;

            float rDist = uRingDistances[r];
            float rBlur = uRingBlurs[r];

            if (dist >= rDist + EDGE) {
                // Fully past this ring → accumulate
                tokenBlur = rBlur;
                prevBlur  = rBlur;
            } else if (dist >= rDist - EDGE) {
                // On the boundary → smooth blend from prevBlur → rBlur
                float t   = smoothstep(rDist - EDGE, rDist + EDGE, dist);
                tokenBlur = mix(prevBlur, rBlur, t);
                break;
            } else {
                // Haven't reached this ring → stop, keep tokenBlur as-is
                break;
            }
        }

        // Clearest token wins (union of vision areas)
        finalPixelBlur = min(finalPixelBlur, tokenBlur);
    }

    // ── Apply result ──────────────────────────────────────────────────────────
    vec4  originalColor = texture2D(uSampler, vTextureCoord);
    float appliedBlur   = finalPixelBlur * uTransitionFactor;

    // Skip expensive blur pass when effectively clear
    if (appliedBlur < 0.01) {
        gl_FragColor = originalColor;
        return;
    }

    gl_FragColor = bokehBlur(uSampler, vTextureCoord, appliedBlur);
}
