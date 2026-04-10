import { VisionBlurFilter } from "./filter.js";

const MODULE_ID = "vision-blur";
const LOG = (...args) => console.log("[VB]", ...args);
const WARN = (...args) => console.warn("[VB]", ...args);
let visionFilter;

LOG("Script loaded");

Hooks.on("init", function () {
  LOG("Hook: init — registering settings");

  // Register Settings
  game.settings.register(MODULE_ID, "visionRange", {
    name: "Vision Range (Grid Units)",
    hint: "The distance in grid units a player can see clearly. You can use spectrums like '0-10-15-20'.",
    scope: "world",
    config: true,
    type: String,
    default: "10"
  });

  game.settings.register(MODULE_ID, "blurStrength", {
    name: "Blur Strength",
    hint: "Intensity of the blur effect (e.g., '2' or '0-1-2-3').",
    scope: "world",
    config: true,
    type: String,
    default: "2"
  });

  game.settings.register(MODULE_ID, "gmBlurEnabled", {
    name: "Enable Blur for GM",
    hint: "If enabled, the GM will see the blur when controlling a token. When no token is controlled, the GM will have full vision.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "darkvisionBlurOnly", {
    name: "Enable Only with Darkvision",
    hint: "If enabled, the blur effect will only activate when the token is using Darkvision (e.g. in darkness).",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
});

Hooks.on("canvasReady", async function () {
  LOG("Hook: canvasReady — fetching shader and creating filter");

  // Load shader source
  const shaderUrl = `modules/${MODULE_ID}/scripts/shader.frag`;
  LOG("Fetching shader from:", shaderUrl);
  const fragSrc = await fetch(shaderUrl).then(r => r.text());
  LOG(`Shader loaded (${fragSrc.length} chars)`);

  // Create Filter
  visionFilter = new VisionBlurFilter(undefined, fragSrc);
  LOG("VisionBlurFilter created:", visionFilter);

  // Add to canvas stage
  canvas.app.stage.filters = [visionFilter];
  LOG("Filter added to canvas.app.stage.filters");

  // Add Ticker to update uniforms relative to token position
  canvas.app.ticker.add(updateFilter);
  LOG("Ticker registered — filter is live");
});

// State variables for transition
let currentBlurFactor = 0; // 0 to 1
let targetBlurFactor = 0;  // 0 or 1
let frameCounter = 0;
const LOGIC_THROTTLE = 10;
const BLUR_SPEED = 0.05;

// Store the calculated token data for the shader
let activeTokensData = [];

// Throttle uniform-dump logs to once every ~2 seconds (~120 frames)
let _logUniformCounter = 0;
const LOG_UNIFORM_THROTTLE = 120;

/**
 * Parse a spectrum string like "0-10-15-20" into an array of numbers.
 * A plain number like "10" returns [10] (backward compatible).
 */
function parseSpectrum(val) {
  if (!val && val !== 0) return [0];
  const parts = String(val).split("-").map(x => parseFloat(x.trim())).filter(x => !isNaN(x));
  return parts.length > 0 ? parts : [0];
}

function updateFilter() {
  if (!visionFilter || !canvas.ready) return;

  // 1. Logic Check (Throttled)
  // We need to run this periodically to update which tokens are relevant and their states
  frameCounter++;
  if (frameCounter >= LOGIC_THROTTLE) {
    frameCounter = 0;
    updateTokenLogic();
  }

  // 2. Transition Logic (Every Frame)
  if (Math.abs(currentBlurFactor - targetBlurFactor) > 0.001) {
    currentBlurFactor += (targetBlurFactor - currentBlurFactor) * BLUR_SPEED;
  } else {
    currentBlurFactor = targetBlurFactor;
  }

  // Optimize: Disable filter if effectively off
  if (currentBlurFactor < 0.01 && targetBlurFactor === 0) {
    if (visionFilter.enabled) {
      visionFilter.enabled = false;
      LOG("Filter DISABLED (faded out)");
    }
    return;
  }

  // Enable filter if it should be visible
  if (!visionFilter.enabled && currentBlurFactor > 0.01) {
    visionFilter.enabled = true;
    LOG("Filter ENABLED (fading in, factor:", currentBlurFactor.toFixed(3), ")");
  }

  // If filter is disabled, skip uniform updates
  if (!visionFilter.enabled) return;

  // 3. Update Uniforms
  const renderer = canvas.app.renderer;
  const scale    = canvas.stage.scale.x;
  const minDim   = Math.min(renderer.width, renderer.height);

  const rawRange = game.settings.get(MODULE_ID, "visionRange");
  const rawBlur  = game.settings.get(MODULE_ID, "blurStrength");

  const rangeUnitsArray   = parseSpectrum(rawRange);
  const blurStrengthArray = parseSpectrum(rawBlur);

  // Pad arrays to equal length (repeat last value)
  const maxLen = Math.max(rangeUnitsArray.length, blurStrengthArray.length);
  while (rangeUnitsArray.length   < maxLen) rangeUnitsArray.push(rangeUnitsArray[rangeUnitsArray.length - 1]);
  while (blurStrengthArray.length < maxLen) blurStrengthArray.push(blurStrengthArray[blurStrengthArray.length - 1]);

  // Convert grid-unit distances to UV space (normalized by smallest screen dimension)
  const rangeUVArray = rangeUnitsArray.map(r => (r * canvas.dimensions.size * scale) / minDim);

  const tokensForShader = [];
  for (const tData of activeTokensData) {
    const token = tData.token;
    if (!token || !token.visible) continue;

    const screenPos = canvas.stage.transform.worldTransform.apply(token.center);
    tokensForShader.push({
      pos:        [screenPos.x / renderer.width, screenPos.y / renderer.height],
      clearVision: tData.hasClearVision ? 1.0 : 0.0
    });
  }

  visionFilter.update({
    tokens:           tokensForShader,
    ringDistances:    rangeUVArray,
    ringBlurs:        blurStrengthArray,
    transitionFactor: currentBlurFactor
  });

  // Throttled uniform dump (once every ~2 sec)
  _logUniformCounter++;
  if (_logUniformCounter >= LOG_UNIFORM_THROTTLE) {
    _logUniformCounter = 0;
    LOG("── Uniform snapshot ──────────────────────────────────");
    LOG("  rawRange       :", rawRange,  "→", rangeUnitsArray,  "→ UV:", rangeUVArray.map(v => v.toFixed(4)));
    LOG("  rawBlur        :", rawBlur,   "→", blurStrengthArray);
    LOG("  ringCount      :", rangeUVArray.length);
    LOG("  tokenCount     :", tokensForShader.length);
    LOG("  tokens         :", tokensForShader.map(t => `(${t.pos[0].toFixed(3)},${t.pos[1].toFixed(3)}) clear=${t.clearVision}`));
    LOG("  targetFactor   :", targetBlurFactor);
    LOG("  currentFactor  :", currentBlurFactor.toFixed(4));
    LOG("  filter.enabled :", visionFilter.enabled);
    LOG("──────────────────────────────────────────────────────");
  }
}

function updateTokenLogic() {
  const { isGM } = game.user;
  const gmEnabled     = game.settings.get(MODULE_ID, "gmBlurEnabled");
  const darkvisionOnly = game.settings.get(MODULE_ID, "darkvisionBlurOnly");

  activeTokensData = [];

  // GM Logic
  if (isGM && !gmEnabled) {
    if (targetBlurFactor !== 0) LOG("GM with gmBlurEnabled=false → disabling blur");
    targetBlurFactor = 0;
    return;
  }

  // Gather Candidate Tokens
  let candidates = [];

  // A. Controlled Tokens (Primary)
  if (canvas.tokens.controlled.length > 0) {
    candidates = [...canvas.tokens.controlled];
  }
  // B. Fallback to Owned Tokens (Player only)
  else if (!isGM) {
    if (game.user.character) {
      // Active tokens for the assigned character
      const charTokens = game.user.character.getActiveTokens();
      if (charTokens.length) candidates = [...charTokens];
    }

    // If still none, try any owned token
    if (candidates.length === 0) {
      // This can be expensive if map is huge, but usually active tokens are few
      candidates = canvas.tokens.placeables.filter(t => t.isOwner);
    }
  }

  // If no candidates, disable blur
  if (candidates.length === 0) {
    if (targetBlurFactor !== 0) LOG("No candidate tokens found → disabling blur");
    targetBlurFactor = 0;
    return;
  }

  LOG(`Candidates: ${candidates.length} token(s) → [${candidates.map(t => t.name || t.id).join(", ")}]`);

  // Process Each Candidate
  let atLeastOneNeedsBlur = false;

  // Helper for Light Checks
  const getSources = (sources) => {
    if (!sources) return [];
    if (sources instanceof Map || sources instanceof Set) return sources.values();
    if (Array.isArray(sources)) return sources;
    if (sources.contents) return sources.contents;
    return [];
  };

  const lightSourcesFn = canvas.effects.lightSources || canvas.effects.illumination?.sources;
  const darknessSourcesFn = canvas.effects.darknessSources || canvas.effects.illumination?.sources;

  // Check Global Illumination
  let globalLight = false;
  if (canvas.scene?.environment?.globalLight) {
    if (typeof canvas.scene.environment.globalLight.enabled !== 'undefined') {
      globalLight = canvas.scene.environment.globalLight.enabled;
    } else {
      globalLight = !!canvas.scene.environment.globalLight;
    }
  } else if (typeof canvas.environment?.globalLight !== 'undefined') {
    globalLight = canvas.environment.globalLight;
  }

  for (const token of candidates) {
    // Logic per token
    // Default assumption: The token is subject to blur (limited vision)
    // unless "Darkvision Only" logic says otherwise.

    let hasClearVision = false; // "Clear Vision" means effectively no blur limit

    if (darkvisionOnly) {
      const activeModeId = token.document.sight.visionMode || token.vision?.mode?.id;

      // 1. Not Darkvision? -> Clear Vision
      if (activeModeId !== "darkvision") {
        hasClearVision = true;
      }
      // 2. Darkvision but In Light? -> Clear Vision
      else {
        let inLight = false;

        // Point Sources
        for (const source of getSources(lightSourcesFn)) {
          if (!source.active) continue;
          const data = source.document ? source.document : source.data;
          if ((data.dim > 0 || data.bright > 0) && source.shape.contains(token.center.x, token.center.y)) {
            inLight = true;
            break;
          }
        }

        // Global Light (if not suppressed)
        if (!inLight && globalLight) {
          let inDarknessSource = false;
          for (const source of getSources(darknessSourcesFn)) {
            if (!source.active) continue;
            const data = source.document ? source.document : source.data;
            if (data.luminosity < 0 && source.shape.contains(token.center.x, token.center.y)) {
              inDarknessSource = true;
              break;
            }
          }
          if (!inDarknessSource) inLight = true;
        }

        if (inLight) {
          hasClearVision = true;
        }
      }
    }

    // If "Darkvision Only" is OFF, then ALL tokens are subject to blur (hasClearVision = false).
    // If ON, only those failing the check are subject to blur.

    activeTokensData.push({ token, hasClearVision });

    // If at least one token is in a state that requires blur (i.e. NOT clear vision),
    // we generally want the blur effect active (masking the unknown).
    // Wait, if I have Token A (Dark, needs blur) and Token B (Light, clear),
    // The filter SHOULD be active, but Token B will punch a huge hole in it.
    // So yes, we need the filter ON.
    // The filter is only OFF if *everyone* has clear vision? 
    // Actually, if everyone has clear vision (radius 10.0), the filter effectively does nothing,
    // so we can disable it for performance.
    if (!hasClearVision) {
      atLeastOneNeedsBlur = true;
    }
  }

  // However, if "Darkvision Only" is NOT enabled, then `hasClearVision` is always false.
  // In that case, we definitely need blur.
  // If "Darkvision Only" IS enabled:
  // - A (Dark): hasClearVision = false.
  // - B (Light): hasClearVision = true.
  // We want filter ON. A contributes small hole, B contributes huge hole.
  // If all are Light -> All true -> Filter effectively invisible -> Can be OFF.

  // So, if we have active tokens, we generally want the filter ON, 
  // unless we can prove it's useless.
  // For simplicity, let's keep it ON if there are candidates, 
  // and let the optimization in updateFilter (currentBlurFactor) handle fading out 
  // if we set target to 0?
  // No, we need to decide targetBlurFactor here.

  // Logic: "Hinder Metagaming"
  // If "Enable Only with Darkvision" is ON:
  // If ANY token is in the Dark (needs blur), we must enforce the blur for everyone.
  // We only disable the blur if ALL tokens are in the Light (clear vision).

  if (darkvisionOnly) {
    const anyInDark = activeTokensData.some(t => !t.hasClearVision);
    LOG(`darkvisionOnly=true | anyInDark=${anyInDark}`);

    if (anyInDark) {
      for (const tData of activeTokensData) tData.hasClearVision = false;
      targetBlurFactor = 1;
      LOG("→ targetBlurFactor = 1 (dark token present)");
    } else {
      for (const tData of activeTokensData) tData.hasClearVision = false;
      targetBlurFactor = 0;
      LOG("→ targetBlurFactor = 0 (all in light)");
    }
  } else {
    targetBlurFactor = 1;
    LOG("Normal mode → targetBlurFactor = 1");
  }
}
