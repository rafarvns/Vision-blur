/**
 * Custom PIXI Filter for Vision Blurring
 */
export class VisionBlurFilter extends PIXI.Filter {
    constructor(vertex, fragment) {
        super(vertex, fragment);
        this.uniforms.uTokenPos = new Float32Array(20); // 10 tokens * 2 coordinates
        this.uniforms.uTokenClear = new Float32Array(10); // 10 tokens * 1 clear flag
        this.uniforms.uTokenCount = 0;
        this.uniforms.uRingDistances = new Float32Array(10);
        this.uniforms.uRingBlurs = new Float32Array(10);
        this.uniforms.uRingCount = 0;
        this.uniforms.uTransitionFactor = 1.0;
        this.uniforms.uResolution = [window.innerWidth, window.innerHeight];
    }

    /**
     * Update the filter settings
     */
    update(data) {
        if (data.tokens) {
            let count = 0;
            for (const t of data.tokens) {
                if (count >= 10) break;
                this.uniforms.uTokenPos[count * 2] = t.pos[0];
                this.uniforms.uTokenPos[count * 2 + 1] = t.pos[1];
                this.uniforms.uTokenClear[count] = t.clearVision;
                count++;
            }
            this.uniforms.uTokenCount = count;
        }

        if (data.ringDistances && data.ringBlurs) {
            let rCount = 0;
            for (let i = 0; i < data.ringDistances.length; i++) {
                if (rCount >= 10) break;
                this.uniforms.uRingDistances[rCount] = data.ringDistances[i];
                this.uniforms.uRingBlurs[rCount] = data.ringBlurs[i];
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
