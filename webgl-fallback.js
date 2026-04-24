/**
 * webgl-fallback.js  —  ES Module
 * WebGL detection and per-scene fallback activation.
 *
 * Usage in each scene file:
 *   import { webglAvailable, activateFallback } from "./webgl-fallback.js"
 *
 *   if (!webglAvailable()) { activateFallback("scene-background"); return }
 *
 *   try {
 *     renderer = new THREE.WebGLRenderer({ antialias: false })
 *   } catch (e) {
 *     activateFallback("scene-background"); return
 *   }
 *
 * Fallbacks: add [data-threejs-fallback] to any element that should appear
 * when a scene fails. The script searches inside the mount div, then its
 * parent and grandparent (covers typical Webflow nesting).
 *
 * Fallback breakpoint values:
 *   data-threejs-fallback="all"      — visible at all breakpoints
 *   data-threejs-fallback="desktop"  — visible at min-width: 992px
 *   data-threejs-fallback="tablet"   — visible between 768px and 991px
 *   data-threejs-fallback="mobile"   — visible at max-width: 767px
 */

let _probeResult = null
let _fallbackStyleInjected = false

function triggerHeroAnimation() {
  if (window.__heroAnimTriggered) return
  window.__heroAnimTriggered = true
  document.querySelector('.home-hero_animation-trigger')?.click()
}

/**
 * Returns true if the device is a phone or tablet.
 * Uses two signals so modern iPads (which send a desktop UA) are still caught:
 *   - User-agent keyword match
 *   - CSS "pointer: coarse" (finger/stylus as primary input)
 */
function _isMobileOrTablet() {
  const uaMatch = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet/i
    .test(navigator.userAgent)
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches
  return uaMatch || coarsePointer
}

/**
 * Tests WebGL with a throwaway canvas.
 * Short-circuits on mobile/tablet before any GL context is created.
 * Covers: null context, immediate context loss, and first-draw GL errors.
 * Result is cached — safe to call multiple times.
 */
export function probeWebGL() {
  if (_probeResult !== null) return _probeResult
  if (_isMobileOrTablet()) return _fail("mobile/tablet device — WebGL disabled")
  try {
    const canvas = document.createElement("canvas")
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    if (!gl) return _fail("getContext() returned null")
    if (typeof gl.isContextLost === "function" && gl.isContextLost())
      return _fail("context lost immediately after creation")
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const err = gl.getError()
    if (err !== gl.NO_ERROR) return _fail(`gl.getError() = ${err}`)
    const loseCtx = gl.getExtension("WEBGL_lose_context")
    if (loseCtx) loseCtx.loseContext()
    _probeResult = true
    return true
  } catch (e) {
    return _fail(e.message)
  }
}

/** Returns cached probe result, running the probe first if needed. */
export function webglAvailable() {
  if (_probeResult === null) probeWebGL()
  return _probeResult === true
}

/**
 * Injects a <style> block (once) that handles responsive display of all
 * [data-threejs-fallback] elements via native CSS media queries.
 * Using !important ensures Webflow's inline designer styles are overridden.
 */
function _injectFallbackStyles() {
  if (_fallbackStyleInjected) return
  _fallbackStyleInjected = true

  const style = document.createElement("style")
  style.id = "threejs-fallback-styles"
  style.textContent = `
    /* All breakpoints */
    [data-threejs-fallback="all"] {
      display: block !important;
      opacity: 1 !important;
      visibility: visible !important;
    }

    /* Desktop only — min-width: 992px */
    [data-threejs-fallback="desktop"] {
      display: none !important;
    }
    @media (min-width: 992px) {
      [data-threejs-fallback="desktop"] {
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
    }

    /* Tablet only — 768px to 991px */
    [data-threejs-fallback="tablet"] {
      display: none !important;
    }
    @media (min-width: 768px) and (max-width: 991px) {
      [data-threejs-fallback="tablet"] {
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
    }

    /* Mobile only — max-width: 767px */
    [data-threejs-fallback="mobile"] {
      display: none !important;
    }
    @media (max-width: 767px) {
      [data-threejs-fallback="mobile"] {
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
    }

    /* Tablet + Mobile — max-width: 991px */
    [data-threejs-fallback="tablet-mobile"] {
      display: none !important;
    }
    @media (max-width: 991px) {
      [data-threejs-fallback="tablet-mobile"] {
        display: block !important;
        opacity: 1 !important;
        visibility: visible !important;
      }
    }
  `
  document.head.appendChild(style)
}

/**
 * Reveals [data-threejs-fallback] elements for the given mount id.
 * Pass no argument to activate fallbacks for all three scenes at once.
 * Breakpoint-aware display is handled via injected CSS media queries.
 * Also hides any canvas already appended by Three.js.
 * Triggers the hero animation if the failing scene is #scene-background.
 */
export function activateFallback(mountId) {
  const ids = mountId
    ? [mountId]
    : ["scene-background", "scene-drone", "connect-drone"]

  _injectFallbackStyles()

  for (const id of ids) {
    const mount = document.getElementById(id)
    if (!mount) {
      console.warn(`[webgl-fallback] Mount #${id} not found`)
      continue
    }

    // Hide any Three.js canvases already appended to this mount
    mount.querySelectorAll("canvas").forEach(c => {
      c.style.display = "none"
    })

    // Log how many fallback elements were found (display is handled by CSS)
    const fallbacks = _findFallbacks(mount)
    if (fallbacks.length === 0) {
      console.warn(`[webgl-fallback] No [data-threejs-fallback] elements found for #${id}`)
    } else {
      console.info(`[webgl-fallback] ${fallbacks.length} fallback(s) activated for #${id}`)
    }

    if (id === "scene-background") triggerHeroAnimation()
  }
}

function _findFallbacks(mount) {
  const results = []
  const seen = new Set()
  function collect(root) {
    if (!root) return
    root.querySelectorAll("[data-threejs-fallback]").forEach(el => {
      if (!seen.has(el)) {
        seen.add(el)
        results.push(el)
      }
    })
  }
  collect(mount)
  collect(mount.parentElement)
  collect(mount.parentElement?.parentElement)
  return results
}

function _fail(reason) {
  _probeResult = false
  window.__webglUnavailable = true
  console.warn(`[webgl-fallback] WebGL unavailable — ${reason}`)
  return false
}

// Probe immediately at module load time
probeWebGL()
