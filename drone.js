import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js"
import { RGBELoader } from "three/addons/loaders/RGBELoader.js"

// =====================================================================
// Procedural Cloud System — billboard planes with FBM noise shader
// =====================================================================

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

float fbm(vec3 p) {
  float v = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < 3; i++) { v += a * snoise(p * f); f *= 2.0; a *= 0.5; }
  return v;
}

void main() {
  vec3 nc = vec3(vUv * 2.5 + uSeed * 73.7, uTime * 0.01);
  nc.x += uTime * 0.02;
  nc.y += uTime * 0.006;

  float n = fbm(nc);

  float cloud = smoothstep(-0.05, 0.5, n * uDensity - 0.15);
  cloud *= cloud;

  vec2 c = vUv * 2.0 - 1.0;
  c.x *= 0.65;
  cloud *= smoothstep(0.0, 0.45, 1.0 - length(c));

  float light = smoothstep(-0.1, 0.7, n) * 0.7 + vUv.y * 0.3;
  vec3 color = mix(uCloudColorDark, uCloudColorBright, light);

  float edge = smoothstep(0.0, 0.3, cloud) * (1.0 - smoothstep(0.3, 0.8, cloud));
  color += edge * uCloudColorBright * 0.15;

  float a = cloud * uOpacity;
  gl_FragColor = vec4(color * a, a);
}
`

const CLOUD_CONFIGS = [
  { pos: [  0,  -5,  -15], size: [100, 80],  opacity: 0.45, density: 1.3, seed: 1.0, order: -10 },
  { pos: [-25,  -8,  -30], size: [120, 90],  opacity: 0.5,  density: 1.4, seed: 2.3, order: -10 },
  { pos: [ 30,  -6,   10], size: [ 90, 70],  opacity: 0.4,  density: 1.2, seed: 3.7, order: -10 },
  { pos: [-10, -10,   20], size: [110, 80],  opacity: 0.45, density: 1.5, seed: 4.1, order: -10 },
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
          uTime:             { value: 0 },
          uOpacity:          { value: cfg.opacity },
          uDensity:          { value: cfg.density },
          uCloudColorBright: { value: new THREE.Vector3(0.89, 0.82, 0.64) },
          uCloudColorDark:   { value: new THREE.Vector3(0.55, 0.50, 0.40) },
          uSeed:             { value: cfg.seed },
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

// =====================================================================
// Scene setup
// =====================================================================

const clock = new THREE.Clock()
const scene = new THREE.Scene()

let droneObject = null
let droneBasePos = new THREE.Vector3(0, 0, 0)
let droneBaseRot = new THREE.Euler(0, 0, 0)
let droneBaseScale = 1

const bobCfg = {
  bobAmp: 0.04,
  bobPeriod: 5.0,
  stallPeriod: 3.0,
  stallDepth: 0.35,
  pitchAmp: 0.0075,
}

const reveal = {
  active: false,
  startTime: 0,
  wireframeDuration: 1.3,
  fadeOutDuration: 0.8,
  maxRadius: 1,
  wireframeClones: [],
  wireframeMat: null,
  solidUniforms: { revealRadius: { value: 0 } },
  wireUniforms:  { revealRadius: { value: 0 } },
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}

function injectRevealShader(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.revealRadius = uniforms.revealRadius
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRevealWorldPos;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvRevealWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <clipping_planes_pars_fragment>',
        '#include <clipping_planes_pars_fragment>\nuniform float revealRadius;\nvarying vec3 vRevealWorldPos;'
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse, opacity );\n{\n  float revDist = max(abs(vRevealWorldPos.x), abs(vRevealWorldPos.z));\n  if (revDist > revealRadius) discard;\n}\n'
      )
  }
  material.customProgramCacheKey = () => 'reveal'
  material.needsUpdate = true
}

function createWireframeClones(meshes, uniforms) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xff7700,
    wireframe: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  })
  injectRevealShader(mat, uniforms)
  reveal.wireframeMat = mat

  for (const m of meshes) {
    const clone = new THREE.Mesh(m.geometry, mat)
    clone.position.copy(m.position)
    clone.rotation.copy(m.rotation)
    clone.scale.copy(m.scale)
    clone.renderOrder = -1
    const parent = m.parent || m
    parent.add(clone)
    reveal.wireframeClones.push(clone)
  }
}

function cleanupReveal() {
  for (const c of reveal.wireframeClones) {
    c.parent?.remove(c)
  }
  reveal.wireframeClones.length = 0

  if (reveal.wireframeMat) {
    reveal.wireframeMat.dispose()
    reveal.wireframeMat = null
  }

  for (const mat of [droneMats.carbonGlossy, droneMats.carbonMatte]) {
    mat.onBeforeCompile = () => {}
    mat.customProgramCacheKey = () => ''
    mat.needsUpdate = true
  }

  reveal.active = false
}

const generateWorldScaleUVs = (mesh, texelsPerUnit) => {
  const geo = mesh.geometry
  if (!geo) return
  const pos = geo.attributes.position
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
    if (ax >= ay && ax >= az)       { u = _v.y; v = _v.z }
    else if (ay >= ax && ay >= az)  { u = _v.x; v = _v.z }
    else                            { u = _v.x; v = _v.y }

    uvs[i * 2 + 0] = u * texelsPerUnit
    uvs[i * 2 + 1] = v * texelsPerUnit
  }

  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2))
  geo.attributes.uv.needsUpdate = true
}

const makeCarbonFiberTextures = (opts = {}) => {
  const size = 1024
  const towCount = opts.towCount || 32
  const towPx = size / towCount
  const gap = opts.gap || 1
  const isGlossy = opts.glossy !== false

  const makeCanvas = () => {
    const c = document.createElement("canvas")
    c.width = size; c.height = size
    return { c, ctx: c.getContext("2d") }
  }

  const { c: albedoC, ctx: a } = makeCanvas()
  a.fillStyle = "#1a1a1e"
  a.fillRect(0, 0, size, size)

  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx, y = row * towPx
      const isWarpOver = ((col + row) % 4) < 2
      if (isWarpOver) {
        const base = 120 + Math.random() * 20
        a.fillStyle = `rgb(${base},${base},${base + 3})`
      } else {
        const base = 85 + Math.random() * 20
        a.fillStyle = `rgb(${base + 2},${base},${base})`
      }
      a.fillRect(x + gap, y + gap, towPx - gap * 2, towPx - gap * 2)

      const strandCount = 5
      if (isWarpOver) {
        for (let s = 0; s < strandCount; s++) {
          const sx = x + gap + ((towPx - gap * 2) * (s + 0.5)) / strandCount
          a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`
          a.lineWidth = 0.8
          a.beginPath(); a.moveTo(sx, y + gap); a.lineTo(sx, y + towPx - gap); a.stroke()
        }
      } else {
        for (let s = 0; s < strandCount; s++) {
          const sy = y + gap + ((towPx - gap * 2) * (s + 0.5)) / strandCount
          a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`
          a.lineWidth = 0.8
          a.beginPath(); a.moveTo(x + gap, sy); a.lineTo(x + towPx - gap, sy); a.stroke()
        }
      }
    }
  }

  for (let i = 0; i < 400; i++) {
    const bx = Math.random() * size, by = Math.random() * size, br = 40 + Math.random() * 100
    a.fillStyle = `rgba(255,255,255,${0.004 + Math.random() * 0.008})`
    a.beginPath(); a.arc(bx, by, br, 0, Math.PI * 2); a.fill()
  }

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
      const gapRough = baseRough + 30
      r.fillStyle = `rgb(${gapRough},${gapRough},${gapRough})`
      r.fillRect(x, y, towPx, gap)
      r.fillRect(x, y, gap, towPx)
    }
  }

  for (let i = 0; i < 15000; i++) {
    const nx = Math.random() * size, ny = Math.random() * size, nv = baseRough - 10 + Math.random() * 20
    r.fillStyle = `rgba(${nv},${nv},${nv},0.08)`
    r.fillRect(nx, ny, 1, 1)
  }

  const { c: normalC, ctx: n } = makeCanvas()
  n.fillStyle = "rgb(128,128,255)"
  n.fillRect(0, 0, size, size)

  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx, y = row * towPx
      const isWarpOver = ((col + row) % 4) < 2
      if (isWarpOver) {
        const halfW = (towPx - gap * 2) / 2
        n.fillStyle = "rgba(110,128,255,0.45)"; n.fillRect(x + gap, y + gap, halfW, towPx - gap * 2)
        n.fillStyle = "rgba(146,128,255,0.45)"; n.fillRect(x + gap + halfW, y + gap, halfW, towPx - gap * 2)
        n.fillStyle = "rgba(128,115,255,0.3)";  n.fillRect(x + gap, y + gap, towPx - gap * 2, 2)
        n.fillStyle = "rgba(128,141,255,0.3)";  n.fillRect(x + gap, y + towPx - gap - 2, towPx - gap * 2, 2)
      } else {
        const halfH = (towPx - gap * 2) / 2
        n.fillStyle = "rgba(128,110,255,0.45)"; n.fillRect(x + gap, y + gap, towPx - gap * 2, halfH)
        n.fillStyle = "rgba(128,146,255,0.45)"; n.fillRect(x + gap, y + gap + halfH, towPx - gap * 2, halfH)
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

const cfGlossy = makeCarbonFiberTextures({ glossy: true,  towCount: 32, repeat: 4.0 })
const cfMatte  = makeCarbonFiberTextures({ glossy: false, towCount: 24, repeat: 3.0 })

const droneMats = {
  carbonGlossy: new THREE.MeshPhysicalMaterial({
    color: 0x676d7e,
    map: cfGlossy.albedo,
    metalness: 0.05,
    roughness: 0.18,
    roughnessMap: cfGlossy.rough,
    clearcoat: 0.5,
    clearcoatRoughness: 0.03,
    normalMap: cfGlossy.normal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    envMapIntensity: 2.0,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  }),
  carbonMatte: new THREE.MeshPhysicalMaterial({
    color: 0x676d7e,
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

const CF_DENSITY = { glossy: 12.0, matte: 10.0 }

// =====================================================================
// Renderer — mounted into Webflow's #scene-drone container
// =====================================================================

const container = document.getElementById("scene-drone")

const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000)
camera.position.set(0, 0.5, 2)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setSize(container.clientWidth, container.clientHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 2.0
renderer.setClearColor(0x000000, 0)

// Style the canvas to fill its container
renderer.domElement.style.width = "100%"
renderer.domElement.style.height = "100%"
renderer.domElement.style.display = "block"

container.appendChild(renderer.domElement)

// Ambient light
const hemi = new THREE.HemisphereLight(0x8eafc2, 0x584838, 0.5)
scene.add(hemi)

CloudSystem.create(scene)

const cameraTarget = new THREE.Vector3(0, 0.3, 0)

// =====================================================================
// Asset URLs — hardcoded to the hosted GitHub Pages paths
// =====================================================================
const SKY_URL   = "https://webflow-zypsy.github.io/icarus/drone-bg.hdr"
const MODEL_URL = "https://webflow-zypsy.github.io/icarus/drone-apollo.glb"

const MODEL_TUNING = {
  extraScale: 16.0,
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
    texture.dispose()
    console.log("✅ drone.js: HDR environment loaded")
  },
  undefined,
  (err) => console.error("❌ drone.js: HDR failed to load", err)
)

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)

gltfLoader.load(
  MODEL_URL,
  (gltf) => {
    const object = gltf.scene
    object.position.set(0, 0, 0)
    object.rotation.set(0, 0, 0)

    const box = new THREE.Box3().setFromObject(object)
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    box.getSize(size)
    box.getCenter(center)

    const maxDim = Math.max(size.x, size.y, size.z)
    if (isFinite(maxDim) && maxDim > 0) {
      const target = 1.4
      const s = target / maxDim
      object.scale.setScalar(s)
      object.position.sub(center.multiplyScalar(s))
      droneBaseScale = s
    } else {
      object.scale.setScalar(1)
      droneBaseScale = 1
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
      if (m.geometry && !m.geometry.attributes.normal) m.geometry.computeVertexNormals()
      m.material = droneMats.carbonMatte
      m.castShadow = true
      m.receiveShadow = true
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
        const flatness = sz.y / Math.max(sz.x, sz.z, 1e-6)
        const score = sz.x * sz.z * (1 / (flatness + 0.02)) * (0.6 + Math.abs(ct.x))
        return { m, score }
      }).sort((a, b) => b.score - a.score)
      for (let i = 0; i < Math.min(4, scored.length); i++) scored[i].m.material = droneMats.carbonGlossy
    }

    scene.add(object)
    object.updateMatrixWorld(true)

    for (const m of meshes) {
      const density = m.material === droneMats.carbonGlossy ? CF_DENSITY.glossy : CF_DENSITY.matte
      generateWorldScaleUVs(m, density)
    }

    droneObject = object

    {
      const revealBox = new THREE.Box3().setFromObject(object)
      const maxR = Math.max(
        Math.abs(revealBox.min.x), Math.abs(revealBox.max.x),
        Math.abs(revealBox.min.z), Math.abs(revealBox.max.z)
      )
      reveal.maxRadius = maxR > 0 ? maxR * 1.05 : 10
      injectRevealShader(droneMats.carbonGlossy, reveal.solidUniforms)
      injectRevealShader(droneMats.carbonMatte, reveal.solidUniforms)
      createWireframeClones(meshes, reveal.wireUniforms)
      reveal.solidUniforms.revealRadius.value = 0
      reveal.wireUniforms.revealRadius.value = 0
      reveal.startTime = clock.elapsedTime
      reveal.active = true
    }

    console.log("✅ drone.js: GLB loaded")

    // ---- Scroll-driven camera poses ----
    const poses = [
      { cam: new THREE.Vector3(-2.822, 1.964, -2.34), tgt: new THREE.Vector3(0, 0.3, 0) },
      { cam: new THREE.Vector3(-4.641, 3.509, 0),     tgt: new THREE.Vector3(0, 0.3, 0) },
      { cam: new THREE.Vector3(-5.613, 11.412, 0),    tgt: new THREE.Vector3(0, 0.3, 0) },
    ]

    let scrollT = 0, smoothT = 0

    const applyPose = (t) => {
      const clamped = Math.max(0, Math.min(1, t))
      const segments = poses.length - 1
      const scaled = clamped * segments
      const i = Math.min(Math.floor(scaled), segments - 1)
      const frac = scaled - i
      const p = poses[i].cam.clone().lerp(poses[i + 1].cam, frac)
      const q = poses[i].tgt.clone().lerp(poses[i + 1].tgt, frac)
      camera.position.set(p.x, p.y, p.z)
      cameraTarget.set(q.x, q.y, q.z)
      camera.lookAt(cameraTarget)
    }

    applyPose(0)

    window.__droneApplyPose = applyPose
    window.__droneScrollState = {
      getScrollT: () => scrollT,
      getSmoothT: () => smoothT,
      setSmoothT: (v) => { smoothT = v },
      setScrollT: (v) => { scrollT = v },
    }
  },
  undefined,
  (err) => console.error("❌ drone.js: GLB failed to load", err)
)

// =====================================================================
// Scroll — read progress from the Webflow #scenes-track element
// =====================================================================

function getDroneScrollProgress() {
  const track = document.getElementById("scenes-track")
  if (!track) return 0
  const rect = track.getBoundingClientRect()
  const trackHeight = track.offsetHeight
  const viewportHeight = window.innerHeight
  const scrollable = trackHeight - viewportHeight
  const scrolled = -rect.top
  return scrollable > 0 ? Math.max(0, Math.min(1, scrolled / scrollable)) : 0
}

window.addEventListener("scroll", () => {
  if (window.__droneScrollState) {
    window.__droneScrollState.setScrollT(getDroneScrollProgress())
  }
}, { passive: true })

// postMessage fallback (Framer / iframe embeds)
window.addEventListener("message", (e) => {
  if (e.data && typeof e.data.scrollProgress === "number" && window.__droneScrollState) {
    window.__droneScrollState.setScrollT(e.data.scrollProgress)
  }
})

// =====================================================================
// Resize
// =====================================================================

window.addEventListener("resize", () => {
  const w = container.clientWidth
  const h = container.clientHeight
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

// =====================================================================
// Render loop
// =====================================================================

function animate() {
  clock.getDelta()
  const t = clock.elapsedTime

  if (window.__droneScrollState && window.__droneApplyPose) {
    const state = window.__droneScrollState
    const target = state.getScrollT()
    let smooth = state.getSmoothT()
    smooth += (target - smooth) * 0.06
    if (Math.abs(target - smooth) < 0.0001) smooth = target
    state.setSmoothT(smooth)
    window.__droneApplyPose(smooth)
  }

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

  if (reveal.active) {
    const elapsed = t - reveal.startTime
    const wireLinear = Math.min(elapsed / reveal.wireframeDuration, 1)
    const wireEased = easeOutCubic(wireLinear)
    reveal.wireUniforms.revealRadius.value = wireEased * reveal.maxRadius
    reveal.solidUniforms.revealRadius.value = 0

    if (wireLinear >= 1) {
      const fadeElapsed = elapsed - reveal.wireframeDuration
      const fadeLinear = Math.min(fadeElapsed / reveal.fadeOutDuration, 1)
      const fade = easeOutCubic(fadeLinear)
      reveal.solidUniforms.revealRadius.value = easeOutCubic(fadeLinear) * reveal.maxRadius * 1.05
      if (reveal.wireframeMat) reveal.wireframeMat.opacity = 0.6 * (1 - fade)
      if (fadeLinear >= 1) cleanupReveal()
    }
  }

  CloudSystem.update(t, camera)
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()

// Dev: press P to log camera pose
const capturedPoses = []
window.addEventListener("keydown", (e) => {
  if (e.key === "p" || e.key === "P") {
    const pose = {
      cam: { x: +camera.position.x.toFixed(3), y: +camera.position.y.toFixed(3), z: +camera.position.z.toFixed(3) },
      tgt: { x: +cameraTarget.x.toFixed(3), y: +cameraTarget.y.toFixed(3), z: +cameraTarget.z.toFixed(3) },
    }
    capturedPoses.push(pose)
    console.log(`📸 Drone pose ${capturedPoses.length}:`, JSON.stringify(pose))
  }
})
