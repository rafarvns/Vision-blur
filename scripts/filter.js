/**
 * Custom PIXI Filter for Vision Blurring
 */
export class VisionBlurFilter extends PIXI.Filter {
    constructor(vertex, fragment) {
        super(vertex, fragment);
        this.uniforms.uTokenPos    = new Float32Array(20); // 10 tokens * 2 coords
        this.uniforms.uTokenClear  = new Float32Array(10); // 10 tokens * 1 flag
        this.uniforms.uTokenCount  = 0;

        // Ring data — initialized with a single ring at dist=0.1 with blur=0
        // so the shader compiles and runs safely before the first update() call.
        this.uniforms.uRingDistances = new Float32Array(10);
        this.uniforms.uRingBlurs     = new Float32Array(10);
        this.uniforms.uRingDistances[0] = 0.1;
        this.uniforms.uRingBlurs[0]     = 0.0;
        this.uniforms.uRingCount     = 1;

        this.uniforms.uTransitionFactor = 1.0;
        this.uniforms.uResolution       = [window.innerWidth, window.innerHeight];
    }

    /**
     * Update the filter uniforms each frame.
     * @param {Object} data
     * @param {Array}  data.tokens          - [{pos:[x,y], clearVision:0|1}, ...]
     * @param {Array}  data.ringDistances   - UV-space distances per ring
     * @param {Array}  data.ringBlurs       - blur strength per ring
     * @param {number} data.transitionFactor - 0.0–1.0 fade multiplier
     */
    update(data) {
        if (data.tokens) {
            let count = 0;
            for (const t of data.tokens) {
                if (count >= 10) break;
                this.uniforms.uTokenPos[count * 2]     = t.pos[0];
                this.uniforms.uTokenPos[count * 2 + 1] = t.pos[1];
                this.uniforms.uTokenClear[count]        = t.clearVision;
                count++;
            }
            this.uniforms.uTokenCount = count;
        }

        if (data.ringDistances && data.ringBlurs) {
            let rCount = 0;
            for (let i = 0; i < data.ringDistances.length && rCount < 10; i++) {
                this.uniforms.uRingDistances[rCount] = data.ringDistances[i];
                this.uniforms.uRingBlurs[rCount]     = data.ringBlurs[i];
                rCount++;
            }
            this.uniforms.uRingCount = rCount;
        }

        if (data.transitionFactor !== undefined) {
            this.uniforms.uTransitionFactor = data.transitionFactor;
        }

        this.uniforms.uResolution = [canvas.app.renderer.width, canvas.app.renderer.height];
    }
}
