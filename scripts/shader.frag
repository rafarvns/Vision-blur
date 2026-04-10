// Max supported tokens to track simultaneously
const int MAX_TOKENS = 10;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;

uniform vec2 uTokenPos[MAX_TOKENS];      // Array of token centers
uniform float uTokenClear[MAX_TOKENS];   // Array of clear vision flags

uniform int uTokenCount;                 // Number of active tokens
uniform float uRingDistances[10];
uniform float uRingBlurs[10];
uniform int uRingCount;
uniform float uTransitionFactor;

uniform vec2 uResolution;                // Screen resolution

const float GOLDEN_ANGLE = 2.39996323;
const float ITERATIONS = 40.0; 

// Golden Angle Sampling for smooth, distinct "Bokeh" / Frosted look
vec4 bokehBlur(sampler2D sampler, vec2 uv, float strength) {
    vec4 color = vec4(0.0);
    float total = 0.0;
    
    float radius = strength * 2.0; 

    // Aspect ratio correction for the blur circle
    float aspect = uResolution.x / uResolution.y;

    for (float i = 0.0; i < ITERATIONS; i++) {
        float r = sqrt(i) * radius / uResolution.x;
        float theta = i * GOLDEN_ANGLE;
        
        vec2 offset = vec2(cos(theta), sin(theta)) * r;
        offset.y *= aspect; 

        color += texture2D(sampler, uv + offset);
        total += 1.0;
    }
    return color / total;
}

void main() {
    // Correct aspect ratio for distance calculation
    vec2 aspectVec = uResolution / min(uResolution.x, uResolution.y);
    vec2 uvCorrected = vTextureCoord * aspectVec;

    // Default max blur from the last ring
    float finalPixelBlur = uRingCount > 0 ? uRingBlurs[uRingCount - 1] : 0.0;

    // Soft edge for the clear circle
    float edgeSoftness = 0.1; 

    for (int i = 0; i < MAX_TOKENS; i++) {
        if (i >= uTokenCount) break;

        if (uTokenClear[i] > 0.5) {
            // Token has clear vision, clears everything
            finalPixelBlur = 0.0;
            break; 
        }

        vec2 posCorrected = uTokenPos[i] * aspectVec;
        float dist = distance(uvCorrected, posCorrected);
        
        // Evaluate token's blur at this distance
        float tokenBlur = uRingCount > 0 ? uRingBlurs[uRingCount - 1] : 0.0;
        float prevDist = 0.0;

        for (int r = 0; r < 10; r++) {
            if (r >= uRingCount) break;
            float rDist = uRingDistances[r];
            float rBlur = uRingBlurs[r];
            
            // smoothstep between prevDist and rDist? Or rather, just smoothstep at rDist?
            // Actually, the simplest is evaluating the blur by step/smoothstep at boundaries.
            // If we are strictly *inside* rDist:
            // But we want it to blend between rings. We'll simply use smoothstep at each ring outer edge.
            // Wait, if we use smoothstep, we want tokenBlur to be exactly rBlur inside the ring, 
            // and smoothly transition to next ring blur at the boundary.
            if (dist < rDist - edgeSoftness) {
                tokenBlur = rBlur;
                break;
            } else if (dist < rDist + edgeSoftness) {
                // we are at the boundary between this ring and the next
                float nextBlur = (r + 1 < uRingCount) ? uRingBlurs[r+1] : rBlur;
                float blend = smoothstep(rDist - edgeSoftness, rDist + edgeSoftness, dist);
                tokenBlur = mix(rBlur, nextBlur, blend);
                break;
            }
        }
        
        // Take the clearest value (Union of clear areas)
        finalPixelBlur = min(finalPixelBlur, tokenBlur);
    }

    vec4 originalColor = texture2D(uSampler, vTextureCoord);
    
    float appliedBlur = finalPixelBlur * uTransitionFactor;

    // Optimization: if clear enough, skip blur
    if (appliedBlur < 0.01) {
        gl_FragColor = originalColor;
        return;
    }

    // Apply High Quality Blur
    vec4 blurredColor = bokehBlur(uSampler, vTextureCoord, appliedBlur);

    // If we passed the blur radius to bokehBlur, we should mix 100% of the blurred color.
    // Wait, if appliedBlur is very small, bokehBlur will do a very small blur. We don't need mix() anymore!
    // Except it might be slightly faster to mix original if we want, but bokehBlur correctly blurs less at lower strengths.

    gl_FragColor = blurredColor;
}
