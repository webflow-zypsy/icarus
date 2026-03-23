/**
 * webgl-fallback.js  —  ES Module
 * ─────────────────────────────────────────────────────────────────────────────
 * WebGL capability detection and per-scene fallback activation for the three
 * Icarus Three.js scenes:
 *
 *   • #scene-background  (hero sky / landscape background)
 *   • #scene-drone       (hero drone model)
 *   • #connect-drone     (connect section drone + sky)
 *
 * HOW FALLBACKS WORK
 * ───────────────────
 * In Webflow, add the attribute [data-threejs-fallback] to any element you
 * want shown when a scene fails. Place it inside or alongside the scene's
 * mount div. The script finds every [data-threejs-fallback] element that is
 * a descendant of, or shares a parent/grandparent container with, the failed
 * mount div, then sets:
 *
 *   display:    block
 *   opacity:    1
 *   visibility: visible
 *
 * Multiple fallback elements per scene are supported (e.g. a background image
 * AND a foreground drone image, both tagged [data-threejs-fallback]).
 *
 * USAGE IN SCENE FILES
 * ─────────────────────
 * Import at the top of each scene file, before any Three.js imports:
 *
 *   import { webglAvailable, activateFallback } from "./webgl-fallback.js"
 *
 * At the start of each init function add an early-exit guard:
 *
 *   if (!webglAvailable()) { activateFallback("scene-background"); return }
 *
 * Wrap each new THREE.WebGLRenderer(...) in a try/catch:
 *
 *   let renderer
 *   try {
 *     renderer = new THREE.WebGLRenderer({ antialias: false })
 *   } catch (e) {
 *     console.warn("[scene] WebGLRenderer threw:", e.message)
 *     activateFallback("scene-background")
 *     return
 *   }
 *
 * PROBE TIMING
 * ─────────────
 * probeWebGL() runs automatically at module evaluation time — before any
 * scene init fires — so the result is always ready with zero async overhead.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Internal probe state ─────────────────────────────────────────────────────
// null  = not yet run
// true  = WebGL is functional
// false = WebGL is unavailable or broken
let _probeResult = null

// ─── probeWebGL() ─────────────────────────────────────────────────────────────
/**
 * Silently tests WebGL availability using a throwaway canvas.
 * Covers all common failure modes:
 *   - getContext() returns null (no GPU / driver disabled)
 *   - context is immediately lost (FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS)
 *   - first draw call returns a GL error
 *
 * @returns {boolean}  true if WebGL appears functional, false otherwise.
 *                     Repeated calls return the cached result.
 */
export function probeWebGL() {
  if (_probeResult !== null) return _probeResult

  try {
    const canvas = document.createElement("canvas")
    // Prefer WebGL2; fall back to WebGL1 / experimental
    const gl = (
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")
    )

    if (!gl) {
      return _fail("getContext() returned null — no WebGL support")
    }

    // Immediately-lost context = driver exhaustion (the Firefox/macOS error)
    if (typeof gl.isContextLost === "function" && gl.isContextLost()) {
      return _fail("context lost immediately after creation (driver exhausted)")
    }

    // Minimal draw operation to confirm the driver is actually alive
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    const err = gl.getError()
    if (err !== gl.NO_ERROR) {
      return _fail(`gl.getError() = ${err} on first clear`)
    }

    // Release GPU resources before discarding the canvas
    const loseCtx = gl.getExtension("WEBGL_lose_context")
    if (loseCtx) loseCtx.loseContext()

    _probeResult = true
    return true

  } catch (e) {
    return _fail(e.message)
  }
}

/**
 * Returns the cached probe result, running the probe first if needed.
 * Safe to call at any time; never throws.
 *
 * @returns {boolean}
 */
export function webglAvailable() {
  if (_probeResult === null) probeWebGL()
  return _probeResult === true
}

// ─── activateFallback(mountId?) ───────────────────────────────────────────────
/**
 * Reveals every [data-threejs-fallback] element associated with a scene.
 *
 * The search walks the DOM in three passes:
 *   1. Inside the mount div itself.
 *   2. Siblings within the mount's parent container.
 *   3. Siblings within the mount's grandparent container (handles typical
 *      Webflow nesting where the fallback image lives one wrapper level up).
 *
 * Any <canvas> elements already inserted by Three.js are hidden to prevent
 * a blank transparent rectangle sitting above the fallback content.
 *
 * @param {string} [mountId]  The id of the Three.js mount div (e.g.
 *                            "scene-background"). Omit to activate fallbacks
 *                            for ALL three scenes at once.
 */
export function activateFallback(mountId) {
  const ids = mountId
    ? [mountId]
    : ["scene-background", "scene-drone", "connect-drone"]

  for (const id of ids) {
    const mount = document.getElementById(id)
    if (!mount) {
      console.warn(`[webgl-fallback] Mount #${id} not found in DOM`)
      continue
    }

    // Hide any canvas Three.js may have already appended
    mount.querySelectorAll("canvas").forEach(c => {
      c.style.display = "none"
    })

    // Collect all [data-threejs-fallback] elements relevant to this scene
    const fallbacks = _findFallbacks(mount)

    if (fallbacks.length === 0) {
      console.warn(`[webgl-fallback] No [data-threejs-fallback] elements found for #${id}`)
      continue
    }

    for (const el of fallbacks) {
      el.style.display    = "block"
      el.style.opacity    = "1"
      el.style.visibility = "visible"
    }

    console.info(`[webgl-fallback] ${fallbacks.length} fallback element(s) activated for #${id}`)
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Collects all [data-threejs-fallback] elements associated with a mount div.
 * Searches inside the mount, then in the parent and grandparent containers
 * to cover typical Webflow section nesting patterns.
 *
 * @param   {HTMLElement} mount
 * @returns {HTMLElement[]}
 */
function _findFallbacks(mount) {
  const results = []
  const seen    = new Set()

  function collect(root) {
    if (!root) return
    root.querySelectorAll("[data-threejs-fallback]").forEach(el => {
      if (!seen.has(el)) { seen.add(el); results.push(el) }
    })
  }

  collect(mount)                              // children of the mount div
  collect(mount.parentElement)               // siblings of the mount div
  collect(mount.parentElement?.parentElement) // one level further up

  return results
}

/**
 * Records a failed probe, sets a global flag, and returns false.
 *
 * @param   {string} reason  Human-readable reason for the failure.
 * @returns {false}
 */
function _fail(reason) {
  _probeResult = false
  window.__webglUnavailable = true
  console.warn(`[webgl-fallback] WebGL unavailable — ${reason}`)
  return false
}

// ─── Auto-probe at module evaluation time ────────────────────────────────────
// Runs immediately when the module is first imported, before any scene init.
probeWebGL()
