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
 * Auto-probes WebGL at module evaluation time — result is cached.
 */

let _probeResult = null

function triggerHeroAnimation() {
  if (window.__heroAnimTriggered) return
  window.__heroAnimTriggered = true
  document.querySelector('.home-hero_animation-trigger')?.click()
}

/**
 * Tests WebGL with a throwaway canvas. Covers: null context, immediate
 * context loss (driver exhaustion), and first-draw GL errors.
 * Caches and returns the result on repeat calls.
 */
export function probeWebGL() {
  if (_probeResult !== null) return _probeResult
  try {
    const canvas = document.createElement("canvas")
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl")
    if (!gl) return _fail("getContext() returned null")
    if (typeof gl.isContextLost === "function" && gl.isContextLost()) return _fail("context lost immediately after creation")
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT)
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
 * Reveals [data-threejs-fallback] elements for the given mount id.
 * Pass no argument to activate fallbacks for all three scenes at once.
 * Also hides any canvas already appended by Three.js.
 * Triggers the hero animation if the failing scene is #scene-background.
 */
export function activateFallback(mountId) {
  const ids = mountId
    ? [mountId]
    : ["scene-background", "scene-drone", "connect-drone"]

  for (const id of ids) {
    const mount = document.getElementById(id)
    if (!mount) { console.warn(`[webgl-fallback] Mount #${id} not found`); continue }

    mount.querySelectorAll("canvas").forEach(c => { c.style.display = "none" })

    const fallbacks = _findFallbacks(mount)
    if (fallbacks.length === 0) {
      console.warn(`[webgl-fallback] No [data-threejs-fallback] elements found for #${id}`)
    } else {
      for (const el of fallbacks) {
        el.style.display = "block"; el.style.opacity = "1"; el.style.visibility = "visible"
      }
      console.info(`[webgl-fallback] ${fallbacks.length} fallback(s) activated for #${id}`)
    }

    if (id === "scene-background") triggerHeroAnimation()
  }
}

function _findFallbacks(mount) {
  const results = [], seen = new Set()
  function collect(root) {
    if (!root) return
    root.querySelectorAll("[data-threejs-fallback]").forEach(el => {
      if (!seen.has(el)) { seen.add(el); results.push(el) }
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
