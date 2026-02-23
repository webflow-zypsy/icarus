// Drone new light – Three.js scene
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js"


const clock = new THREE.Clock()

const scene = new THREE.Scene()

// Global reference to the loaded drone object for animation
let droneObject = null

// Base transforms captured at load time (so we don't hard-force a rotation that can hide the model)
let droneBasePos = new THREE.Vector3(0, 0, 0)
let droneBaseRot = new THREE.Euler(0, 0, 0)


// Drone bob tuning
const bobCfg = {
  bobAmp: 0.04,
  bobPeriod: 5.0,
  stallPeriod: 3.0,
  stallDepth: 0.35,
  pitchAmp: 0.0075,
}

// ---- Construction reveal effect ----
// On load the drone "builds" from center outward: white wireframe leads,
// orange welding glow at the edge, real material fills in just behind.
const reveal = {
  active: false,
  startTime: 0,
  wireframeDuration: 1.3,   // orange wireframe expands center→wings
  fadeOutDuration: 0.8,     // orange fades out smoothly to reveal carbon fiber
  maxRadius: 1,             // computed from geometry at load time
  wireframeClones: [],
  wireframeMat: null,
  solidUniforms: { revealRadius: { value: 0 } },
  wireUniforms:  { revealRadius: { value: 0 } },
}

// Ease-out cubic: fast start, smooth deceleration
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Inject a square-distance reveal clip into an existing material via onBeforeCompile.
 * Fragments beyond revealRadius (Chebyshev / square) are discarded.
 * @param {THREE.Material} material - the material to augment
 * @param {{ revealRadius: { value: number } }} uniforms - shared uniform object
 */
function injectRevealShader(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.revealRadius = uniforms.revealRadius

    // --- Vertex: pass world position to fragment ---
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRevealWorldPos;'
      )
      .replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\nvRevealWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      )

    // --- Fragment: discard beyond square reveal boundary ---
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <clipping_planes_pars_fragment>',
        '#include <clipping_planes_pars_fragment>\n' +
        'uniform float revealRadius;\n' +
        'varying vec3 vRevealWorldPos;'
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse, opacity );\n' +
        '{\n' +
        '  float revDist = max(abs(vRevealWorldPos.x), abs(vRevealWorldPos.z));\n' +
        '  if (revDist > revealRadius) discard;\n' +
        '}\n'
      )
  }
  material.customProgramCacheKey = () => 'reveal'
  material.needsUpdate = true
}

/**
 * Create wireframe clones of all drone meshes for the blueprint reveal pass.
 * Clones share geometry buffers (no memory duplication).
 */
function createWireframeClones(meshes, uniforms) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff7700,
    wireframe: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  })
  // Inject the same reveal clip (no glow) so wireframe also reveals from center
  injectRevealShader(mat, uniforms)
  reveal.wireframeMat = mat

  for (const m of meshes) {
    const clone = new THREE.Mesh(m.geometry, mat)
    // Copy local transform so clone sits in the same position relative to its parent
    clone.position.copy(m.position)
    clone.rotation.copy(m.rotation)
    clone.scale.copy(m.scale)
    clone.renderOrder = -1 // render behind solid
    // Add to the SAME parent as the original mesh so nested transforms are correct
    const parent = m.parent || m
    parent.add(clone)
    reveal.wireframeClones.push(clone)
  }
}

/**
 * Remove all reveal artifacts: wireframe clones, shader hooks, recompile materials clean.
 */
function cleanupReveal() {
  // Remove wireframe clones
  for (const c of reveal.wireframeClones) {
    c.parent?.remove(c)
    // geometry is shared — don't dispose it
  }
  reveal.wireframeClones.length = 0

  // Dispose wireframe material
  if (reveal.wireframeMat) {
    reveal.wireframeMat.dispose()
    reveal.wireframeMat = null
  }

  // Strip shader hooks from the real materials — recompile clean
  for (const mat of [droneMats.solarPanel, droneMats.carbonMatte, droneMats.tailMatte]) {
    mat.onBeforeCompile = () => {}
    mat.customProgramCacheKey = () => ''
    mat.needsUpdate = true
  }

  reveal.active = false
}

// --- Generate surface-following UVs for a mesh based on best-fit box projection ---
// For each face, picks the dominant normal axis and projects onto the two
// perpendicular axes. UVs are in world-space units so the texture density
// is uniform across all meshes regardless of their size or position.
// This gives a continuous "shrink-wrap" feel — like CF sheet laid onto the part.
const generateWorldScaleUVs = (mesh, texelsPerUnit) => {
  const geo = mesh.geometry
  if (!geo) return

  const pos = geo.attributes.position
  const norm = geo.attributes.normal
  if (!pos || !norm) return

  const uvs = new Float32Array(pos.count * 2)

  // We need world-space positions for uniform density.
  // Apply the mesh's world matrix to each vertex.
  mesh.updateMatrixWorld(true)
  const _v = new THREE.Vector3()
  const _n = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)

  for (let i = 0; i < pos.count; i++) {
    _v.set(pos.getX(i), pos.getY(i), pos.getZ(i))
    _v.applyMatrix4(mesh.matrixWorld)

    _n.set(norm.getX(i), norm.getY(i), norm.getZ(i))
    _n.applyMatrix3(normalMatrix).normalize()

    const ax = Math.abs(_n.x)
    const ay = Math.abs(_n.y)
    const az = Math.abs(_n.z)

    let u, v
    if (ax >= ay && ax >= az) {
      // X-dominant face → project onto YZ
      u = _v.y
      v = _v.z
    } else if (ay >= ax && ay >= az) {
      // Y-dominant face → project onto XZ
      u = _v.x
      v = _v.z
    } else {
      // Z-dominant face → project onto XY
      u = _v.x
      v = _v.y
    }

    uvs[i * 2 + 0] = u * texelsPerUnit
    uvs[i * 2 + 1] = v * texelsPerUnit
  }

  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2))
  geo.attributes.uv.needsUpdate = true
}

// --- Procedural carbon fiber weave textures (2×2 twill pattern) ---
// Generates albedo, roughness, and normal maps for a realistic carbon fiber look.
// The weave is a classic 2×2 twill (diagonal pattern) as seen on real CF parts.
const makeCarbonFiberTextures = (opts = {}) => {
  const size = 512
  // Weave config — how many tow bundles fit across the texture
  const towCount = opts.towCount || 32        // number of tows per axis
  const towPx = size / towCount               // pixel size of one tow
  const gap = opts.gap || 1                    // dark resin gap between tows (px)
  const isGlossy = opts.glossy !== false       // glossy (clearcoated) vs satin/matte

  const makeCanvas = () => {
    const c = document.createElement("canvas")
    c.width = size
    c.height = size
    const ctx = c.getContext("2d")
    return { c, ctx }
  }

  // ---- Albedo (base color) ----
  const { c: albedoC, ctx: a } = makeCanvas()

  // Fill with dark resin/epoxy background (visible in the gaps)
  a.fillStyle = "#1a1a1e"
  a.fillRect(0, 0, size, size)

  // Draw the 2×2 twill weave
  // In a 2×2 twill, warp goes over 2 weft, under 2, shifted by 1 each row
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx
      const y = row * towPx

      // 2×2 twill logic: warp-dominant when ((col + row) % 4) < 2
      const isWarpOver = ((col + row) % 4) < 2

      // Warp tows (vertical fibers) are brighter when on top;
      // weft tows (horizontal fibers) are slightly different tone
      if (isWarpOver) {
        // Warp on top — brighter due to fiber angle catching light
        const base = 120 + Math.random() * 20
        a.fillStyle = `rgb(${base},${base},${base + 3})`
      } else {
        // Weft on top — slightly darker/warmer
        const base = 85 + Math.random() * 20
        a.fillStyle = `rgb(${base + 2},${base},${base})`
      }

      a.fillRect(x + gap, y + gap, towPx - gap * 2, towPx - gap * 2)

      // Individual fiber strand lines within each tow (anisotropic detail)
      const strandCount = 5
      if (isWarpOver) {
        // Vertical strands for warp tows
        for (let s = 0; s < strandCount; s++) {
          const sx = x + gap + ((towPx - gap * 2) * (s + 0.5)) / strandCount
          a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`
          a.lineWidth = 0.8
          a.beginPath()
          a.moveTo(sx, y + gap)
          a.lineTo(sx, y + towPx - gap)
          a.stroke()
        }
      } else {
        // Horizontal strands for weft tows
        for (let s = 0; s < strandCount; s++) {
          const sy = y + gap + ((towPx - gap * 2) * (s + 0.5)) / strandCount
          a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`
          a.lineWidth = 0.8
          a.beginPath()
          a.moveTo(x + gap, sy)
          a.lineTo(x + towPx - gap, sy)
          a.stroke()
        }
      }
    }
  }

  // ---- Roughness map ----
  const { c: roughC, ctx: r } = makeCanvas()
  // Base roughness: glossy CF is very smooth, matte CF is moderately rough
  const baseRough = isGlossy ? 90 : 90
  r.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`
  r.fillRect(0, 0, size, size)

  // Weave-aligned roughness variation (fiber direction affects micro-roughness)
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx
      const y = row * towPx
      const isWarpOver = ((col + row) % 4) < 2

      // Top tows are slightly smoother (epoxy fills low areas)
      const v = isWarpOver
        ? baseRough - 6 + Math.random() * 4
        : baseRough + 2 + Math.random() * 6
      r.fillStyle = `rgb(${v},${v},${v})`
      r.fillRect(x + gap, y + gap, towPx - gap * 2, towPx - gap * 2)
    }
  }

  // Gaps are rougher (exposed resin)
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx
      const y = row * towPx
      const gapRough = baseRough + 30
      // Horizontal gap
      r.fillStyle = `rgb(${gapRough},${gapRough},${gapRough})`
      r.fillRect(x, y, towPx, gap)
      // Vertical gap
      r.fillRect(x, y, gap, towPx)
    }
  }

  // ---- Normal map (weave relief) ----
  const { c: normalC, ctx: n } = makeCanvas()
  n.fillStyle = "rgb(128,128,255)" // neutral flat
  n.fillRect(0, 0, size, size)

  // Each tow creates a slight bump — warp/weft crossing creates the characteristic undulation
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx
      const y = row * towPx
      const isWarpOver = ((col + row) % 4) < 2

      if (isWarpOver) {
        // Warp on top: bump upward, normal tilts slightly in X direction
        // Left edge of tow: normal tilts left (-X), right edge tilts right (+X)
        const halfW = (towPx - gap * 2) / 2

        // Left half: normal points left (R < 128)
        n.fillStyle = "rgba(110,128,255,0.45)"
        n.fillRect(x + gap, y + gap, halfW, towPx - gap * 2)

        // Right half: normal points right (R > 128)
        n.fillStyle = "rgba(146,128,255,0.45)"
        n.fillRect(x + gap + halfW, y + gap, halfW, towPx - gap * 2)

        // Top/bottom edges: slight Y tilt
        n.fillStyle = "rgba(128,115,255,0.3)"
        n.fillRect(x + gap, y + gap, towPx - gap * 2, 2)
        n.fillStyle = "rgba(128,141,255,0.3)"
        n.fillRect(x + gap, y + towPx - gap - 2, towPx - gap * 2, 2)
      } else {
        // Weft on top: bump upward, normal tilts in Y direction
        const halfH = (towPx - gap * 2) / 2

        // Top half: normal points up (G < 128)
        n.fillStyle = "rgba(128,110,255,0.45)"
        n.fillRect(x + gap, y + gap, towPx - gap * 2, halfH)

        // Bottom half: normal points down (G > 128)
        n.fillStyle = "rgba(128,146,255,0.45)"
        n.fillRect(x + gap, y + gap + halfH, towPx - gap * 2, halfH)

        // Left/right edges: slight X tilt
        n.fillStyle = "rgba(115,128,255,0.3)"
        n.fillRect(x + gap, y + gap, 2, towPx - gap * 2)
        n.fillStyle = "rgba(141,128,255,0.3)"
        n.fillRect(x + towPx - gap - 2, y + gap, 2, towPx - gap * 2)
      }
    }
  }

  // Gap depressions (resin channels between tows)
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx
      const y = row * towPx
      // Horizontal gap: surface dips (normal points up = G < 128)
      n.fillStyle = "rgba(128,108,240,0.5)"
      n.fillRect(x, y, towPx, gap + 1)
      // Vertical gap
      n.fillStyle = "rgba(108,128,240,0.5)"
      n.fillRect(x, y, gap + 1, towPx)
    }
  }

  // Build textures with proper filtering to combat moiré.
  // - generateMipmaps: true ensures smooth level-of-detail transitions
  // - LinearMipmapLinearFilter: trilinear filtering blends between mip levels
  // - anisotropy 16: maximum common hardware support, reduces blur at oblique angles
  const maxAniso = 16

  const albedo = new THREE.CanvasTexture(albedoC)
  albedo.colorSpace = THREE.SRGBColorSpace
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping
  albedo.generateMipmaps = true
  albedo.minFilter = THREE.LinearMipmapLinearFilter
  albedo.magFilter = THREE.LinearFilter
  albedo.anisotropy = maxAniso

  const rough = new THREE.CanvasTexture(roughC)
  rough.colorSpace = THREE.NoColorSpace
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping
  rough.generateMipmaps = true
  rough.minFilter = THREE.LinearMipmapLinearFilter
  rough.magFilter = THREE.LinearFilter
  rough.anisotropy = maxAniso

  const normal = new THREE.CanvasTexture(normalC)
  normal.colorSpace = THREE.NoColorSpace
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping
  normal.generateMipmaps = true
  normal.minFilter = THREE.LinearMipmapLinearFilter
  normal.magFilter = THREE.LinearFilter
  normal.anisotropy = maxAniso

  return { albedo, rough, normal }
}


// --- Procedural solar panel textures (monocrystalline cell grid) ---
// Generates albedo, roughness, and normal maps for realistic solar panels.
// Dark blue-black cells in a grid with silver bus bars and finger lines,
// simulating monocrystalline silicon wafers under tempered glass.
const makeSolarPanelTextures = (opts = {}) => {
  const size = 512
  const cellCols = opts.cellCols || 4
  const cellRows = opts.cellRows || 6
  const cellGap = opts.cellGap || 10
  const busBarCount = opts.busBarCount || 5
  const fingerSpacing = opts.fingerSpacing || 4

  const cellW = (size - (cellCols + 1) * cellGap) / cellCols
  const cellH = (size - (cellRows + 1) * cellGap) / cellRows

  const makeCanvas = () => {
    const c = document.createElement("canvas")
    c.width = size
    c.height = size
    const ctx = c.getContext("2d")
    return { c, ctx }
  }

  // Helper: get cell top-left position
  const cellX = (col) => cellGap + col * (cellW + cellGap)
  const cellY = (row) => cellGap + row * (cellH + cellGap)

  // ---- Albedo (base color) ----
  const { c: albedoC, ctx: a } = makeCanvas()

  // Background: EVA backsheet (visible in gaps between cells)
  a.fillStyle = "#474751"
  a.fillRect(0, 0, size, size)

  // Draw each cell
  for (let row = 0; row < cellRows; row++) {
    for (let col = 0; col < cellCols; col++) {
      const x = cellX(col)
      const y = cellY(row)

      // Cell fill: very dark blue-black silicon wafer with per-cell variation
      const rv = Math.random() * 4 - 2
      a.fillStyle = `rgb(${6 + rv}, ${8 + rv}, ${18 + rv})`
      a.fillRect(x, y, cellW, cellH)

      // Anti-reflective coating edge effect (lighter blue border)
      a.strokeStyle = "rgba(30, 50, 100, 0.5)"
      a.lineWidth = 2
      a.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)

      // Subtle crystal structure gradient (directional shimmer)
      const grad = a.createLinearGradient(x, y, x + cellW, y + cellH)
      grad.addColorStop(0, "rgba(40, 50, 90, 0.08)")
      grad.addColorStop(1, "rgba(20, 25, 50, 0.08)")
      a.fillStyle = grad
      a.fillRect(x, y, cellW, cellH)

      // Bus bars: horizontal silver metallic lines
      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        a.strokeStyle = "rgba(50, 50, 58, 0.95)"
        a.lineWidth = 1.5
        a.beginPath()
        a.moveTo(x, barY)
        a.lineTo(x + cellW, barY)
        a.stroke()
      }

      // Finger grid: fine vertical silver lines
      a.strokeStyle = "rgba(45, 45, 55, 0.50)"
      a.lineWidth = 0.5
      for (let fx = x + fingerSpacing; fx < x + cellW; fx += fingerSpacing) {
        a.beginPath()
        a.moveTo(fx, y)
        a.lineTo(fx, y + cellH)
        a.stroke()
      }

      // Diamond solder points at bus bar / finger intersections
      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        for (let fx = x + fingerSpacing * 3; fx < x + cellW; fx += fingerSpacing * 4) {
          a.save()
          a.translate(fx, barY)
          a.rotate(Math.PI / 4)
          a.fillStyle = "rgba(55, 55, 65, 0.7)"
          a.fillRect(-1.5, -1.5, 3, 3)
          a.restore()
        }
      }
    }
  }

  // ---- Roughness map ----
  const { c: roughC, ctx: r } = makeCanvas()

  // Base: matte backsheet in gaps
  r.fillStyle = "rgb(90, 90, 90)"
  r.fillRect(0, 0, size, size)

  for (let row = 0; row < cellRows; row++) {
    for (let col = 0; col < cellCols; col++) {
      const x = cellX(col)
      const y = cellY(row)

      // Cells: smooth anti-reflective coating under glass
      const cv = 50 + Math.random() * 5
      r.fillStyle = `rgb(${cv}, ${cv}, ${cv})`
      r.fillRect(x, y, cellW, cellH)

      // Cell edge: slightly rougher
      r.strokeStyle = "rgb(60, 60, 60)"
      r.lineWidth = 2
      r.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)

      // Bus bars: very smooth polished metal
      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        r.strokeStyle = "rgb(30, 30, 30)"
        r.lineWidth = 1.5
        r.beginPath()
        r.moveTo(x, barY)
        r.lineTo(x + cellW, barY)
        r.stroke()
      }
    }
  }

  // ---- Normal map (cell edge bevels + bus bar relief) ----
  const { c: normalC, ctx: n } = makeCanvas()

  // Neutral flat
  n.fillStyle = "rgb(128, 128, 255)"
  n.fillRect(0, 0, size, size)

  for (let row = 0; row < cellRows; row++) {
    for (let col = 0; col < cellCols; col++) {
      const x = cellX(col)
      const y = cellY(row)

      // Cell edge bevels (inset look)
      // Left edge: normal tilts left
      n.fillStyle = "rgba(118, 128, 255, 0.6)"
      n.fillRect(x, y, 2, cellH)
      // Right edge: normal tilts right
      n.fillStyle = "rgba(138, 128, 255, 0.6)"
      n.fillRect(x + cellW - 2, y, 2, cellH)
      // Top edge: normal tilts up
      n.fillStyle = "rgba(128, 118, 255, 0.6)"
      n.fillRect(x, y, cellW, 2)
      // Bottom edge: normal tilts down
      n.fillStyle = "rgba(128, 138, 255, 0.6)"
      n.fillRect(x, y + cellH - 2, cellW, 2)

      // Bus bar relief: raised ridges
      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        // Top of bus bar: normal tilts up
        n.fillStyle = "rgba(128, 118, 255, 0.4)"
        n.fillRect(x, barY - 1, cellW, 1)
        // Bottom of bus bar: normal tilts down
        n.fillStyle = "rgba(128, 138, 255, 0.4)"
        n.fillRect(x, barY + 1, cellW, 1)
      }
    }
  }

  // Gap depressions between cells
  for (let row = 0; row < cellRows; row++) {
    for (let col = 0; col < cellCols; col++) {
      const x = cellX(col)
      const y = cellY(row)
      // Horizontal gaps above each cell
      n.fillStyle = "rgba(128, 108, 240, 0.5)"
      n.fillRect(x - cellGap, y - cellGap, cellW + cellGap * 2, cellGap)
      // Vertical gaps left of each cell
      n.fillStyle = "rgba(108, 128, 240, 0.5)"
      n.fillRect(x - cellGap, y, cellGap, cellH)
    }
  }

  // Build textures
  const maxAniso = 16

  const albedo = new THREE.CanvasTexture(albedoC)
  albedo.colorSpace = THREE.SRGBColorSpace
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping
  albedo.generateMipmaps = true
  albedo.minFilter = THREE.LinearMipmapLinearFilter
  albedo.magFilter = THREE.LinearFilter
  albedo.anisotropy = maxAniso

  const rough = new THREE.CanvasTexture(roughC)
  rough.colorSpace = THREE.NoColorSpace
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping
  rough.generateMipmaps = true
  rough.minFilter = THREE.LinearMipmapLinearFilter
  rough.magFilter = THREE.LinearFilter
  rough.anisotropy = maxAniso

  const normal = new THREE.CanvasTexture(normalC)
  normal.colorSpace = THREE.NoColorSpace
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping
  normal.generateMipmaps = true
  normal.minFilter = THREE.LinearMipmapLinearFilter
  normal.magFilter = THREE.LinearFilter
  normal.anisotropy = maxAniso

  return { albedo, rough, normal }
}


// Generate matte carbon fiber variant (structural parts, arms, props)
const cfMatte  = makeCarbonFiberTextures({ glossy: false, towCount: 24, repeat: 3.0 })

// Generate solar panel textures
const solarTex = makeSolarPanelTextures()



// --- Drone material presets (PBR) ---
const droneMats = {
  // Solar panel: monocrystalline cells under tempered glass (wings)
  solarPanel: new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: solarTex.albedo,
    metalness: 0.08,
    roughness: 0.45,
    roughnessMap: solarTex.rough,
    clearcoat: 0.9,
    clearcoatRoughness: 0.05,
    normalMap: solarTex.normal,
    normalScale: new THREE.Vector2(0.4, 0.4),
    envMapIntensity: 0.5,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  }),

  // Matte/satin carbon fiber: dry weave look — structural parts, arms, props
  carbonMatte: new THREE.MeshPhysicalMaterial({
    color: 0x6d6d6d,
    map: cfMatte.albedo,

    metalness: 0.0,
    roughness: 0.92,
    roughnessMap: cfMatte.rough,

    // No clearcoat — true dry/matte CF has no resin shine
    clearcoat: 0.0,

    // Gentle weave relief — low enough that individual tows don't each
    // create their own specular highlight
    normalMap: cfMatte.normal,
    normalScale: new THREE.Vector2(0.2, 0.2),

    // Very subdued env reflections — matte CF barely reflects
    envMapIntensity: 0.25,

    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  }),

  // Tail — lighter gray matte carbon fiber
  tailMatte: new THREE.MeshPhysicalMaterial({
    color: 0xc9c9c9,
    map: cfMatte.albedo,
    metalness: 0.0,
    roughness: 0.92,
    roughnessMap: cfMatte.rough,
    clearcoat: 0.0,
    normalMap: cfMatte.normal,
    normalScale: new THREE.Vector2(0.2, 0.2),
    envMapIntensity: 0.25,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  }),
}

// CF weave density: how many texture tiles per world unit.
// This is applied via UVs generated at load time (see generateWorldScaleUVs).
// No triplanar needed — UVs follow the surface contours like real laid-up CF.
const CF_DENSITY = { glossy: 12.0, matte: 40.0 }
const SOLAR_DENSITY = 3.0

const camera = new THREE.PerspectiveCamera(
  15,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)
camera.position.set(0, 1.2, 5.2)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 3.2
renderer.setClearColor(0x000000, 0) // transparent background


// ---------- DOM: fixed canvas + scroll spacer ----------
document.body.style.margin = "0"

let styleTag = document.getElementById("scroll-styles")
if (!styleTag) {
  styleTag = document.createElement("style")
  styleTag.id = "scroll-styles"
  document.head.appendChild(styleTag)
}
styleTag.textContent = `
  html, body { height: 100%; margin: 0; }
  body { overflow-x: hidden; background: transparent; }
  #canvas-wrap { position: fixed; inset: 0; z-index: 0; }
  #canvas-wrap canvas { width: 100%; height: 100%; display: block; }
  #scroll-spacer { position: relative; z-index: 1; pointer-events: none; }
`

let canvasWrap = document.getElementById("canvas-wrap")
if (!canvasWrap) {
  canvasWrap = document.createElement("div")
  canvasWrap.id = "canvas-wrap"
  document.body.appendChild(canvasWrap)
}
canvasWrap.innerHTML = ""
canvasWrap.appendChild(renderer.domElement)

// Scroll spacer for native scroll testing (disabled inside iframes — Framer sends postMessage instead)
const isInIframe = window !== window.parent
let scrollSpacer = document.getElementById("scroll-spacer")
if (!isInIframe) {
  if (!scrollSpacer) {
    scrollSpacer = document.createElement("div")
    scrollSpacer.id = "scroll-spacer"
    document.body.appendChild(scrollSpacer)
  }
  scrollSpacer.style.height = "200vh"
} else if (scrollSpacer) {
  scrollSpacer.style.height = "0"
}

// Soft ambient base — cool sky above, warm ground below
const hemi = new THREE.HemisphereLight(0x8eafc2, 0x584838, 0.8)
scene.add(hemi)


// Camera look-at target (used by scroll-driven camera)
const cameraTarget = new THREE.Vector3(0, 0.3, 0)

// Resolve public asset URLs via Vite base.
// NOTE: Vite's BASE_URL is often "/" (not a valid base for `new URL`), so we anchor it to `window.location`.
const BASE_URL = (import.meta?.env?.BASE_URL ?? "/")
const baseWithSlash = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`

const SKY_URL = new URL(`${baseWithSlash}env/green-512.hdr`, window.location.href).toString()
const MODEL_URL = new URL(`${baseWithSlash}models/apollo-draco.glb`, window.location.href).toString()

// --- Model tuning (bring-back: explicit scale + rotation fixes) ---
// Use these when Blender export orientation/scale is off.
// Common fix: rotate X by -90° (Blender Z-up → three.js Y-up feel).
const MODEL_TUNING = {
  // Multiplies the auto-normalized scale (1 = no extra scaling)
  extraScale: 16.0,
  // Applied AFTER auto-centering + normalization
  rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
}
const pmrem = new THREE.PMREMGenerator(renderer)
pmrem.compileEquirectangularShader()

const rgbeLoader = new RGBELoader()
rgbeLoader.load(
  SKY_URL,
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping
    const envMap = pmrem.fromEquirectangular(texture).texture
    scene.environment = envMap
    scene.environmentRotation = new THREE.Euler(-840 * Math.PI / 180, 2070 * Math.PI / 180, 0)
    texture.dispose()
  }
)

// Load GLB
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)

gltfLoader.load(
  MODEL_URL,
  (gltf) => {
    const object = gltf.scene

    // Don't assume Blender export scale/orientation — auto-center + normalize size.
    // (A very common reason a GLB "doesn't show" is that it's either huge/tiny or far from origin.)
    object.position.set(0, 0, 0)
    object.rotation.set(0, 0, 0)

    // Center the model on the origin
    const box = new THREE.Box3().setFromObject(object)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)

    // Avoid NaNs if the box is empty
    const maxDim = Math.max(size.x, size.y, size.z)
    if (isFinite(maxDim) && maxDim > 0) {
      // Normalize so the model fits nicely in a ~1.4 unit box
      const target = 1.4
      const s = target / maxDim
      object.scale.setScalar(s)
      object.position.sub(center.multiplyScalar(s))
    } else {
      object.scale.setScalar(1)
    }

    // Apply explicit orientation + scale fixes (if needed)
    object.rotation.copy(MODEL_TUNING.rotation)
    if (MODEL_TUNING.extraScale !== 1.0) {
      object.scale.multiplyScalar(MODEL_TUNING.extraScale)
    }

    // Capture base transforms (we'll add subtle drift on top of these)
    droneBasePos.copy(object.position)
    droneBaseRot.copy(object.rotation)
    object.updateMatrixWorld(true)

    // collect meshes
    const meshes = []
    object.traverse((child) => {
      if (!child.isMesh) return
      meshes.push(child)
    })

    // Default everything to matte carbon fiber + fix normals.
    // UVs are generated AFTER scene.add so world matrices are correct.
    for (const m of meshes) {
      if (m.geometry && !m.geometry.attributes.normal) {
        m.geometry.computeVertexNormals()
      }
      m.material = droneMats.carbonMatte
      m.castShadow = true
      m.receiveShadow = true
    }

    // Wings / structural parts → glossy carbon fiber (wet clearcoat look)
    const wingMeshNames = new Set(["mesh73", "mesh100", "mesh76", "mesh103"])
    let namedAssigned = 0
    for (const m of meshes) {
      if (wingMeshNames.has(m.name)) {
        m.material = droneMats.solarPanel
        namedAssigned++
      }
    }

    if (namedAssigned === 0) {
      const scored = meshes
        .map((m) => {
          const bb = new THREE.Box3().setFromObject(m)
          const size = new THREE.Vector3()
          const center = new THREE.Vector3()
          bb.getSize(size)
          bb.getCenter(center)
          const flatness = size.y / Math.max(size.x, size.z, 1e-6)
          const areaScore = size.x * size.z
          const outboard = Math.abs(center.x)
          const score = areaScore * (1 / (flatness + 0.02)) * (0.6 + outboard)
          return { m, score }
        })
        .sort((a, b) => b.score - a.score)

      for (let i = 0; i < Math.min(4, scored.length); i++) {
        scored[i].m.material = droneMats.solarPanel
      }
    }


    // Add the drone to the scene so world matrices are correct
    scene.add(object)
    object.updateMatrixWorld(true)

    // Generate world-scale UVs now that matrices are final.
    // This replaces triplanar mapping — UVs follow the surface like real CF layup.
    // Each face is projected from its dominant normal axis so the weave pattern
    // flows continuously across curved geometry without stretching or banding.
    for (const m of meshes) {
      let density = CF_DENSITY.matte
      if (m.material === droneMats.solarPanel) density = SOLAR_DENSITY
      generateWorldScaleUVs(m, density)
    }

    // Tail meshes → white/light gray material
    const tailMeshNames = new Set([
      "mesh159","mesh160","mesh161","mesh162","mesh163","mesh164",
      "mesh165","mesh166","mesh167","mesh168","mesh169","mesh170",
      "mesh171","mesh172","mesh173","mesh174","mesh175","mesh176",
      "mesh177","mesh178","mesh179","mesh180","mesh181","mesh182",
      "mesh183","mesh184",
    ])
    for (const m of meshes) {
      if (tailMeshNames.has(m.name)) {
        m.material = droneMats.tailMatte
      }
    }

    // Store reference for animation
    droneObject = object

    // ---- Start construction reveal effect ----
    // Use bounding box to find max square extent — instant, no per-vertex loop
    {
      const revealBox = new THREE.Box3().setFromObject(object)
      const maxR = Math.max(
        Math.abs(revealBox.min.x), Math.abs(revealBox.max.x),
        Math.abs(revealBox.min.z), Math.abs(revealBox.max.z)
      )
      reveal.maxRadius = maxR > 0 ? maxR * 1.05 : 10 // 5% margin so tips fully appear

      // Inject reveal shader into all drone materials
      injectRevealShader(droneMats.solarPanel, reveal.solidUniforms)
      injectRevealShader(droneMats.carbonMatte, reveal.solidUniforms)
      injectRevealShader(droneMats.tailMatte, reveal.solidUniforms)

      // Create wireframe clones (shares geometry, no memory cost)
      createWireframeClones(meshes, reveal.wireUniforms)

      // Start with both radii at 0 (drone invisible on first frame)
      reveal.solidUniforms.revealRadius.value = 0
      reveal.wireUniforms.revealRadius.value = 0
      reveal.startTime = clock.elapsedTime
      reveal.active = true
    }

    // -------- Scroll-driven camera via linear interpolation between poses --------
    // Camera poses — drone-angle-1
    const poses = [
      { cam: new THREE.Vector3(-23.705, 16.498, -19.656),  tgt: new THREE.Vector3(0.6, 0.98, 0) },
      { cam: new THREE.Vector3(-38.986, 29.477, 0), tgt: new THREE.Vector3(0.6, 0.98, 0) },
      { cam: new THREE.Vector3(-29.263, 37.163, 0.053), tgt: new THREE.Vector3(0.6, 0.98, 0) },
    ]

    // Scroll state — smoothly interpolated
    let scrollT = 0
    let smoothT = 0

    const applyPose = (t) => {
      const clamped = Math.max(0, Math.min(1, t))
      const segments = poses.length - 1
      const scaled = clamped * segments
      const i = Math.min(Math.floor(scaled), segments - 1)
      const frac = scaled - i

      // Lerp between pose[i] and pose[i+1]
      const p = poses[i].cam.clone().lerp(poses[i + 1].cam, frac)
      const q = poses[i].tgt.clone().lerp(poses[i + 1].tgt, frac)
      camera.position.set(p.x, p.y, p.z)
      cameraTarget.set(q.x, q.y, q.z)
      camera.lookAt(cameraTarget)
    }

    // Apply initial pose
    applyPose(0)

    // Listen for scroll — native scroll (standalone) OR postMessage (Framer iframe)
    if (!isInIframe) {
      window.addEventListener("scroll", () => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight
        scrollT = maxScroll > 0 ? window.scrollY / maxScroll : 0
      }, { passive: true })
    }

    window.addEventListener("message", (e) => {
      if (e.data && typeof e.data.scrollProgress === "number") {
        scrollT = e.data.scrollProgress
      }
    })

    // Store applyPose globally so animate loop can use it
    window.__droneApplyPose = applyPose
    window.__droneScrollState = { getScrollT: () => scrollT, getSmoothT: () => smoothT, setSmoothT: (v) => { smoothT = v } }
  }
)

// ---------- Environment light controls ----------
// Arrows: rotate env light (Left/Right = Y, Up/Down = X, 15° steps)
// a/s: env intensity ±0.1
function logEnvState() {
  const rx = scene.environmentRotation ? (scene.environmentRotation.x * 180 / Math.PI).toFixed(1) : '0.0'
  const ry = scene.environmentRotation ? (scene.environmentRotation.y * 180 / Math.PI).toFixed(1) : '0.0'
  const exp = renderer.toneMappingExposure.toFixed(1)
  console.log(`--- ENV STATE ---  rotX: ${rx}°  |  rotY: ${ry}°  |  exposure: ${exp}`)
}

window.addEventListener("keydown", (e) => {
  const step = Math.PI / 12 // 15°
  let handled = false
  if (scene.environmentRotation) {
    if (e.key === "ArrowLeft")  { scene.environmentRotation.y -= step; handled = true }
    if (e.key === "ArrowRight") { scene.environmentRotation.y += step; handled = true }
    if (e.key === "ArrowUp")    { scene.environmentRotation.x -= step; handled = true }
    if (e.key === "ArrowDown")  { scene.environmentRotation.x += step; handled = true }
  }
  if (e.key === "a") { renderer.toneMappingExposure = Math.max(0, renderer.toneMappingExposure - 0.1); handled = true }
  if (e.key === "s") { renderer.toneMappingExposure += 0.1; handled = true }
  if (handled) logEnvState()
})

// Resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

// =====================================================================
// Corner Tracking Overlay — blob/feature detection effect on drone hover
// =====================================================================
const CornerTracker = {
  canvas: null,
  ctx: null,
  mousePx: { x: -999, y: -999 },
  active: false,
  idleTimer: null,
  idleTimeout: 120,
  cachedCorners: [],
  cornerCacheFrame: -1,
  frameCount: 0,
  maxCorners: 120,
  connectRadius: 200,                         // tighter radius for 3 nodes
  maxLines: 3,
  maxConnectionDist: 350,                     // max px distance for inter-blob dotted lines
  activeSlots: [],
  fadeOutDuration: 80,                         // snappy fade-out
  // Perf: cached 3D points and reusable projection vector
  _meshPoints: null,                          // [{name, points: Vector3[]}] built once
  _projVec: null,                             // reused for projection (zero allocs)

  init() {
    const c = document.createElement("canvas")
    c.id = "corner-tracker-overlay"
    c.style.cssText = "position:fixed;inset:0;z-index:1;pointer-events:none;"
    c.width = window.innerWidth * Math.min(window.devicePixelRatio, 2)
    c.height = window.innerHeight * Math.min(window.devicePixelRatio, 2)
    c.style.width = "100%"
    c.style.height = "100%"
    document.body.appendChild(c)
    this.canvas = c
    this.ctx = c.getContext("2d")

    window.addEventListener("mousemove", (e) => this.onMouseMove(e))
    window.addEventListener("mouseleave", () => this.hide())

    window.addEventListener("resize", () => {
      const dpr = Math.min(window.devicePixelRatio, 2)
      c.width = window.innerWidth * dpr
      c.height = window.innerHeight * dpr
    })
  },

  onMouseMove(e) {
    this.mousePx.x = e.clientX
    this.mousePx.y = e.clientY
    clearTimeout(this.idleTimer)
    this.active = true
    this.idleTimer = setTimeout(() => this.hide(), this.idleTimeout)
  },

  hide() {
    this.active = false
    // Stagger death instead of instant wipe
    const now = performance.now()
    let idx = 0
    for (const slot of this.activeSlots) {
      if (!slot.dying) {
        slot.dying = true
        slot.dieAt = now + idx * 60
        idx++
      }
    }
  },

  // Build 3D bounding box points once (called lazily on first use)
  _buildMeshPoints() {
    if (!droneObject) return
    this._meshPoints = []
    this._projVec = new THREE.Vector3()
    const box = new THREE.Box3()

    droneObject.traverse((child) => {
      if (!child.isMesh) return
      box.setFromObject(child)
      if (box.isEmpty()) return

      const ctr = new THREE.Vector3()
      box.getCenter(ctr)
      const points = [
        ctr,
        new THREE.Vector3(box.min.x, box.min.y, box.min.z),
        new THREE.Vector3(box.max.x, box.min.y, box.min.z),
        new THREE.Vector3(box.min.x, box.max.y, box.min.z),
        new THREE.Vector3(box.max.x, box.max.y, box.min.z),
        new THREE.Vector3(box.min.x, box.min.y, box.max.z),
        new THREE.Vector3(box.max.x, box.min.y, box.max.z),
        new THREE.Vector3(box.min.x, box.max.y, box.max.z),
        new THREE.Vector3(box.max.x, box.max.y, box.max.z),
      ]
      this._meshPoints.push({ name: child.name || 'mesh', points })
    })
  },

  // Project cached 3D points to screen — zero allocations per frame
  sampleCorners() {
    if (!droneObject) return []
    if (!this._meshPoints) this._buildMeshPoints()

    const corners = []
    const w = renderer.domElement.clientWidth
    const h = renderer.domElement.clientHeight
    const dpr = Math.min(window.devicePixelRatio, 2)
    const pv = this._projVec

    for (const mesh of this._meshPoints) {
      for (const p of mesh.points) {
        pv.copy(p).project(camera)
        if (pv.z > 1 || pv.z < -1) continue
        const sx = (pv.x * 0.5 + 0.5) * w * dpr
        const sy = (-pv.y * 0.5 + 0.5) * h * dpr
        const bk = 10 + ((sx * 7 + sy * 13) % 15)
        corners.push({ x: sx, y: sy, name: mesh.name, bk })
      }
    }

    // Deduplicate corners that are too close
    const filtered = []
    const minDist = 15 * dpr
    for (const c of corners) {
      let tooClose = false
      for (const f of filtered) {
        const dx = c.x - f.x, dy = c.y - f.y
        if (dx * dx + dy * dy < minDist * minDist) { tooClose = true; break }
      }
      if (!tooClose) filtered.push(c)
    }
    if (filtered.length > this.maxCorners) {
      for (let i = filtered.length - 1; i > 0; i--) {
        const j = (i * 7 + 13) % (i + 1)
        ;[filtered[i], filtered[j]] = [filtered[j], filtered[i]]
      }
      filtered.length = this.maxCorners
    }
    return filtered
  },

  updateSlots(nearby, now) {
    const usedNearby = new Set()
    const dpr = Math.min(window.devicePixelRatio, 2)

    // Match existing live slots to current nearby corners (wider threshold to avoid flicker)
    for (const slot of this.activeSlots) {
      if (slot.dying) continue
      let bestIdx = -1, bestDist = 80 * dpr
      for (let i = 0; i < nearby.length; i++) {
        if (usedNearby.has(i)) continue
        const dx = nearby[i].x - slot.x, dy = nearby[i].y - slot.y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d < bestDist) { bestDist = d; bestIdx = i }
      }
      if (bestIdx >= 0) {
        // Snappy position tracking
        slot.x += (nearby[bestIdx].x - slot.x) * 0.7
        slot.y += (nearby[bestIdx].y - slot.y) * 0.7
        slot.dist = nearby[bestIdx].dist
        slot.name = nearby[bestIdx].name
        // bk is locked at creation — never update it so squares don't resize
        usedNearby.add(bestIdx)
      } else if (!slot.dying) {
        // Mark for staggered death below
        slot._needsDeath = true
      }
    }

    // Stagger dying — offset dieAt so slots pop out one by one
    let dyingIdx = 0
    for (const slot of this.activeSlots) {
      if (slot._needsDeath) {
        slot.dying = true
        slot.dieAt = now + dyingIdx * 60
        delete slot._needsDeath
        dyingIdx++
      }
    }

    // Remove fully faded slots
    this.activeSlots = this.activeSlots.filter(s => {
      if (!s.dying) return true
      return (now - s.dieAt) < this.fadeOutDuration
    })

    // Count live (non-dying) slots
    const liveCount = this.activeSlots.filter(s => !s.dying).length

    // Add new slots for unmatched nearby corners (staggered activation)
    let added = 0
    for (let i = 0; i < nearby.length && (liveCount + added) < this.maxLines; i++) {
      if (usedNearby.has(i)) continue
      this.activeSlots.push({
        x: nearby[i].x,
        y: nearby[i].y,
        dist: nearby[i].dist,
        name: nearby[i].name,
        bk: nearby[i].bk,
        activatedAt: now + added * 35,
        dying: false,
        dieAt: 0,
      })
      usedNearby.add(i)
      added++
    }
  },

  // Draw corner bracket L-shapes (matching Unicorn Studio cornersSDF)
  drawCornerBrackets(ctx, cx, cy, hx, hy, cornerLen, alpha, lw) {
    ctx.lineWidth = lw
    ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`
    ctx.beginPath()
    // Top-left
    ctx.moveTo(cx - hx, cy - hy + cornerLen); ctx.lineTo(cx - hx, cy - hy); ctx.lineTo(cx - hx + cornerLen, cy - hy)
    // Top-right
    ctx.moveTo(cx + hx - cornerLen, cy - hy); ctx.lineTo(cx + hx, cy - hy); ctx.lineTo(cx + hx, cy - hy + cornerLen)
    // Bottom-left
    ctx.moveTo(cx - hx, cy + hy - cornerLen); ctx.lineTo(cx - hx, cy + hy); ctx.lineTo(cx - hx + cornerLen, cy + hy)
    // Bottom-right
    ctx.moveTo(cx + hx - cornerLen, cy + hy); ctx.lineTo(cx + hx, cy + hy); ctx.lineTo(cx + hx, cy + hy - cornerLen)
    ctx.stroke()
  },

  // Draw dotted line between two points
  drawDottedLine(ctx, x1, y1, x2, y2, alpha, dpr) {
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1) return
    const dotLen = 4 * dpr
    const gapLen = 8 * dpr
    const period = dotLen + gapLen
    const ux = dx / len, uy = dy / len

    ctx.lineWidth = 1 * dpr
    ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`
    ctx.beginPath()
    let d = 0
    while (d < len) {
      const end = Math.min(d + dotLen, len)
      ctx.moveTo(x1 + ux * d, y1 + uy * d)
      ctx.lineTo(x1 + ux * end, y1 + uy * end)
      d += period
    }
    ctx.stroke()
  },

  draw() {
    if (!this.ctx) return
    // Keep drawing while slots are dying out, even if not active
    if (!this.active && this.activeSlots.length === 0) return

    const now = performance.now()
    this.frameCount++
    // Refresh corner cache every frame (instant response to mouse)
    if (this.frameCount - this.cornerCacheFrame > 0) {
      this.cachedCorners = this.sampleCorners()
      this.cornerCacheFrame = this.frameCount
    }

    const ctx = this.ctx
    const dpr = Math.min(window.devicePixelRatio, 2)
    const mx = this.mousePx.x * dpr
    const my = this.mousePx.y * dpr
    const radius = this.connectRadius * dpr

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    // When active, find nearby corners and update slots
    if (this.active) {
      const nearby = []
      for (const c of this.cachedCorners) {
        const dx = c.x - mx, dy = c.y - my
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < radius && dist > 4 * dpr) nearby.push({ ...c, dist })
      }
      nearby.sort((a, b) => a.dist - b.dist)
      this.updateSlots(nearby, now)
    }

    // Purge dead slots (instant off at dieAt)
    this.activeSlots = this.activeSlots.filter(s => {
      if (!s.dying) return true
      return now < s.dieAt
    })

    // Collect visible slots — binary on/off, no opacity ramping
    const liveSlots = []
    for (const slot of this.activeSlots) {
      if (slot.dying) {
        // Already past dieAt? Skip (will be purged next frame)
        if (now >= slot.dieAt) continue
        liveSlots.push({ ...slot })
      } else {
        if (now < slot.activatedAt) continue
        liveSlots.push({ ...slot })
      }
    }

    // --- Draw dotted connection lines between nearby blobs ---
    const maxConnDist = this.maxConnectionDist * dpr
    for (let i = 0; i < liveSlots.length; i++) {
      for (let j = i + 1; j < liveSlots.length; j++) {
        const a = liveSlots[i], b = liveSlots[j]
        const dx = a.x - b.x, dy = a.y - b.y
        const d = Math.sqrt(dx * dx + dy * dy)
        if (d > maxConnDist) continue
        const lineAlpha = 0.45 * (1 - d / maxConnDist)
        this.drawDottedLine(ctx, a.x, a.y, b.x, b.y, lineAlpha, dpr)
      }
    }

    // --- Draw each blob (binary on/off, fixed alpha) ---
    for (const slot of liveSlots) {
      const bk = slot.bk * dpr
      const cornerLen = Math.min(bk * 0.45, 20 * dpr)

      // Semi-transparent fill
      ctx.fillStyle = "rgba(255,255,255,0.06)"
      ctx.fillRect(slot.x - bk, slot.y - bk, bk * 2, bk * 2)

      // Corner brackets (L-shapes)
      this.drawCornerBrackets(ctx, slot.x, slot.y, bk, bk, cornerLen, 0.5, 1.5 * dpr)

      // Intensity label
      const intensity = (0.2 + 0.6 * (1 - Math.min(slot.dist / radius, 1))).toFixed(4)
      ctx.font = `${Math.round(9 * dpr)}px monospace`
      ctx.fillStyle = "rgba(255,255,255,0.35)"
      ctx.textAlign = "left"
      ctx.textBaseline = "top"
      ctx.fillText(intensity, slot.x - bk + 3 * dpr, slot.y - bk + 3 * dpr)
    }
  },
}

CornerTracker.init()

// Loop
function animate() {
  clock.getDelta() // keep clock ticking
  const t = clock.elapsedTime

  // Scroll-driven camera
  if (window.__droneScrollState && window.__droneApplyPose) {
    const state = window.__droneScrollState
    const target = state.getScrollT()
    let smooth = state.getSmoothT()
    smooth += (target - smooth) * 0.06
    if (Math.abs(target - smooth) < 0.0001) smooth = target
    state.setSmoothT(smooth)
    window.__droneApplyPose(smooth)
  }


  // Drone bob/sway — nose-led vertical bob with periodic stalls
  if (droneObject) {
    const s = bobCfg
    const bobFreq = (2 * Math.PI) / s.bobPeriod
    const bob = Math.sin(t * bobFreq)
    const stallFreq = (2 * Math.PI) / s.stallPeriod
    const stallWave = Math.cos(t * stallFreq)
    const stall = 1.0 - s.stallDepth * stallWave * stallWave
    const dy = bob * s.bobAmp * stall
    droneObject.position.set(droneBasePos.x, droneBasePos.y + dy, droneBasePos.z)
    const bobVelocity = Math.cos(t * bobFreq) * stall
    droneObject.rotation.set(droneBaseRot.x + bobVelocity * s.pitchAmp, droneBaseRot.y, droneBaseRot.z)
  }

  // ---- Construction reveal animation ----
  if (reveal.active) {
    const elapsed = t - reveal.startTime

    // Phase 1: Orange wireframe expands from center (construction phase)
    const wireLinear = Math.min(elapsed / reveal.wireframeDuration, 1)
    const wireEased = easeOutCubic(wireLinear)
    reveal.wireUniforms.revealRadius.value = wireEased * reveal.maxRadius

    // Solid material stays hidden during construction
    reveal.solidUniforms.revealRadius.value = 0

    // Phase 2: Once wireframe is fully expanded, fade out orange to reveal carbon fiber
    if (wireLinear >= 1) {
      const fadeElapsed = elapsed - reveal.wireframeDuration
      const fadeLinear = Math.min(fadeElapsed / reveal.fadeOutDuration, 1)
      const fade = easeOutCubic(fadeLinear) // smooth deceleration for natural dissolve

      // Carbon fiber expands from center outward, matching the fadeout timing
      const solidEased = easeOutCubic(fadeLinear)
      reveal.solidUniforms.revealRadius.value = solidEased * reveal.maxRadius * 1.05

      // Fade out wireframe
      if (reveal.wireframeMat) {
        reveal.wireframeMat.opacity = 0.6 * (1 - fade)
      }

      if (fadeLinear >= 1) {
        cleanupReveal()
      }
    }
  }

  // Scroll-driven desaturation + tonal compression — CSS filters on the canvas
  if (window.__droneScrollState) {
    const scrollPct = Math.min(window.__droneScrollState.getSmoothT() / 0.5, 1)
    const gray = 0.60 + scrollPct * 0.20       // 60% → 80% grayscale
    const contrast = 1.0 - scrollPct * 0.1      // 1.0 → 0.9 (lifts blacks)
    const brightness = 1.0 - scrollPct * 0.15   // 1.0 → 0.85 (pulls down whites)
    renderer.domElement.style.filter = `grayscale(${gray}) contrast(${contrast}) brightness(${brightness})`

    // Scroll-driven lighting rotation
    if (scene.environmentRotation) {
      const startY = 2070 * Math.PI / 180
      const endY   = 2085 * Math.PI / 180
      scene.environmentRotation.y = startY + scrollPct * (endY - startY)
    }
  }

  renderer.render(scene, camera)

  // Corner tracking overlay (drawn on 2D canvas after WebGL render)
  CornerTracker.draw()

  requestAnimationFrame(animate)
}
animate()

