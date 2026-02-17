// Apollo Three.js Scene — CDN-compatible (no bundler needed)
// Drop this file on Cloudflare R2 and reference it from Webflow's custom code.
// Requires the following importmap to be placed BEFORE this script tag in Webflow:
//
//  <script type="importmap">
//  {
//    "imports": {
//      "three":              "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js",
//      "three/addons/":      "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/",
//      "gsap":               "https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js",
//      "gsap/ScrollTrigger": "https://cdn.jsdelivr.net/npm/gsap@3.12.5/ScrollTrigger.js"
//    }
//  }
//  </script>
//  <script type="module" src="https://YOUR-R2-BUCKET.r2.dev/apollo-webflow.js"></script>

import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import gsap from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

gsap.registerPlugin(ScrollTrigger)

// ─── CHANGE THESE TWO LINES to your actual Cloudflare R2 public URLs ───────
const SKY_URL   = "https://webflow-zypsy.github.io/icarus/sky.png"
const MODEL_URL = "https://webflow-zypsy.github.io/icarus/apollo.glb"
// ────────────────────────────────────────────────────────────────────────────

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
    push("Sky load",                    this.measure("sky-load",              "sky-start",    "sky-loaded"))
    push("GLB load",                    this.measure("glb-load",              "glb-start",    "glb-loaded"))
    push("Start → assets ready",        this.measure("start-to-assets",       "app-start",    "assets-ready"))
    push("Assets ready → first frame",  this.measure("assets-to-first-frame", "assets-ready", "first-frame"))
    push("Start → first frame",         this.measure("start-to-first-frame",  "app-start",    "first-frame"))
    push("Start → interactive ready",   this.measure("start-to-interactive",  "app-start",    "interactive-ready"))
    if (rows.length) console.table(rows)
  },
}

perf.mark("app-start")

const clock = new THREE.Clock()
const scene = new THREE.Scene()

let droneObject   = null
let droneBasePos  = new THREE.Vector3(0, 0, 0)
let droneBaseRot  = new THREE.Euler(0, 0, 0)
let droneBaseScale = 1

const swayState = {
  enabled: false,
  baseCam: new THREE.Vector3(),
  baseTgt: new THREE.Vector3(),
  cfg: {
    bobAmp:    0.04,
    bobPeriod: 5.0,
    stallPeriod: 3.0,
    stallDepth: 0.35,
    pitchAmp:  0.0075,
  },
}

// ── World-scale UV generation ────────────────────────────────────────────────
const generateWorldScaleUVs = (mesh, texelsPerUnit) => {
  const geo = mesh.geometry
  if (!geo) return
  const pos  = geo.attributes.position
  const norm = geo.attributes.normal
  if (!pos || !norm) return

  const uvs = new Float32Array(pos.count * 2)
  mesh.updateMatrixWorld(true)
  const _v = new THREE.Vector3()
  const _n = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)

  for (let i = 0; i < pos.count; i++) {
    _v.set(pos.getX(i), pos.getY(i), pos.getZ(i))
    _v.applyMatrix4(mesh.matrixWorld)
    _n.set(norm.getX(i), norm.getY(i), norm.getZ(i))
    _n.applyMatrix3(normalMatrix).normalize()

    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z)
    let u, v
    if (ax >= ay && ax >= az)      { u = _v.y; v = _v.z }
    else if (ay >= ax && ay >= az) { u = _v.x; v = _v.z }
    else                           { u = _v.x; v = _v.y }

    uvs[i * 2]     = u * texelsPerUnit
    uvs[i * 2 + 1] = v * texelsPerUnit
  }

  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2))
  geo.attributes.uv.needsUpdate = true
}

// ── Procedural carbon fiber textures ────────────────────────────────────────
const makeCarbonFiberTextures = (opts = {}) => {
  const size     = 1024
  const towCount = opts.towCount || 32
  const towPx    = size / towCount
  const gap      = opts.gap || 1
  const isGlossy = opts.glossy !== false

  const makeCanvas = () => {
    const c = document.createElement("canvas")
    c.width = size; c.height = size
    return { c, ctx: c.getContext("2d") }
  }

  // Albedo
  const { c: albedoC, ctx: a } = makeCanvas()
  a.fillStyle = "#1a1a1e"
  a.fillRect(0, 0, size, size)
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx, y = row * towPx
      const isWarpOver = ((col + row) % 4) < 2
      if (isWarpOver) {
        const b = 120 + Math.random() * 20
        a.fillStyle = `rgb(${b},${b},${b + 3})`
      } else {
        const b = 85 + Math.random() * 20
        a.fillStyle = `rgb(${b + 2},${b},${b})`
      }
      a.fillRect(x + gap, y + gap, towPx - gap * 2, towPx - gap * 2)

      const sc = 5
      if (isWarpOver) {
        for (let s = 0; s < sc; s++) {
          const sx = x + gap + ((towPx - gap * 2) * (s + 0.5)) / sc
          a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`
          a.lineWidth = 0.8
          a.beginPath(); a.moveTo(sx, y + gap); a.lineTo(sx, y + towPx - gap); a.stroke()
        }
      } else {
        for (let s = 0; s < sc; s++) {
          const sy = y + gap + ((towPx - gap * 2) * (s + 0.5)) / sc
          a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`
          a.lineWidth = 0.8
          a.beginPath(); a.moveTo(x + gap, sy); a.lineTo(x + towPx - gap, sy); a.stroke()
        }
      }
    }
  }
  for (let i = 0; i < 400; i++) {
    a.fillStyle = `rgba(255,255,255,${0.004 + Math.random() * 0.008})`
    a.beginPath(); a.arc(Math.random() * size, Math.random() * size, 40 + Math.random() * 100, 0, Math.PI * 2); a.fill()
  }

  // Roughness
  const { c: roughC, ctx: r } = makeCanvas()
  const baseRough = isGlossy ? 25 : 90
  r.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`
  r.fillRect(0, 0, size, size)
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx, y = row * towPx
      const isWarpOver = ((col + row) % 4) < 2
      const v = isWarpOver ? baseRough - 6 + Math.random() * 4 : baseRough + 2 + Math.random() * 6
      r.fillStyle = `rgb(${v},${v},${v})`
      r.fillRect(x + gap, y + gap, towPx - gap * 2, towPx - gap * 2)
    }
  }
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx, y = row * towPx
      const gv = baseRough + 30
      r.fillStyle = `rgb(${gv},${gv},${gv})`
      r.fillRect(x, y, towPx, gap)
      r.fillRect(x, y, gap, towPx)
    }
  }
  for (let i = 0; i < 15000; i++) {
    const nv = baseRough - 10 + Math.random() * 20
    r.fillStyle = `rgba(${nv},${nv},${nv},0.08)`
    r.fillRect(Math.random() * size, Math.random() * size, 1, 1)
  }

  // Normal
  const { c: normalC, ctx: n } = makeCanvas()
  n.fillStyle = "rgb(128,128,255)"
  n.fillRect(0, 0, size, size)
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx, y = row * towPx
      const isWarpOver = ((col + row) % 4) < 2
      if (isWarpOver) {
        const hw = (towPx - gap * 2) / 2
        n.fillStyle = "rgba(110,128,255,0.45)"; n.fillRect(x + gap, y + gap, hw, towPx - gap * 2)
        n.fillStyle = "rgba(146,128,255,0.45)"; n.fillRect(x + gap + hw, y + gap, hw, towPx - gap * 2)
        n.fillStyle = "rgba(128,115,255,0.3)";  n.fillRect(x + gap, y + gap, towPx - gap * 2, 2)
        n.fillStyle = "rgba(128,141,255,0.3)";  n.fillRect(x + gap, y + towPx - gap - 2, towPx - gap * 2, 2)
      } else {
        const hh = (towPx - gap * 2) / 2
        n.fillStyle = "rgba(128,110,255,0.45)"; n.fillRect(x + gap, y + gap, towPx - gap * 2, hh)
        n.fillStyle = "rgba(128,146,255,0.45)"; n.fillRect(x + gap, y + gap + hh, towPx - gap * 2, hh)
        n.fillStyle = "rgba(115,128,255,0.3)";  n.fillRect(x + gap, y + gap, 2, towPx - gap * 2)
        n.fillStyle = "rgba(141,128,255,0.3)";  n.fillRect(x + towPx - gap - 2, y + gap, 2, towPx - gap * 2)
      }
    }
  }
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx, y = row * towPx
      n.fillStyle = "rgba(128,108,240,0.5)"; n.fillRect(x, y, towPx, gap + 1)
      n.fillStyle = "rgba(108,128,240,0.5)"; n.fillRect(x, y, gap + 1, towPx)
    }
  }

  const maxAniso = 16
  const makeT = (canvas, colorSpace) => {
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace  = colorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.anisotropy = maxAniso
    return t
  }
  return {
    albedo: makeT(albedoC, THREE.SRGBColorSpace),
    rough:  makeT(roughC,  THREE.NoColorSpace),
    normal: makeT(normalC, THREE.NoColorSpace),
  }
}

const cfGlossy = makeCarbonFiberTextures({ glossy: true,  towCount: 32 })
const cfMatte  = makeCarbonFiberTextures({ glossy: false, towCount: 24 })

const droneMats = {
  carbonGlossy: new THREE.MeshPhysicalMaterial({
    color: 0x676d7e, map: cfGlossy.albedo,
    metalness: 0.05, roughness: 0.18, roughnessMap: cfGlossy.rough,
    clearcoat: 1.0, clearcoatRoughness: 0.04,
    normalMap: cfGlossy.normal, normalScale: new THREE.Vector2(0.6, 0.6),
    envMapIntensity: 1.8, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
  }),
  carbonMatte: new THREE.MeshPhysicalMaterial({
    color: 0x676d7e, map: cfMatte.albedo,
    metalness: 0.02, roughness: 0.75, roughnessMap: cfMatte.rough,
    clearcoat: 0.08, clearcoatRoughness: 0.6,
    normalMap: cfMatte.normal, normalScale: new THREE.Vector2(0.45, 0.45),
    envMapIntensity: 0.6, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
  }),
}

const CF_DENSITY = { glossy: 3.0, matte: 2.5 }

// ── Renderer + Camera ────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000)
camera.position.set(0, 0.5, 2)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1

// ── DOM setup — works inside Webflow ────────────────────────────────────────
// The canvas is injected into #apollo-canvas-wrap (a div you create in Webflow)
// OR falls back to appending to body if that div doesn't exist.
let styleTag = document.getElementById("apollo-scroll-styles")
if (!styleTag) {
  styleTag = document.createElement("style")
  styleTag.id = "apollo-scroll-styles"
  document.head.appendChild(styleTag)
}
styleTag.textContent = `
  #apollo-canvas-wrap { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
  #apollo-canvas-wrap canvas { width: 100% !important; height: 100% !important; display: block; }
  #apollo-scroll-root { position: relative; z-index: 1; pointer-events: none; }
`

// Mount canvas into the Webflow wrapper div (id="apollo-canvas-wrap")
// If you haven't added that div yet, it auto-creates and appends to body.
let canvasWrap = document.getElementById("apollo-canvas-wrap")
if (!canvasWrap) {
  canvasWrap = document.createElement("div")
  canvasWrap.id = "apollo-canvas-wrap"
  document.body.appendChild(canvasWrap)
}
canvasWrap.innerHTML = ""
canvasWrap.appendChild(renderer.domElement)

// scrollRoot is the Webflow section(s) that drive the scroll animation.
// Give your scroll section(s) the id="apollo-scroll-root" in Webflow.
// If it doesn't exist the script still works — GSAP will fall back to the body.
let scrollRoot = document.getElementById("apollo-scroll-root")
if (!scrollRoot) {
  scrollRoot = document.createElement("div")
  scrollRoot.id = "apollo-scroll-root"
  scrollRoot.style.cssText = "position:relative;z-index:1;pointer-events:none;padding-bottom:300vh;"
  document.body.appendChild(scrollRoot)
}

// ── Lighting ─────────────────────────────────────────────────────────────────
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.35))
const rimLight = new THREE.DirectionalLight(0xffffff, 0.55)
rimLight.position.set(2, 1.0, -2)
scene.add(rimLight)

// ── Controls (user input disabled — camera driven by scroll) ─────────────────
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = false
controls.enableRotate  = false
controls.enableZoom    = false
controls.enablePan     = false
controls.target.set(0, 0.3, 0)

// ── Cloud shader layer ───────────────────────────────────────────────────────
const cloudVS = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const cloudFS = `
  precision highp float;
  uniform float uTime;
  uniform float uCloudCover;
  uniform float uCloudSharpness;
  uniform vec3  uCloudColor;
  uniform float uOpacity;
  uniform vec3  uShadowColor;
  varying vec2 vUv;
  varying vec3 vWorldPos;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }
  float noise(vec2 x) {
    vec2 p = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n = p.x + p.y * 57.0;
    return mix(mix(hash(n), hash(n+1.0), f.x), mix(hash(n+57.0), hash(n+58.0), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = rot * p * 2.0 + shift; a *= 0.5; }
    return v;
  }
  void main() {
    vec2 wXZ = vWorldPos.xz;
    vec2 wind = vec2(0.06, 0.02);
    vec2 uv1 = wXZ * 0.012 + uTime * wind;
    vec2 q = vec2(fbm(uv1), fbm(uv1 + vec2(5.2, 1.3)));
    vec2 r = vec2(fbm(uv1 + 4.0*q + vec2(1.7,9.2) + 0.12*uTime*wind),
                  fbm(uv1 + 4.0*q + vec2(8.3,2.8) + 0.10*uTime*wind));
    float f = fbm(uv1 + 4.0*r);
    float c = max(f - (1.0 - uCloudCover), 0.0);
    float alpha = 1.0 - pow(uCloudSharpness, c + 0.001);
    float shade = smoothstep(0.15, 0.6, f);
    vec3 col = mix(uShadowColor, uCloudColor, shade);
    float edge = smoothstep(0.0,0.18,vUv.x)*smoothstep(1.0,0.82,vUv.x)
               * smoothstep(0.0,0.18,vUv.y)*smoothstep(1.0,0.82,vUv.y);
    gl_FragColor = vec4(col, alpha * edge * uOpacity);
  }
`

const cloudUniforms = []
for (const layer of [
  { y: -3.0, size: 250, opacity: 0.7,  cover: 0.48, sharpness: 0.008 },
  { y: -1.8, size: 180, opacity: 0.45, cover: 0.38, sharpness: 0.015 },
]) {
  const uniforms = {
    uTime:           { value: 0 },
    uCloudCover:     { value: layer.cover },
    uCloudSharpness: { value: layer.sharpness },
    uCloudColor:     { value: new THREE.Color(0.95, 0.95, 0.97) },
    uShadowColor:    { value: new THREE.Color(0.72, 0.74, 0.8) },
    uOpacity:        { value: layer.opacity },
  }
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(layer.size, layer.size),
    new THREE.ShaderMaterial({ uniforms, vertexShader: cloudVS, fragmentShader: cloudFS, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  )
  plane.rotation.x = -Math.PI / 2
  plane.position.y = layer.y
  scene.add(plane)
  cloudUniforms.push(uniforms)
}

// ── Sky + Environment ────────────────────────────────────────────────────────
const pmrem = new THREE.PMREMGenerator(renderer)
pmrem.compileEquirectangularShader()

perf.mark("sky-start")
new THREE.TextureLoader().load(
  SKY_URL,
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.colorSpace = THREE.SRGBColorSpace
    scene.environment = pmrem.fromEquirectangular(texture).texture
    scene.background  = texture
    perf.mark("sky-loaded")
    perf.flags.skyReady = true
    if (perf.flags.glbReady && !perf.flags.assetsReadyMarked) {
      perf.flags.assetsReadyMarked = true; perf.mark("assets-ready")
    }
  },
  undefined,
  (err) => {
    console.error("❌ Sky failed to load:", SKY_URL, err)
    perf.mark("sky-loaded"); perf.flags.skyReady = true
  }
)

// ── Model ────────────────────────────────────────────────────────────────────
const MODEL_TUNING = {
  extraScale: 16.0,
  rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
}

perf.mark("glb-start")
new GLTFLoader().load(
  MODEL_URL,
  (gltf) => {
    const object = gltf.scene
    object.position.set(0, 0, 0)
    object.rotation.set(0, 0, 0)

    const box    = new THREE.Box3().setFromObject(object)
    const size   = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size); box.getCenter(center)

    const maxDim = Math.max(size.x, size.y, size.z)
    if (isFinite(maxDim) && maxDim > 0) {
      const s = 1.4 / maxDim
      object.scale.setScalar(s)
      object.position.sub(center.multiplyScalar(s))
      droneBaseScale = s
    }

    object.rotation.copy(MODEL_TUNING.rotation)
    if (MODEL_TUNING.extraScale !== 1.0) {
      object.scale.multiplyScalar(MODEL_TUNING.extraScale)
      droneBaseScale *= MODEL_TUNING.extraScale
    }

    droneBasePos.copy(object.position)
    droneBaseRot.copy(object.rotation)
    object.updateMatrixWorld(true)

    const meshes = []
    object.traverse((child) => { if (child.isMesh) meshes.push(child) })

    for (const m of meshes) {
      if (m.geometry) { m.geometry.computeVertexNormals() }
      m.material = droneMats.carbonMatte
      m.castShadow = m.receiveShadow = true
    }

    const wingMeshNames = new Set(["mesh73", "mesh100", "mesh76", "mesh103"])
    let namedAssigned = 0
    for (const m of meshes) {
      if (wingMeshNames.has(m.name)) { m.material = droneMats.carbonGlossy; namedAssigned++ }
    }
    if (namedAssigned === 0) {
      const scored = meshes.map((m) => {
        const bb = new THREE.Box3().setFromObject(m)
        const sz = new THREE.Vector3(), ct = new THREE.Vector3()
        bb.getSize(sz); bb.getCenter(ct)
        const flatness  = sz.y / Math.max(sz.x, sz.z, 1e-6)
        const score = sz.x * sz.z * (1 / (flatness + 0.02)) * (0.6 + Math.abs(ct.x))
        return { m, score }
      }).sort((a, b) => b.score - a.score)
      for (let i = 0; i < Math.min(4, scored.length); i++) scored[i].m.material = droneMats.carbonGlossy
    }

    scene.add(object)
    object.updateMatrixWorld(true)

    for (const m of meshes) {
      generateWorldScaleUVs(m, m.material === droneMats.carbonGlossy ? CF_DENSITY.glossy : CF_DENSITY.matte)
    }

    droneObject = object
    perf.mark("glb-loaded")
    perf.flags.glbReady = true
    if (perf.flags.skyReady && !perf.flags.assetsReadyMarked) {
      perf.flags.assetsReadyMarked = true; perf.mark("assets-ready")
    }

    // ── GSAP scroll-scrubbed camera path ─────────────────────────────────────
    // Exact poses from the original Vercel/Framer source
    const poses = {
      p0: { cam: { x: -1.152, y: 0.239,  z:  0.006 }, tgt: { x: 0, y: 0.3, z: 0 } },
      p1: { cam: { x: -1.859, y: 1.463,  z: -2.077 }, tgt: { x: 0, y: 0.3, z: 0 } },
      p2: { cam: { x:  3.14,  y: 2.079,  z: -2.309 }, tgt: { x: 0, y: 0.3, z: 0 } },
      p3: { cam: { x:  1.859, y: 4.317,  z: -0.007 }, tgt: { x: 0, y: 0.3, z: 0 } },
    }

    const camCurveRaw = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(poses.p0.cam.x, poses.p0.cam.y, poses.p0.cam.z),
        new THREE.Vector3(poses.p1.cam.x, poses.p1.cam.y, poses.p1.cam.z),
        new THREE.Vector3(poses.p2.cam.x, poses.p2.cam.y, poses.p2.cam.z),
        new THREE.Vector3(poses.p3.cam.x, poses.p3.cam.y, poses.p3.cam.z),
      ],
      false,
      "centripetal"
    )
    const camPts = camCurveRaw.getSpacedPoints(300)
    const camCurve = new THREE.CatmullRomCurve3(camPts, false, "centripetal")
    camCurve.arcLengthDivisions = 2000

    const tgtCurveRaw = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(poses.p0.tgt.x, poses.p0.tgt.y, poses.p0.tgt.z),
        new THREE.Vector3(poses.p1.tgt.x, poses.p1.tgt.y, poses.p1.tgt.z),
        new THREE.Vector3(poses.p2.tgt.x, poses.p2.tgt.y, poses.p2.tgt.z),
        new THREE.Vector3(poses.p3.tgt.x, poses.p3.tgt.y, poses.p3.tgt.z),
      ],
      false,
      "centripetal"
    )
    const tgtPts = tgtCurveRaw.getSpacedPoints(80)
    const tgtCurve = new THREE.CatmullRomCurve3(tgtPts, false, "centripetal")
    tgtCurve.arcLengthDivisions = 2000

    const travel = { t: 0 }

    const applyPose = (t) => {
      const p = camCurve.getPointAt(t)
      const q = tgtCurve.getPointAt(t)
      camera.position.set(p.x, p.y, p.z)
      controls.target.set(q.x, q.y, q.z)
      camera.lookAt(controls.target)
      swayState.enabled = true
    }

    // Apply p0 immediately — this IS the starting view, no auto-framing override
    applyPose(0)

    // Camera movement timeline
    const tl = gsap.timeline({ defaults: { ease: "none" } })
    tl.to(travel, { t: 1, duration: 1, onUpdate: () => applyPose(travel.t) })

    // CSS filter timeline — matches Framer's grayscale fade-to-dark on scroll:
    // start: grayscale(0.6) contrast(1) brightness(1)
    // end:   grayscale(0.8) contrast(0.9) brightness(0.05)
    const filterState = { grayscale: 0.6, contrast: 1.0, brightness: 1.0 }
    const filterTl = gsap.timeline({ defaults: { ease: "none" } })
    filterTl.to(filterState, {
      grayscale: 0.8,
      contrast: 0.9,
      brightness: 0.05,
      duration: 1,
      onUpdate: () => {
        canvasWrap.style.filter = `grayscale(${filterState.grayscale.toFixed(2)}) contrast(${filterState.contrast.toFixed(2)}) brightness(${filterState.brightness.toFixed(2)})`
      }
    })

    // Set initial filter immediately
    canvasWrap.style.filter = `grayscale(0.6) contrast(1) brightness(1)`

    ScrollTrigger.getAll().forEach((t) => t.kill())

    // Camera movement — full scroll range
    ScrollTrigger.create({
      trigger: scrollRoot,
      start: "top top",
      end:   "bottom bottom",
      scrub: 0.8,
      animation: tl,
      invalidateOnRefresh: true,
    })

    // CSS filter fade — starts halfway through scroll
    ScrollTrigger.create({
      trigger: scrollRoot,
      start: "40% top",
      end:   "bottom bottom",
      scrub: 1.2,
      animation: filterTl,
      invalidateOnRefresh: true,
    })

    ScrollTrigger.refresh()

    if (!perf.flags.interactiveReadyMarked) {
      perf.flags.interactiveReadyMarked = true; perf.mark("interactive-ready")
    }
  },
  (xhr) => {
    const pct = xhr.total ? Math.round((xhr.loaded / xhr.total) * 100) : null
    console.log(pct !== null ? `⬇️ GLB: ${pct}%` : `⬇️ GLB: ${Math.round(xhr.loaded / 1024)} KB`)
  },
  (err) => console.error("❌ GLB failed:", MODEL_URL, err)
)

// ── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  ScrollTrigger.refresh()
})

// ── Render loop ──────────────────────────────────────────────────────────────
function animate() {
  const t = clock.elapsedTime
  clock.getDelta()

  if (swayState.enabled && droneObject) {
    const s = swayState.cfg
    const bobFreq  = (2 * Math.PI) / s.bobPeriod
    const bob      = Math.sin(t * bobFreq)
    const stall    = 1.0 - s.stallDepth * Math.cos(t * (2 * Math.PI) / s.stallPeriod) ** 2
    const dy       = bob * s.bobAmp * stall

    droneObject.position.set(droneBasePos.x, droneBasePos.y + dy, droneBasePos.z)
    droneObject.rotation.set(
      droneBaseRot.x + Math.cos(t * bobFreq) * stall * s.pitchAmp,
      droneBaseRot.y, droneBaseRot.z
    )
    controls.target.set(0, 0.3, 0)
  }

  for (const u of cloudUniforms) u.uTime.value = t

  camera.lookAt(controls.target)
  renderer.render(scene, camera)

  if (!perf.flags.anyFrameMarked)   { perf.flags.anyFrameMarked = true;  perf.mark("first-frame-any") }
  if (perf.flags.assetsReadyMarked && !perf.flags.firstFrameMarked) {
    perf.flags.firstFrameMarked = true; perf.mark("first-frame")
  }
  if (perf.flags.firstFrameMarked && perf.flags.interactiveReadyMarked && !perf.flags.__reported) {
    perf.flags.__reported = true; perf.reportOnce()
  }

  requestAnimationFrame(animate)
}
animate()
