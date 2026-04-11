// Max supported tokens to track simultaneously
const int MAX_TOKENS = 10;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;

uniform vec2  uTokenPos[MAX_TOKENS];
uniform float uTokenClear[MAX_TOKENS];
uniform int   uTokenCount;
uniform float uRingDistances[10];
uniform float uRingBlurs[10];
uniform int   uRingCount;
uniform float uTransitionFactor;
uniform vec2  uResolution;

const float GOLDEN_ANGLE = 2.39996323;
const float ITERATIONS   = 40.0;

vec4 bokehBlur(sampler2D sampler, vec2 uv, float strength) {
    vec4  color  = vec4(0.0);
    float total  = 0.0;
    float radius = strength * 2.0;
    float aspect = uResolution.x / uResolution.y;

    for (float fi = 0.0; fi < ITERATIONS; fi++) {
        float ri    = sqrt(fi) * radius / uResolution.x;
        float theta = fi * GOLDEN_ANGLE;
        vec2  offset = vec2(cos(theta), sin(theta)) * ri;
        offset.y *= aspect;
        color += texture2D(sampler, uv + offset);
        total += 1.0;
    }
    return color / total;
}

void main() {
    vec2 aspectVec   = uResolution / min(uResolution.x, uResolution.y);
    vec2 uvCorrected = vTextureCoord * aspectVec;

    // ── Step 1: Minimum distance to any token (no nested loops) ──────────
    float minDist = 999.0;

    for (int i = 0; i < MAX_TOKENS; i++) {
        if (i >= uTokenCount) break;

        if (uTokenClear[i] > 0.5) {
            // Token has infinite clear vision → whole screen clear
            gl_FragColor = texture2D(uSampler, vTextureCoord);
            return;
        }

        vec2  posCorrected = uTokenPos[i] * aspectVec;
        float d = distance(uvCorrected, posCorrected);
        if (d < minDist) minDist = d;
    }

    // ── Step 2: Map distance → blur via ring table (sequential loop) ──────
    // Semantics:
    //   d < ring[0].dist                  → blur = 0   (clear zone)
    //   ring[N].dist ≤ d < ring[N+1].dist → blur = ring[N].blur
    //   d ≥ ring[last].dist               → blur = ring[last].blur
    // Rings must be sorted ascending by distance.

    const float EDGE = 0.05;
    float finalBlur = 0.0;
    float prevBlur  = 0.0;

    for (int r = 0; r < 10; r++) {
        if (r >= uRingCount) break;

        float rDist = uRingDistances[r];
        float rBlur = uRingBlurs[r];

        if (minDist >= rDist + EDGE) {
            finalBlur = rBlur;
            prevBlur  = rBlur;
        } else if (minDist >= rDist - EDGE) {
            float t = smoothstep(rDist - EDGE, rDist + EDGE, minDist);
            finalBlur = mix(prevBlur, rBlur, t);
            break;
        } else {
            break;
        }
    }

    // ── Step 3: Apply ─────────────────────────────────────────────────────
    vec4  original    = texture2D(uSampler, vTextureCoord);
    float appliedBlur = finalBlur * uTransitionFactor;

    if (appliedBlur < 0.01) {
        gl_FragColor = original;
        return;
    }

    gl_FragColor = bokehBlur(uSampler, vTextureCoord, appliedBlur);
}
