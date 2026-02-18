import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js"


// =====================================================================
// Procedural Cloud System — billboard planes with FBM noise shader
// =====================================================================

// Simplex 3D noise (Ashima/webgl-noise, MIT license) — no texture lookups
const SIMPLEX_NOISE_GLSL = /* glsl */ `
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g  = step(x0.yzx, x0.xyz);
  vec3 l  = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
  + i.y + vec4(0.0, i1.y, i2.y, 1.0))
  + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x  = x_ * ns.x + ns.yyyy;
  vec4 y  = y_ * ns.x + ns.yyyy;
  vec4 h  = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`

const CLOUD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const CLOUD_FRAGMENT = /* glsl */ `
${SIMPLEX_NOISE_GLSL}

uniform float uTime;
uniform float uOpacity;
uniform float uDensity;
uniform vec3  uCloudColorBright;
uniform vec3  uCloudColorDark;
uniform float uSeed;

varying vec2 vUv;

// 3-octave FBM — lean but enough for billowy shape
float fbm(vec3 p) {
  float v = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < 3; i++) { v += a * snoise(p * f); f *= 2.0; a *= 0.5; }
  return v;
}

void main() {
  vec3 nc = vec3(vUv * 2.5 + uSeed * 73.7, uTime * 0.01);
  // Drift forward — clouds move toward camera so drone appears to fly forward
  nc.x += uTime * 0.02;
  nc.y += uTime * 0.006;

  float n = fbm(nc);

  // Sculpt puffy cumulus — hard threshold + squared for rounded billows
  float cloud = smoothstep(-0.05, 0.5, n * uDensity - 0.15);
  cloud *= cloud;

  // Soft oval edge falloff
  vec2 c = vUv * 2.0 - 1.0;
  c.x *= 0.65;
  cloud *= smoothstep(0.0, 0.45, 1.0 - length(c));

  // Fake 3D: noise value + UV for light/shadow
  float light = smoothstep(-0.1, 0.7, n) * 0.7 + vUv.y * 0.3;
  vec3 color = mix(uCloudColorDark, uCloudColorBright, light);

  // Edge glow — subsurface scatter look
  float edge = smoothstep(0.0, 0.3, cloud) * (1.0 - smoothstep(0.3, 0.8, cloud));
  color += edge * uCloudColorBright * 0.15;

  float a = cloud * uOpacity;
  gl_FragColor = vec4(color * a, a);
}
`

// Cloud plane configs — billboard planes behind the drone
const CLOUD_CONFIGS = [
  { pos: [  0,  -5,  -15], size: [100, 80], opacity: 0.45, density: 1.3, seed: 1.0, order: -10 },
  { pos: [-25,  -8,  -30], size: [120, 90], opacity: 0.5,  density: 1.4, seed: 2.3, order: -10 },
  { pos: [ 30,  -6,   10], size: [ 90, 70], opacity: 0.4,  density: 1.2, seed: 3.7, order: -10 },
  { pos: [-10, -10,   20], size: [110, 80], opacity: 0.45, density: 1.5, seed: 4.1, order: -10 },
  { pos: [ 40, -12,  -50], size: [140, 100], opacity: 0.35, density: 1.1, seed: 5.5, order: -10 },
  { pos: [-50, -15,   40], size: [130, 110], opacity: 0.35, density: 1.2, seed: 6.2, order: -10 },
  { pos: [ 15, -18,   60], size: [150, 100], opacity: 0.3,  density: 1.0, seed: 7.8, order: -10 },
  { pos: [-35, -20,  -60], size: [160, 120], opacity: 0.3,  density: 1.1, seed: 8.4, order: -10 },
]

const CloudSystem = {
  meshes: [],
  wind: new THREE.Vector3(0.3, 0, 0.1),

  create(scene) {
    for (const cfg of CLOUD_CONFIGS) {
      const geo = new THREE.PlaneGeometry(cfg.size[0], cfg.size[1])
      const mat = new THREE.ShaderMaterial({
        vertexShader: CLOUD_VERTEX,
        fragmentShader: CLOUD_FRAGMENT,
        uniforms: {
          uTime:            { value: 0 },
          uOpacity:         { value: cfg.opacity },
          uDensity:         { value: cfg.density },
          uCloudColorBright: { value: new THREE.Vector3(0.89, 0.82, 0.64) },
          uCloudColorDark:   { value: new THREE.Vector3(0.55, 0.50, 0.40) },
          uSeed:            { value: cfg.seed },
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      })

      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2])
      mesh.renderOrder = cfg.order
      mesh.frustumCulled = true
      mesh.userData.basePos = new THREE.Vector3(cfg.pos[0], cfg.pos[1], cfg.pos[2])

      scene.add(mesh)
      this.meshes.push(mesh)
    }
  },

  update(time, camera) {
    const dt = 1 / 60
    for (const mesh of this.meshes) {
      mesh.material.uniforms.uTime.value = time
      mesh.lookAt(camera.position)

      mesh.position.x += this.wind.x * dt
      mesh.position.z += this.wind.z * dt

      const base = mesh.userData.basePos
      if (mesh.position.x > base.x + 100) mesh.position.x -= 200
      if (mesh.position.x < base.x - 100) mesh.position.x += 200
      if (mesh.position.z > base.z + 100) mesh.position.z -= 200
      if (mesh.position.z < base.z - 100) mesh.position.z += 200
    }
  },
}


// ---- perf instrumentation (console-friendly) ----
const perf = {
  enabled: typeof performance !== "undefined" && typeof performance.mark === "function",
  flags: {
    skyReady: false,
    glbReady: false,
    assetsReadyMarked: false,
    firstFrameMarked: false,
    anyFrameMarked: false,
    interactiveReadyMarked: false,
    __reported: false,
  },
  mark(name) {
    if (!this.enabled) return
    try { performance.mark(name) } catch (_) {}
  },
  measure(name, start, end) {
    if (!this.enabled) return null
    try {
      performance.measure(name, start, end)
      const m = performance.getEntriesByName(name, "measure").slice(-1)[0]
      return m ? Math.round(m.duration) : null
    } catch (_) {
      return null
    }
  },
  reportOnce() {
    if (!this.enabled) return
    const rows = []
    const push = (label, ms) => {
      if (typeof ms === "number") rows.push({ metric: label, ms })
    }

    push("Sky JPG load", this.measure("sky-load", "sky-start", "sky-loaded"))
    push("GLB load", this.measure("glb-load", "glb-start", "glb-loaded"))
    push("Start → assets ready", this.measure("start-to-assets", "app-start", "assets-ready"))
    push("Assets ready → first rendered frame", this.measure("assets-to-first-frame", "assets-ready", "first-frame"))
    push("Start → first rendered frame", this.measure("start-to-first-frame", "app-start", "first-frame"))
    push("Start → first frame (any)", this.measure("start-to-first-frame-any", "app-start", "first-frame-any"))
    push("Start → interactive ready", this.measure("start-to-interactive", "app-start", "interactive-ready"))

    if (rows.length) console.table(rows)
  },
}

perf.mark("app-start")

const clock = new THREE.Clock()

const scene = new THREE.Scene()

// Global reference to the loaded drone object for animation
let droneObject = null

// Base transforms captured at load time (so we don't hard-force a rotation that can hide the model)
let droneBasePos = new THREE.Vector3(0, 0, 0)
let droneBaseRot = new THREE.Euler(0, 0, 0)
let droneBaseScale = 1

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
  for (const mat of [droneMats.carbonGlossy, droneMats.carbonMatte]) {
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
  const size = 1024
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

  // Subtle overall color variation (large-scale tonal shifts like real CF sheets)
  for (let i = 0; i < 400; i++) {
    const bx = Math.random() * size
    const by = Math.random() * size
    const br = 40 + Math.random() * 100
    a.fillStyle = `rgba(255,255,255,${0.004 + Math.random() * 0.008})`
    a.beginPath()
    a.arc(bx, by, br, 0, Math.PI * 2)
    a.fill()
  }

  // ---- Roughness map ----
  const { c: roughC, ctx: r } = makeCanvas()
  // Base roughness: glossy CF is very smooth, matte CF is moderately rough
  const baseRough = isGlossy ? 25 : 90
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

  // Micro noise for realism
  for (let i = 0; i < 15000; i++) {
    const nx = Math.random() * size
    const ny = Math.random() * size
    const nv = baseRough - 10 + Math.random() * 20
    r.fillStyle = `rgba(${nv},${nv},${nv},0.08)`
    r.fillRect(nx, ny, 1, 1)
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


// Generate two variants: glossy (body panels) and matte (structural parts)
const cfGlossy = makeCarbonFiberTextures({ glossy: true, towCount: 32, repeat: 4.0 })
const cfMatte  = makeCarbonFiberTextures({ glossy: false, towCount: 24, repeat: 3.0 })



// --- Carbon fiber material presets (PBR) ---
const droneMats = {
  // Glossy carbon fiber: wet-look clearcoat over woven CF
  carbonGlossy: new THREE.MeshPhysicalMaterial({
    color: 0x676d7e,
    map: cfGlossy.albedo,

    // CF is non-metallic (polymer composite) but reflective under clearcoat
    metalness: 0.05,
    roughness: 0.18,
    roughnessMap: cfGlossy.rough,

    // Clearcoat = epoxy resin layer (↑ = shinier, range 0–1)
    clearcoat: 0.5,
    // Clearcoat blur (↑ = more diffuse reflections, range 0–1)
    clearcoatRoughness: 0.03,

    // Weave relief
    normalMap: cfGlossy.normal,
    normalScale: new THREE.Vector2(0.6, 0.6),

    // Environment reflection strength (↑ = more reflective, range 0–3+)
    envMapIntensity: 2.0,

    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  }),

  // Matte/satin carbon fiber: dry weave look — structural parts, arms, props
  carbonMatte: new THREE.MeshPhysicalMaterial({
    color: 0x676d7e,
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
}

// CF weave density: how many texture tiles per world unit.
// This is applied via UVs generated at load time (see generateWorldScaleUVs).
// No triplanar needed — UVs follow the surface contours like real laid-up CF.
const CF_DENSITY = { glossy: 12.0, matte: 10.0 }

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)
camera.position.set(0, 0.5, 2)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 2.0
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
const hemi = new THREE.HemisphereLight(0x8eafc2, 0x584838, 0.5)
scene.add(hemi)

// Procedural cloud planes — visible from first frame
CloudSystem.create(scene)

// Camera look-at target (used by scroll-driven camera)
const cameraTarget = new THREE.Vector3(0, 0.3, 0)

// Resolve public asset URLs via Vite base.
// NOTE: Vite's BASE_URL is often "/" (not a valid base for `new URL`), so we anchor it to `window.location`.
const BASE_URL = (import.meta?.env?.BASE_URL ?? "/")
const baseWithSlash = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`

const SKY_URL = new URL(`${baseWithSlash}env/green-512.hdr`, window.location.href).toString()
const MODEL_URL = new URL(`${baseWithSlash}models/apollo-draco.glb`, window.location.href).toString()

console.log("🔗 Asset URLs", { SKY_URL, MODEL_URL, BASE_URL })

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
perf.mark("sky-start")
rgbeLoader.load(
  SKY_URL,
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping

    const envMap = pmrem.fromEquirectangular(texture).texture
    scene.environment = envMap
    texture.dispose() // free the source texture, we only need the PMREM cubemap

    console.log("✅ HDR environment loaded")
    perf.mark("sky-loaded")
    perf.flags.skyReady = true

    // When both SKY + GLB are ready, mark a single "assets-ready" timepoint
    if (perf.enabled && perf.flags.skyReady && perf.flags.glbReady && !perf.flags.assetsReadyMarked) {
      perf.flags.assetsReadyMarked = true
      perf.mark("assets-ready")
    }
  },
  undefined,
  (err) => {
    console.error("❌ HDR environment failed to load", err)
    // Even if sky fails, don't block the scene
    perf.mark("sky-loaded")
    perf.flags.skyReady = true
    if (perf.enabled && perf.flags.skyReady && perf.flags.glbReady && !perf.flags.assetsReadyMarked) {
      perf.flags.assetsReadyMarked = true
      perf.mark("assets-ready")
    }
  }
)

// Load GLB
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)

perf.mark("glb-start")
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

      // Save base transforms for animation
      droneBaseScale = s
    } else {
      // Fallback
      object.scale.setScalar(1)
      droneBaseScale = 1
    }

    // Apply explicit orientation + scale fixes (if needed)
    object.rotation.copy(MODEL_TUNING.rotation)
    if (MODEL_TUNING.extraScale !== 1.0) {
      object.scale.multiplyScalar(MODEL_TUNING.extraScale)
      droneBaseScale *= MODEL_TUNING.extraScale
    }

    // Capture base transforms (we'll add subtle drift on top of these)
    droneBasePos.copy(object.position)
    droneBaseRot.copy(object.rotation)
    object.updateMatrixWorld(true)

    if (import.meta?.env?.DEV) {
      console.log("📦 GLB bounds size:", { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) })
      console.log("🧩 GLB scene children:", object.children.map((c) => ({ name: c.name, type: c.type })))

      // If bounds are extremely tiny, temporarily scale up so you can at least see it.
      if (maxDim < 1e-4) {
        console.warn("⚠️ GLB bounds are near-zero; scaling up 1000x for visibility (debug)")
        object.scale.multiplyScalar(1000)
      }
    }

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
        m.material = droneMats.carbonGlossy
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
        scored[i].m.material = droneMats.carbonGlossy
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
      const density = m.material === droneMats.carbonGlossy ? CF_DENSITY.glossy : CF_DENSITY.matte
      generateWorldScaleUVs(m, density)
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

      // Inject reveal shader into both carbon fiber materials
      injectRevealShader(droneMats.carbonGlossy, reveal.solidUniforms)
      injectRevealShader(droneMats.carbonMatte, reveal.solidUniforms)

      // Create wireframe clones (shares geometry, no memory cost)
      createWireframeClones(meshes, reveal.wireUniforms)

      // Start with both radii at 0 (drone invisible on first frame)
      reveal.solidUniforms.revealRadius.value = 0
      reveal.wireUniforms.revealRadius.value = 0
      reveal.startTime = clock.elapsedTime
      reveal.active = true
    }

    // Mark when the model is in-scene and matrices are ready (useful for "interactive" milestone)
    perf.mark("model-in-scene")

    console.log("✅ GLB loaded + drone materials assigned")

    perf.mark("glb-loaded")
    perf.flags.glbReady = true
    // When both SKY + GLB are ready, mark a single "assets-ready" timepoint
    if (perf.enabled && perf.flags.skyReady && perf.flags.glbReady && !perf.flags.assetsReadyMarked) {
      perf.flags.assetsReadyMarked = true
      perf.mark("assets-ready")
    }

    // -------- Scroll-driven camera via linear interpolation between poses --------
    const poses = [
      { cam: new THREE.Vector3(-2.822, 1.964, -2.34),  tgt: new THREE.Vector3(0, 0.3, 0) },
      { cam: new THREE.Vector3(-4.641, 3.509, 0), tgt: new THREE.Vector3(0, 0.3, 0) },
      { cam: new THREE.Vector3(-5.613, 11.412, 0), tgt: new THREE.Vector3(0, 0.3, 0) },
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

    // Mark "interactive-ready"
    if (perf.enabled && !perf.flags.interactiveReadyMarked) {
      perf.flags.interactiveReadyMarked = true
      perf.mark("interactive-ready")
    }
  },
  (xhr) => {
    // xhr.total is often 0 in dev; still log loaded bytes.
    if (!xhr) return
    const loaded = xhr.loaded || 0
    const total = xhr.total || 0
    const pct = total ? Math.round((loaded / total) * 100) : null
    if (pct !== null) {
      console.log(`⬇️ GLB loading: ${pct}% (${Math.round(loaded / 1024)} KB / ${Math.round(total / 1024)} KB)`) 
    } else {
      console.log(`⬇️ GLB loading: ${Math.round(loaded / 1024)} KB`) 
    }
  },
  (err) => {
    console.error("❌ GLB failed to load:", MODEL_URL, err)
  }
)

// Resize
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  // No external scroll library to refresh
})

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

  // Animate procedural clouds
  CloudSystem.update(t, camera)

  renderer.render(scene, camera)

  // 1) Mark the very first frame we ever render ("any")
  if (perf.enabled && !perf.flags.anyFrameMarked) {
    perf.flags.anyFrameMarked = true
    perf.mark("first-frame-any")
  }

  // 2) Mark the first rendered frame AFTER assets are ready
  if (perf.enabled && perf.flags.assetsReadyMarked && !perf.flags.firstFrameMarked) {
    perf.flags.firstFrameMarked = true
    perf.mark("first-frame")
  }

  // 3) When we have both: first-frame after assets + interactive-ready, print once
  if (perf.enabled && perf.flags.firstFrameMarked && perf.flags.interactiveReadyMarked) {
    // Ensure we only print once
    if (!perf.flags.__reported) {
      perf.flags.__reported = true
      perf.reportOnce()
    }
  }

  requestAnimationFrame(animate)
}
animate()

// --- Pose capture tool: press "P" to log camera position + target ---
const capturedPoses = []
window.addEventListener("keydown", (e) => {
  if (e.key === "p" || e.key === "P") {
    const pose = {
      cam: {
        x: +camera.position.x.toFixed(3),
        y: +camera.position.y.toFixed(3),
        z: +camera.position.z.toFixed(3),
      },
      tgt: {
        x: +cameraTarget.x.toFixed(3),
        y: +cameraTarget.y.toFixed(3),
        z: +cameraTarget.z.toFixed(3),
      },
    }
    capturedPoses.push(pose)
    console.log(`📸 Pose ${capturedPoses.length}:`, JSON.stringify(pose))
    console.log(`   All poses so far:`, JSON.stringify(capturedPoses))
  }
})
