/**
 * drone-scene.js  —  ES Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounts a Three.js drone scene into the #scene-drone element.
 * Scroll is driven by GSAP ScrollTrigger watching #scenes-track.
 *
 * Requires in <head>:
 *   <script type="importmap">
 *   { "imports": { "three": "...", "three/addons/": "..." } }
 *   </script>
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ASSET URLS — update these if you move files
// ═══════════════════════════════════════════════════════════════════════════════
const DRONE_ASSETS = {
  hdr:   "https://webflow-zypsy.github.io/icarus/green-512.hdr",
  model: "https://webflow-zypsy.github.io/icarus/apollo-draco.glb",
}

import * as THREE     from "three"
import { RGBELoader } from "three/addons/loaders/RGBELoader.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js"

window.addEventListener("load", () => {
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
    console.error("[drone-scene] GSAP / ScrollTrigger not found."); return
  }
  gsap.registerPlugin(ScrollTrigger)

  const mountEl = document.getElementById("scene-drone")
  if (!mountEl) { console.error("[drone-scene] #scene-drone not found."); return }

  const clock = new THREE.Clock()
  const scene  = new THREE.Scene()
  let droneObject  = null
  let droneBasePos = new THREE.Vector3()
  let droneBaseRot = new THREE.Euler()

  // ═══════════════════════════════════════════════════════════════════════════
  // BOB / HOVER ANIMATION
  // bobAmp      — vertical travel in world units (model is ~1.4 units tall)
  // bobPeriod   — seconds for one full up-down cycle
  // stallPeriod — seconds between "stall" moments where bob briefly flattens
  // stallDepth  — 0–1, how much the bob flattens during a stall (0 = no stall)
  // pitchAmp    — nose-pitch tilt in radians (very small values look realistic)
  // ═══════════════════════════════════════════════════════════════════════════
  const bobCfg = {
    bobAmp:      0.003,
    bobPeriod:   5.0,
    stallPeriod: 3.0,
    stallDepth:  0.30,
    pitchAmp:    0.009,
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSTRUCTION REVEAL EFFECT
  // On load the drone "builds" from the centre outward:
  //   Phase 1 — orange wireframe expands from centre → wingtips
  //   Phase 2 — orange wireframe fades out while solid carbon fibre fills in
  //
  // wireframeDuration — seconds for phase 1
  // fadeOutDuration   — seconds for phase 2
  // ═══════════════════════════════════════════════════════════════════════════
  const reveal = {
    active: false, startTime: 0,
    wireframeDuration: 1.3,
    fadeOutDuration:   0.8,
    maxRadius: 1,           // computed from geometry at load — don't touch
    wireframeClones: [], wireframeMat: null,
    solidUniforms: { revealRadius: { value: 0 } },
    wireUniforms:  { revealRadius: { value: 0 } },
  }
  const easeOut = t => 1 - Math.pow(1 - t, 3)  // ease-out cubic

  // Injects a centre-outward clip into any Three.js material via shader hooks.
  // Fragments beyond revealRadius (square / Chebyshev distance) are discarded.
  function injectRevealShader(mat, uni) {
    mat.onBeforeCompile = s => {
      s.uniforms.revealRadius = uni.revealRadius
      s.vertexShader = s.vertexShader
        .replace("#include <common>",    "#include <common>\nvarying vec3 vRevealWorldPos;")
        .replace("#include <fog_vertex>","#include <fog_vertex>\nvRevealWorldPos=(modelMatrix*vec4(transformed,1.0)).xyz;")
      s.fragmentShader = s.fragmentShader
        .replace(
          "#include <clipping_planes_pars_fragment>",
          "#include <clipping_planes_pars_fragment>\nuniform float revealRadius;\nvarying vec3 vRevealWorldPos;"
        )
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          "vec4 diffuseColor=vec4(diffuse,opacity);\n{\nfloat revDist=max(abs(vRevealWorldPos.x),abs(vRevealWorldPos.z));\nif(revDist>revealRadius)discard;\n}\n"
        )
    }
    mat.customProgramCacheKey = () => "reveal"
    mat.needsUpdate = true
  }

  // Creates wireframe clones of all meshes (shares geometry buffers, no extra memory).
  function createWireClones(meshes, uni) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff7700, wireframe: true, transparent: true, opacity: 0.6, depthWrite: false,
    })
    injectRevealShader(mat, uni)
    reveal.wireframeMat = mat
    for (const m of meshes) {
      const c = new THREE.Mesh(m.geometry, mat)
      c.position.copy(m.position); c.rotation.copy(m.rotation); c.scale.copy(m.scale)
      c.renderOrder = -1  // render behind the solid mesh
      ;(m.parent || m).add(c)
      reveal.wireframeClones.push(c)
    }
  }

  // Removes all reveal artefacts and strips the shader hooks so materials recompile clean.
  function cleanupReveal() {
    for (const c of reveal.wireframeClones) c.parent?.remove(c)
    reveal.wireframeClones.length = 0
    if (reveal.wireframeMat) { reveal.wireframeMat.dispose(); reveal.wireframeMat = null }
    for (const m of [droneMats.solarPanel, droneMats.carbonMatte, droneMats.tailMatte]) {
      m.onBeforeCompile = () => {}; m.customProgramCacheKey = () => ""; m.needsUpdate = true
    }
    reveal.active = false
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UV GENERATION — world-space box projection
  // Generates surface-following UVs so the texture density is uniform across
  // all meshes regardless of their size. Each vertex is projected from its
  // dominant normal axis so the weave pattern flows continuously.
  // texelsPerUnit controls how "zoomed in" the texture appears on the model.
  // ═══════════════════════════════════════════════════════════════════════════
  function genUVs(mesh, texelsPerUnit) {
    const g = mesh.geometry; if (!g) return
    const pos = g.attributes.position, nor = g.attributes.normal; if (!pos || !nor) return
    const uvs = new Float32Array(pos.count * 2)
    mesh.updateMatrixWorld(true)
    const _v = new THREE.Vector3(), _n = new THREE.Vector3()
    const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      _v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld)
      _n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyMatrix3(nm).normalize()
      const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z)
      let u, v
      if      (ax >= ay && ax >= az) { u = _v.y; v = _v.z }  // X-dominant face
      else if (ay >= ax && ay >= az) { u = _v.x; v = _v.z }  // Y-dominant face
      else                           { u = _v.x; v = _v.y }  // Z-dominant face
      uvs[i * 2] = u * texelsPerUnit; uvs[i * 2 + 1] = v * texelsPerUnit
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2))
    g.attributes.uv.needsUpdate = true
  }

  // Helper — wraps a canvas into a properly configured Three.js texture.
  function mkTex(canvas, colorSpace) {
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = colorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.anisotropy = 16   // max hardware anisotropy — reduces blur at oblique angles
    return t
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROCEDURAL CARBON FIBER TEXTURE (2×2 twill weave)
  //   towCount — number of tow bundles per axis (more = finer weave)
  //   gap      — dark resin gap width in pixels between tows
  // ═══════════════════════════════════════════════════════════════════════════
  function makeCarbonFiberTextures(opts = {}) {
    const sz  = 512
    const tc  = opts.towCount || 32    // tow count per axis
    const tp  = sz / tc                // pixels per tow
    const gap = opts.gap || 1          // resin gap px

    const mk = () => {
      const c = document.createElement("canvas"); c.width = c.height = sz
      return { c, ctx: c.getContext("2d") }
    }

    // ── Albedo (base colour) ──
    // Dark epoxy background, then 2×2 twill pattern on top.
    // Warp tows (vertical) are brighter when on top; weft tows slightly darker.
    const { c: aC, ctx: a } = mk()
    a.fillStyle = "#1a1a1e"; a.fillRect(0, 0, sz, sz)   // dark resin background
    for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
      const x = col * tp, y = row * tp
      const isWarpOver = ((col + row) % 4) < 2    // 2×2 twill logic
      const base = isWarpOver ? 120 + Math.random() * 20 : 85 + Math.random() * 20
      a.fillStyle = isWarpOver
        ? `rgb(${base},${base},${base + 3})`       // warp: slightly cool
        : `rgb(${base + 2},${base},${base})`       // weft: slightly warm
      a.fillRect(x + gap, y + gap, tp - gap * 2, tp - gap * 2)
      // Individual fibre strand lines within each tow
      for (let s = 0; s < 5; s++) {
        a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`
        a.lineWidth = 0.8; a.beginPath()
        if (isWarpOver) {
          const sx = x + gap + ((tp - gap * 2) * (s + 0.5)) / 5
          a.moveTo(sx, y + gap); a.lineTo(sx, y + tp - gap)
        } else {
          const sy = y + gap + ((tp - gap * 2) * (s + 0.5)) / 5
          a.moveTo(x + gap, sy); a.lineTo(x + tp - gap, sy)
        }
        a.stroke()
      }
    }

    // ── Roughness ──
    // Top tows are slightly smoother (epoxy fills the low areas).
    const { c: rC, ctx: r } = mk()
    const baseRough = 90
    r.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`; r.fillRect(0, 0, sz, sz)
    for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
      const x = col * tp, y = row * tp
      const isWarpOver = ((col + row) % 4) < 2
      const v = isWarpOver
        ? baseRough - 6 + Math.random() * 4   // top tow: smoother
        : baseRough + 2 + Math.random() * 6   // under tow: rougher
      r.fillStyle = `rgb(${v},${v},${v})`; r.fillRect(x + gap, y + gap, tp - gap * 2, tp - gap * 2)
      // Gaps (exposed resin) are rougher
      const gv = baseRough + 30
      r.fillStyle = `rgb(${gv},${gv},${gv})`
      r.fillRect(x, y, tp, gap); r.fillRect(x, y, gap, tp)
    }

    // ── Normal map (weave relief) ──
    // Each tow crossing creates a gentle bump — warp/weft alternation
    // produces the characteristic undulation of real CF.
    const { c: nC, ctx: n } = mk()
    n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, sz, sz)  // neutral flat
    for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
      const x = col * tp, y = row * tp
      const isWarpOver = ((col + row) % 4) < 2
      if (isWarpOver) {
        // Warp on top: normal tilts in X direction across the tow width
        const hw = (tp - gap * 2) / 2
        n.fillStyle = "rgba(110,128,255,0.45)"; n.fillRect(x + gap, y + gap, hw, tp - gap * 2)       // left half: tilt left
        n.fillStyle = "rgba(146,128,255,0.45)"; n.fillRect(x + gap + hw, y + gap, hw, tp - gap * 2)  // right half: tilt right
        n.fillStyle = "rgba(128,115,255,0.3)";  n.fillRect(x + gap, y + gap, tp - gap * 2, 2)
        n.fillStyle = "rgba(128,141,255,0.3)";  n.fillRect(x + gap, y + tp - gap - 2, tp - gap * 2, 2)
      } else {
        // Weft on top: normal tilts in Y direction
        const hh = (tp - gap * 2) / 2
        n.fillStyle = "rgba(128,110,255,0.45)"; n.fillRect(x + gap, y + gap, tp - gap * 2, hh)       // top half: tilt up
        n.fillStyle = "rgba(128,146,255,0.45)"; n.fillRect(x + gap, y + gap + hh, tp - gap * 2, hh)  // bottom half: tilt down
        n.fillStyle = "rgba(115,128,255,0.3)";  n.fillRect(x + gap, y + gap, 2, tp - gap * 2)
        n.fillStyle = "rgba(141,128,255,0.3)";  n.fillRect(x + tp - gap - 2, y + gap, 2, tp - gap * 2)
      }
    }
    // Resin channel depressions in the gaps
    for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
      const x = col * tp, y = row * tp
      n.fillStyle = "rgba(128,108,240,0.5)"; n.fillRect(x, y, tp, gap + 1)  // horizontal gap
      n.fillStyle = "rgba(108,128,240,0.5)"; n.fillRect(x, y, gap + 1, tp)  // vertical gap
    }

    return {
      albedo: mkTex(aC, THREE.SRGBColorSpace),
      rough:  mkTex(rC, THREE.NoColorSpace),
      normal: mkTex(nC, THREE.NoColorSpace),
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROCEDURAL SOLAR PANEL TEXTURE (monocrystalline cell grid)
  //   cellCols    — number of cells across the panel width
  //   cellRows    — number of cells down the panel height
  //   cellGap     — gap between cells in pixels (EVA backsheet visible here)
  //   busBarCount — number of silver bus bars per cell
  //   fingerSpacing — pixel spacing between finger grid lines
  // ═══════════════════════════════════════════════════════════════════════════
  function makeSolarPanelTextures(opts = {}) {
    const sz           = 512
    const cellCols     = opts.cellCols     || 4
    const cellRows     = opts.cellRows     || 6
    const cellGap      = opts.cellGap      || 10
    const busBarCount  = opts.busBarCount  || 5
    const fingerSpacing = opts.fingerSpacing || 4

    const cellW = (sz - (cellCols + 1) * cellGap) / cellCols
    const cellH = (sz - (cellRows + 1) * cellGap) / cellRows
    const cellX = col => cellGap + col * (cellW + cellGap)
    const cellY = row => cellGap + row * (cellH + cellGap)

    const mk = () => {
      const c = document.createElement("canvas"); c.width = c.height = sz
      return { c, ctx: c.getContext("2d") }
    }

    // ── Albedo ──
    // Very dark blue-black silicon wafer cells on a grey EVA backsheet.
    const { c: aC, ctx: a } = mk()
    a.fillStyle = "#474751"; a.fillRect(0, 0, sz, sz)   // EVA backsheet (gaps between cells)
    for (let row = 0; row < cellRows; row++) for (let col = 0; col < cellCols; col++) {
      const x = cellX(col), y = cellY(row)
      // Cell fill — very dark blue-black silicon with subtle per-cell variation
      const rv = Math.random() * 4 - 2
      a.fillStyle = `rgb(${6 + rv},${8 + rv},${18 + rv})`
      a.fillRect(x, y, cellW, cellH)
      // Anti-reflective coating edge effect (lighter blue border)
      a.strokeStyle = "rgba(30,50,100,0.5)"; a.lineWidth = 2
      a.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)
      // Subtle crystal structure gradient (directional shimmer)
      const grad = a.createLinearGradient(x, y, x + cellW, y + cellH)
      grad.addColorStop(0, "rgba(40,50,90,0.08)"); grad.addColorStop(1, "rgba(20,25,50,0.08)")
      a.fillStyle = grad; a.fillRect(x, y, cellW, cellH)
      // Bus bars — horizontal silver metallic lines
      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        a.strokeStyle = "rgba(50,50,58,0.95)"; a.lineWidth = 1.5
        a.beginPath(); a.moveTo(x, barY); a.lineTo(x + cellW, barY); a.stroke()
      }
      // Finger grid — fine vertical silver lines
      a.strokeStyle = "rgba(45,45,55,0.50)"; a.lineWidth = 0.5
      for (let fx = x + fingerSpacing; fx < x + cellW; fx += fingerSpacing) {
        a.beginPath(); a.moveTo(fx, y); a.lineTo(fx, y + cellH); a.stroke()
      }
      // Diamond solder points at bus bar / finger intersections
      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        for (let fx = x + fingerSpacing * 3; fx < x + cellW; fx += fingerSpacing * 4) {
          a.save(); a.translate(fx, barY); a.rotate(Math.PI / 4)
          a.fillStyle = "rgba(55,55,65,0.7)"; a.fillRect(-1.5, -1.5, 3, 3)
          a.restore()
        }
      }
    }

    // ── Roughness ──
    // Cells are smooth (anti-reflective coating + glass). Bus bars are very smooth metal.
    const { c: rC, ctx: r } = mk()
    r.fillStyle = "rgb(90,90,90)"; r.fillRect(0, 0, sz, sz)   // matte backsheet in gaps
    for (let row = 0; row < cellRows; row++) for (let col = 0; col < cellCols; col++) {
      const x = cellX(col), y = cellY(row)
      const cv = 50 + Math.random() * 5   // smooth cell surface
      r.fillStyle = `rgb(${cv},${cv},${cv})`; r.fillRect(x, y, cellW, cellH)
      r.strokeStyle = "rgb(60,60,60)"; r.lineWidth = 2; r.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)
      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        r.strokeStyle = "rgb(30,30,30)"; r.lineWidth = 1.5  // polished metal bus bars
        r.beginPath(); r.moveTo(x, barY); r.lineTo(x + cellW, barY); r.stroke()
      }
    }

    // ── Normal map (cell edge bevels + bus bar relief) ──
    const { c: nC, ctx: n } = mk()
    n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, sz, sz)   // neutral flat
    for (let row = 0; row < cellRows; row++) for (let col = 0; col < cellCols; col++) {
      const x = cellX(col), y = cellY(row)
      // Cell edge bevels (inset look)
      n.fillStyle = "rgba(118,128,255,0.6)"; n.fillRect(x, y, 2, cellH)              // left edge
      n.fillStyle = "rgba(138,128,255,0.6)"; n.fillRect(x + cellW - 2, y, 2, cellH) // right edge
      n.fillStyle = "rgba(128,118,255,0.6)"; n.fillRect(x, y, cellW, 2)             // top edge
      n.fillStyle = "rgba(128,138,255,0.6)"; n.fillRect(x, y + cellH - 2, cellW, 2) // bottom edge
      // Bus bar relief — raised ridges
      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        n.fillStyle = "rgba(128,118,255,0.4)"; n.fillRect(x, barY - 1, cellW, 1)    // top of bar
        n.fillStyle = "rgba(128,138,255,0.4)"; n.fillRect(x, barY + 1, cellW, 1)    // bottom of bar
      }
    }
    // Gap depressions between cells
    for (let row = 0; row < cellRows; row++) for (let col = 0; col < cellCols; col++) {
      const x = cellX(col), y = cellY(row)
      n.fillStyle = "rgba(128,108,240,0.5)"; n.fillRect(x - cellGap, y - cellGap, cellW + cellGap * 2, cellGap)
      n.fillStyle = "rgba(108,128,240,0.5)"; n.fillRect(x - cellGap, y, cellGap, cellH)
    }

    return {
      albedo: mkTex(aC, THREE.SRGBColorSpace),
      rough:  mkTex(rC, THREE.NoColorSpace),
      normal: mkTex(nC, THREE.NoColorSpace),
    }
  }

  // Generate textures
  const cf  = makeCarbonFiberTextures({ glossy: false, towCount: 24 })
  const sol = makeSolarPanelTextures()

  // ═══════════════════════════════════════════════════════════════════════════
  // MATERIALS
  // ─ solarPanel  — monocrystalline cells under tempered glass (wings)
  // ─ carbonMatte — dry/satin carbon fibre (fuselage, arms)
  // ─ tailMatte   — lighter grey carbon fibre (tail surfaces)
  //
  // Key values to tweak per material:
  //   color           — base tint multiplied over the texture map
  //   metalness       — 0 = dielectric, 1 = metal
  //   roughness       — 0 = mirror, 1 = fully diffuse
  //   clearcoat       — 0–1 extra gloss layer (like varnish / tempered glass)
  //   envMapIntensity — strength of environment reflections
  //   normalScale     — strength of the normal map bump
  // ═══════════════════════════════════════════════════════════════════════════
  const droneMats = {
    solarPanel: new THREE.MeshPhysicalMaterial({
      color:              0xffffff,
      map:                sol.albedo,
      metalness:          0.01,
      roughness:          0.02,
      roughnessMap:       sol.rough,
      clearcoat:          0.75,          // tempered glass over-coating
      clearcoatRoughness: 0.05,
      normalMap:          sol.normal,
      normalScale:        new THREE.Vector2(2.4, 2.4),
      envMapIntensity:    0.5,
      side:               THREE.DoubleSide,
    }),
    carbonMatte: new THREE.MeshPhysicalMaterial({
      color:              0x6d6d6d,
      map:                cf.albedo,
      metalness:          0.0,
      roughness:          0.92,         // true matte/dry CF — no gloss
      roughnessMap:       cf.rough,
      clearcoat:          0.0,
      normalMap:          cf.normal,
      normalScale:        new THREE.Vector2(0.2, 0.2),
      envMapIntensity:    0.25,
      side:               THREE.DoubleSide,
    }),
    tailMatte: new THREE.MeshPhysicalMaterial({
      color:              0xc9c9c9,     // lighter grey for tail surfaces
      map:                cf.albedo,
      metalness:          0.0,
      roughness:          0.92,
      roughnessMap:       cf.rough,
      clearcoat:          0.0,
      normalMap:          cf.normal,
      normalScale:        new THREE.Vector2(0.2, 0.2),
      envMapIntensity:    0.25,
      side:               THREE.DoubleSide,
    }),
  }

  // UV density — texels per world unit. Higher = finer / more zoomed-in texture.
  const CF_DENSITY    = 200.0  // carbon fibre weave — higher = finer/smaller fibres
  const SOLAR_DENSITY =  48.0  // solar cell grid — higher = more cells visible per wing

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMERA
  // fov — field of view in degrees (narrower = more telephoto / compressed)
  // The initial fov here is just the starting value; it gets overridden each
  // frame by applyPose() which interpolates fov between poses.
  // ═══════════════════════════════════════════════════════════════════════════
  const initW = mountEl.clientWidth  || window.innerWidth
  const initH = mountEl.clientHeight || window.innerHeight
  const camera = new THREE.PerspectiveCamera(
    15,           // fov in degrees — starting value, overridden by applyPose
    initW / initH,
    0.1, 1000
  )
  const cameraTarget = new THREE.Vector3(0, 0.3, 0)

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDERER
  // toneMappingExposure — overall brightness (higher = brighter)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(initW, initH)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace    = THREE.SRGBColorSpace
  renderer.toneMapping         = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 3.2    // overall scene brightness
  renderer.setClearColor(0x000000, 0)   // transparent background
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;"
  mountEl.appendChild(renderer.domElement)

  // ═══════════════════════════════════════════════════════════════════════════
  // LIGHTING
  // HemisphereLight(skyColor, groundColor, intensity)
  //   skyColor    — colour of light coming from above (cool sky)
  //   groundColor — colour of light coming from below (warm ground)
  // ═══════════════════════════════════════════════════════════════════════════
  scene.add(new THREE.HemisphereLight(
    0x8eafc2,   // sky colour — cool blue-grey
    0x584838,   // ground colour — warm brown
    0.8         // intensity
  ))

  // ═══════════════════════════════════════════════════════════════════════════
  // HDR ENVIRONMENT
  // environmentRotation — rotates the env map in Euler angles (radians).
  //   X axis rotation: -840° = tilts the horizon
  //   Y axis rotation: 2070° = spins the sun/light direction
  // These large degree values are fine — they just wrap around.
  // ═══════════════════════════════════════════════════════════════════════════
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  new RGBELoader().load(DRONE_ASSETS.hdr, tex => {
    tex.mapping    = THREE.EquirectangularReflectionMapping
    scene.environment = pmrem.fromEquirectangular(tex).texture
    scene.environmentRotation = new THREE.Euler(
      -840  * Math.PI / 180,   // X tilt
      2070  * Math.PI / 180,   // Y spin (light direction)
      0
    )
    tex.dispose()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // SCROLL-DRIVEN CAMERA POSES
  // All poses orbit around (0,0,0) — the drone's body centre.
  //
  // Coordinate system:
  //   X — left/right:   negative = camera left of body, positive = right
  //   Y — elevation:    0 = wing level, positive = above, negative = below
  //   Z — front/back:   0 = centred, negative = behind tail, positive = in front of nose
  //
  // cam — camera world position
  // tgt — look-at target point
  // fov — field of view in degrees for this pose (interpolated between poses)
  //
  // Scroll: pose 0 (top of page) → pose 1 (mid) → pose 2 (bottom)
  // ═══════════════════════════════════════════════════════════════════════════
  const poses = [
    { cam: new THREE.Vector3(-2.070, 1.200, -1.400), tgt: new THREE.Vector3(0.115, -0.230, 0.332), fov: 13.5  },  // pose 0
    { cam: new THREE.Vector3(-3.520, 2.360, -0.030), tgt: new THREE.Vector3(-0.238, 0.002, -0.030), fov: 11.5  },  // pose 1
    { cam: new THREE.Vector3(-2.900, 2.850, -0.030), tgt: new THREE.Vector3(-0.238, -0.035, -0.030), fov: 11.5 },  // pose 2
  ]
  // Prev Pose 1 cam: new THREE.Vector3(-2.100, 1.600, -0.045), tgt: new THREE.Vector3(-0.250, -0.100, -0.040), fov: 20
  // Prev Pose 2 cam: new THREE.Vector3(-3.155, 2.170, -0.030), tgt: new THREE.Vector3(-0.240, 0.000, -0.030), fov: 20

  let scrollT = 0, smoothT = 0

  // ─────────────────────────────────────────────────────────────────────────
  // applyPose — interpolates camera position, target, and FOV across poses.
  // FOV is lerped between adjacent poses and applied each frame, so each pose
  // can have a distinct focal length that smoothly transitions on scroll.
  // ─────────────────────────────────────────────────────────────────────────
  function applyPose(t) {
    const cl  = Math.max(0, Math.min(1, t))
    const seg = poses.length - 1
    const sc  = cl * seg
    const i   = Math.min(Math.floor(sc), seg - 1)
    const f   = sc - i
    const p   = poses[i].cam.clone().lerp(poses[i + 1].cam, f)
    const q   = poses[i].tgt.clone().lerp(poses[i + 1].tgt, f)
    camera.position.set(p.x, p.y, p.z)
    cameraTarget.set(q.x, q.y, q.z)
    camera.lookAt(cameraTarget)
    // Interpolate FOV between poses (falls back to 15 if fov not set on a pose)
    const fovA = poses[i].fov     ?? 15
    const fovB = poses[i + 1].fov ?? 15
    camera.fov = fovA + (fovB - fovA) * f
    camera.updateProjectionMatrix()
  }
  applyPose(0)

  // GSAP ScrollTrigger drives scrollT from 0 → 1 as user scrolls through #scenes-track
  ScrollTrigger.create({
    trigger: "#scenes-track",
    start:   "top top",
    end:     "bottom bottom",
    scrub:   1,
    onUpdate: s => { scrollT = s.progress },
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // MODEL LOAD
  // The GLB is auto-normalised to ~1.4 world units and centred at origin.
  // Wing meshes get the solarPanel material; everything else gets carbonMatte.
  // Tail meshes are overridden to tailMatte after the main assignment.
  // ═══════════════════════════════════════════════════════════════════════════
  const draco = new DRACOLoader()
  draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
  const gltfLoader = new GLTFLoader()
  gltfLoader.setDRACOLoader(draco)

  gltfLoader.load(DRONE_ASSETS.model, g => {
    const obj = g.scene
    obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0)

    // Auto-normalise size and centre at origin
    const box = new THREE.Box3().setFromObject(obj)
    const bsz = new THREE.Vector3(), bctr = new THREE.Vector3()
    box.getSize(bsz); box.getCenter(bctr)
    const md = Math.max(bsz.x, bsz.y, bsz.z)
    if (isFinite(md) && md > 0) {
      const s = 1.4 / md
      obj.scale.setScalar(s)
      obj.position.sub(bctr.multiplyScalar(s))
    }
    obj.rotation.set(-Math.PI / 2, 0, 0)   // Blender Z-up → Three.js Y-up
    droneBasePos.copy(obj.position)
    droneBaseRot.copy(obj.rotation)
    obj.updateMatrixWorld(true)

    const meshes = []
    obj.traverse(c => { if (c.isMesh) meshes.push(c) })

    // Default all meshes to matte carbon fibre
    for (const m of meshes) {
      if (m.geometry && !m.geometry.attributes.normal) m.geometry.computeVertexNormals()
      m.material = droneMats.carbonMatte
    }

    // Assign solar panel material to wing meshes (by name, or fall back to heuristic)
    const wingNames = new Set(["mesh73", "mesh100", "mesh76", "mesh103"])
    let assigned = 0
    for (const m of meshes) { if (wingNames.has(m.name)) { m.material = droneMats.solarPanel; assigned++ } }
    if (assigned === 0) {
      // Fallback: pick the 4 largest flat meshes by XZ area
      const scored = meshes.map(m => {
        const b = new THREE.Box3().setFromObject(m), s = new THREE.Vector3(), ct = new THREE.Vector3()
        b.getSize(s); b.getCenter(ct)
        return { m, score: s.x * s.z * (1 / (s.y / Math.max(s.x, s.z, 1e-6) + 0.02)) * (0.6 + Math.abs(ct.x)) }
      }).sort((a, b) => b.score - a.score)
      for (let i = 0; i < Math.min(4, scored.length); i++) scored[i].m.material = droneMats.solarPanel
    }

    scene.add(obj); obj.updateMatrixWorld(true)

    // Generate world-scale UVs now that world matrices are finalised
    for (const m of meshes) genUVs(m, m.material === droneMats.solarPanel ? SOLAR_DENSITY : CF_DENSITY)

    // Override tail meshes
    const tailNames = new Set([
      "mesh159","mesh160","mesh161","mesh162","mesh163","mesh164","mesh165","mesh166","mesh167",
      "mesh168","mesh169","mesh170","mesh171","mesh172","mesh173","mesh174","mesh175","mesh176",
      "mesh177","mesh178","mesh179","mesh180","mesh181","mesh182","mesh183","mesh184",
    ])
    for (const m of meshes) { if (tailNames.has(m.name)) m.material = droneMats.tailMatte }

    droneObject = obj

    // Kick off construction reveal
    const rb = new THREE.Box3().setFromObject(obj)
    reveal.maxRadius = (Math.max(
      Math.abs(rb.min.x), Math.abs(rb.max.x),
      Math.abs(rb.min.z), Math.abs(rb.max.z)
    ) || 9) * 1.05
    injectRevealShader(droneMats.solarPanel,  reveal.solidUniforms)
    injectRevealShader(droneMats.carbonMatte, reveal.solidUniforms)
    injectRevealShader(droneMats.tailMatte,   reveal.solidUniforms)
    createWireClones(meshes, reveal.wireUniforms)
    reveal.solidUniforms.revealRadius.value = 0
    reveal.wireUniforms.revealRadius.value  = 0
    reveal.startTime = clock.elapsedTime
    reveal.active    = true
  })

  // Resize observer keeps the renderer and camera in sync with the mount element
  new ResizeObserver(() => {
    const w = mountEl.clientWidth || window.innerWidth
    const h = mountEl.clientHeight || window.innerHeight
    camera.aspect = w / h; camera.updateProjectionMatrix()
    renderer.setSize(w, h); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  }).observe(mountEl)

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER LOOP
  // ═══════════════════════════════════════════════════════════════════════════
  function animate() {
    requestAnimationFrame(animate)
    clock.getDelta()                  // keep clock ticking
    const t = clock.elapsedTime

    // Smooth scroll interpolation (lerp factor 0.06 = fairly snappy)
    smoothT += (scrollT - smoothT) * 0.06
    if (Math.abs(scrollT - smoothT) < 0.0001) smoothT = scrollT
    applyPose(smoothT)

    // Drone hover bob
    if (droneObject) {
      const bob   = Math.sin(t * (2 * Math.PI) / bobCfg.bobPeriod)
      const stall = 1 - bobCfg.stallDepth * Math.pow(Math.cos(t * (2 * Math.PI) / bobCfg.stallPeriod), 2)
      droneObject.position.set(
        droneBasePos.x,
        droneBasePos.y + bob * bobCfg.bobAmp * stall,
        droneBasePos.z
      )
      droneObject.rotation.set(
        droneBaseRot.x + Math.cos(t * (2 * Math.PI) / bobCfg.bobPeriod) * stall * bobCfg.pitchAmp,
        droneBaseRot.y, droneBaseRot.z
      )
    }

    // Construction reveal animation
    if (reveal.active) {
      const el = t - reveal.startTime
      const wl = Math.min(el / reveal.wireframeDuration, 1)
      reveal.wireUniforms.revealRadius.value  = easeOut(wl) * reveal.maxRadius
      reveal.solidUniforms.revealRadius.value = 0
      if (wl >= 1) {
        const fl = Math.min((el - reveal.wireframeDuration) / reveal.fadeOutDuration, 1)
        reveal.solidUniforms.revealRadius.value = easeOut(fl) * reveal.maxRadius * 1.05
        if (reveal.wireframeMat) reveal.wireframeMat.opacity = 0.6 * (1 - easeOut(fl))
        if (fl >= 1) cleanupReveal()
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SCROLL-DRIVEN CSS FILTER (desaturation + tone compression)
    // sp = 0 at top of scroll, 1 at halfway through scroll range.
    //
    // gray       — grayscale amount (0.60 = 60% desaturated at start)
    // contrast   — 1.0 at top, decreases slightly (lifts blacks)
    // brightness — 1.0 at top, decreases slightly (pulls down whites)
    // ═══════════════════════════════════════════════════════════════════════
    const sp         = Math.min(smoothT / 0.5, 1)
    const gray       = 0.60 + sp * 0.20      // 60% → 80% grayscale as user scrolls
    const contrast   = 1.0  - sp * 0.10      // 1.0 → 0.9
    const brightness = 1.0  - sp * 0.15      // 1.0 → 0.85
    renderer.domElement.style.filter = `grayscale(${gray}) contrast(${contrast}) brightness(${brightness})`

    // Slowly rotate the env light as user scrolls (subtle light direction shift)
    if (scene.environmentRotation) {
      const startY = 2070 * Math.PI / 180
      const endY   = 2085 * Math.PI / 180    // +15° total rotation across full scroll
      scene.environmentRotation.y = startY + sp * (endY - startY)
    }

    renderer.render(scene, camera)
  }
  animate()
})
