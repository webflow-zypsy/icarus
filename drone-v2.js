// =============================================================================
// Consolidated scene — one file, one shared Three.js scene, two renderers.
// #scene-drone       → close-up camera  (z-index 1, on top)  — plain renderer, transparent bg
// #scene-background  → wide camera      (z-index 0, behind)  — composer with sharpen, EXR sky
//
// Intro sequence (background canvas):
//   Phase "waiting"    → white clear color, waits for EXR + GLB to be ready
//   Phase "gridReveal" → topographic wireframe terrain grid fades in (1.3s, synced with drone wireframe reveal)
//   Phase "fadeIn"     → EXR sky crossfades in, topo grid fades out, sharpener activates (0.8s)
//   Phase "done"       → full EXR background, sharpen postprocessing active, topo grid disposed
// =============================================================================

import * as THREE from "three"
import { GLTFLoader }    from "three/addons/loaders/GLTFLoader.js"
import { DRACOLoader }   from "three/addons/loaders/DRACOLoader.js"
import { RGBELoader }    from "three/addons/loaders/RGBELoader.js"
import { EXRLoader }     from "three/addons/loaders/EXRLoader.js"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass }    from "three/addons/postprocessing/RenderPass.js"
import { ShaderPass }    from "three/addons/postprocessing/ShaderPass.js"
import { OutputPass }    from "three/addons/postprocessing/OutputPass.js"

// =============================================================================
// Ease helpers
// =============================================================================

function easeOutCubic(t)    { return 1 - Math.pow(1 - t, 3) }
function easeInOutCubic(t)  { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2 }

// =============================================================================
// Procedural Cloud System — billboard planes with FBM noise shader
// =============================================================================

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
  { pos: [  0,  -5,  -15], size: [100,  80], opacity: 0.45, density: 1.3, seed: 1.0 },
  { pos: [-25,  -8,  -30], size: [120,  90], opacity: 0.5,  density: 1.4, seed: 2.3 },
  { pos: [ 30,  -6,   10], size: [ 90,  70], opacity: 0.4,  density: 1.2, seed: 3.7 },
  { pos: [-10, -10,   20], size: [110,  80], opacity: 0.45, density: 1.5, seed: 4.1 },
  { pos: [ 40, -12,  -50], size: [140, 100], opacity: 0.35, density: 1.1, seed: 5.5 },
  { pos: [-50, -15,   40], size: [130, 110], opacity: 0.35, density: 1.2, seed: 6.2 },
  { pos: [ 15, -18,   60], size: [150, 100], opacity: 0.3,  density: 1.0, seed: 7.8 },
  { pos: [-35, -20,  -60], size: [160, 120], opacity: 0.3,  density: 1.1, seed: 8.4 },
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
        transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2])
      mesh.renderOrder = -10
      mesh.frustumCulled = true
      mesh.userData.basePos = new THREE.Vector3(...cfg.pos)
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

// =============================================================================
// Construction reveal effect (drone)
// =============================================================================

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
    color: 0xff7700, wireframe: true, transparent: true, opacity: 0.6, depthWrite: false,
  })
  injectRevealShader(mat, uniforms)
  reveal.wireframeMat = mat
  for (const m of meshes) {
    const clone = new THREE.Mesh(m.geometry, mat)
    clone.position.copy(m.position)
    clone.rotation.copy(m.rotation)
    clone.scale.copy(m.scale)
    clone.renderOrder = -1
    ;(m.parent || m).add(clone)
    reveal.wireframeClones.push(clone)
  }
}

function cleanupReveal() {
  for (const c of reveal.wireframeClones) c.parent?.remove(c)
  reveal.wireframeClones.length = 0
  if (reveal.wireframeMat) { reveal.wireframeMat.dispose(); reveal.wireframeMat = null }
  for (const mat of Object.values(droneMats)) {
    mat.onBeforeCompile = () => {}
    mat.customProgramCacheKey = () => ''
    mat.needsUpdate = true
  }
  reveal.active = false
}

// =============================================================================
// UV generation
// =============================================================================

function generateWorldScaleUVs(mesh, texelsPerUnit) {
  const geo = mesh.geometry
  if (!geo) return
  const pos = geo.attributes.position, norm = geo.attributes.normal
  if (!pos || !norm) return
  const uvs = new Float32Array(pos.count * 2)
  mesh.updateMatrixWorld(true)
  const _v = new THREE.Vector3(), _n = new THREE.Vector3()
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
  for (let i = 0; i < pos.count; i++) {
    _v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld)
    _n.set(norm.getX(i), norm.getY(i), norm.getZ(i)).applyMatrix3(normalMatrix).normalize()
    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z)
    let u, v
    if      (ax >= ay && ax >= az) { u = _v.y; v = _v.z }
    else if (ay >= ax && ay >= az) { u = _v.x; v = _v.z }
    else                           { u = _v.x; v = _v.y }
    uvs[i * 2]     = u * texelsPerUnit
    uvs[i * 2 + 1] = v * texelsPerUnit
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2))
  geo.attributes.uv.needsUpdate = true
}

// =============================================================================
// Procedural textures
// =============================================================================

function makeCarbonFiberTextures(opts = {}) {
  const size = 1024, towCount = opts.towCount || 32
  const towPx = size / towCount, gap = opts.gap || 1
  const isGlossy = opts.glossy !== false
  const makeCanvas = () => { const c = document.createElement("canvas"); c.width = size; c.height = size; return { c, ctx: c.getContext("2d") } }

  const { c: albedoC, ctx: a } = makeCanvas()
  a.fillStyle = "#1a1a1e"; a.fillRect(0, 0, size, size)
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx, y = row * towPx, isWarpOver = ((col + row) % 4) < 2
      const base = isWarpOver ? 120 + Math.random() * 20 : 85 + Math.random() * 20
      a.fillStyle = isWarpOver ? `rgb(${base},${base},${base+3})` : `rgb(${base+2},${base},${base})`
      a.fillRect(x + gap, y + gap, towPx - gap * 2, towPx - gap * 2)
      for (let s = 0; s < 5; s++) {
        a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`; a.lineWidth = 0.8; a.beginPath()
        if (isWarpOver) { const sx = x + gap + ((towPx - gap * 2) * (s + 0.5)) / 5; a.moveTo(sx, y + gap); a.lineTo(sx, y + towPx - gap) }
        else { const sy = y + gap + ((towPx - gap * 2) * (s + 0.5)) / 5; a.moveTo(x + gap, sy); a.lineTo(x + towPx - gap, sy) }
        a.stroke()
      }
    }
  }
  for (let i = 0; i < 400; i++) { a.fillStyle = `rgba(255,255,255,${0.004 + Math.random() * 0.008})`; a.beginPath(); a.arc(Math.random() * size, Math.random() * size, 40 + Math.random() * 100, 0, Math.PI * 2); a.fill() }

  const { c: roughC, ctx: r } = makeCanvas()
  const baseRough = isGlossy ? 25 : 90
  r.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`; r.fillRect(0, 0, size, size)
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx, y = row * towPx, isWarpOver = ((col + row) % 4) < 2
      const v = isWarpOver ? baseRough - 6 + Math.random() * 4 : baseRough + 2 + Math.random() * 6
      r.fillStyle = `rgb(${v},${v},${v})`; r.fillRect(x + gap, y + gap, towPx - gap * 2, towPx - gap * 2)
      const gr = baseRough + 30; r.fillStyle = `rgb(${gr},${gr},${gr})`; r.fillRect(x, y, towPx, gap); r.fillRect(x, y, gap, towPx)
    }
  }

  const { c: normalC, ctx: n } = makeCanvas()
  n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, size, size)
  for (let row = 0; row < towCount; row++) {
    for (let col = 0; col < towCount; col++) {
      const x = col * towPx, y = row * towPx, isWarpOver = ((col + row) % 4) < 2
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
      n.fillStyle = "rgba(128,108,240,0.5)"; n.fillRect(x, y, towPx, gap + 1)
      n.fillStyle = "rgba(108,128,240,0.5)"; n.fillRect(x, y, gap + 1, towPx)
    }
  }

  const mkTex = (canvas, cs) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = cs; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 16; return t }
  return { albedo: mkTex(albedoC, THREE.SRGBColorSpace), rough: mkTex(roughC, THREE.NoColorSpace), normal: mkTex(normalC, THREE.NoColorSpace) }
}

function makeSolarPanelTextures(opts = {}) {
  const size = 512, cellCols = opts.cellCols || 4, cellRows = opts.cellRows || 6
  const cellGap = opts.cellGap || 10, busBarCount = opts.busBarCount || 5, fingerSpacing = opts.fingerSpacing || 4
  const cellW = (size - (cellCols + 1) * cellGap) / cellCols, cellH = (size - (cellRows + 1) * cellGap) / cellRows
  const cX = (col) => cellGap + col * (cellW + cellGap), cY = (row) => cellGap + row * (cellH + cellGap)
  const makeCanvas = () => { const c = document.createElement("canvas"); c.width = size; c.height = size; return { c, ctx: c.getContext("2d") } }

  const { c: albedoC, ctx: a } = makeCanvas()
  a.fillStyle = "#474751"; a.fillRect(0, 0, size, size)
  for (let row = 0; row < cellRows; row++) {
    for (let col = 0; col < cellCols; col++) {
      const x = cX(col), y = cY(row), rv = Math.random() * 4 - 2
      a.fillStyle = `rgb(${6+rv|0},${8+rv|0},${18+rv|0})`; a.fillRect(x, y, cellW, cellH)
      a.strokeStyle = "rgba(30,50,100,0.5)"; a.lineWidth = 2; a.strokeRect(x+1, y+1, cellW-2, cellH-2)
      const g = a.createLinearGradient(x, y, x+cellW, y+cellH); g.addColorStop(0, "rgba(40,50,90,0.08)"); g.addColorStop(1, "rgba(20,25,50,0.08)")
      a.fillStyle = g; a.fillRect(x, y, cellW, cellH)
      for (let b = 0; b < busBarCount; b++) { const bY = y + cellH * (b+1) / (busBarCount+1); a.strokeStyle = "rgba(50,50,58,0.95)"; a.lineWidth = 1.5; a.beginPath(); a.moveTo(x, bY); a.lineTo(x+cellW, bY); a.stroke() }
      a.strokeStyle = "rgba(45,45,55,0.5)"; a.lineWidth = 0.5
      for (let fx = x + fingerSpacing; fx < x + cellW; fx += fingerSpacing) { a.beginPath(); a.moveTo(fx, y); a.lineTo(fx, y+cellH); a.stroke() }
    }
  }

  const { c: roughC, ctx: r } = makeCanvas()
  r.fillStyle = "rgb(90,90,90)"; r.fillRect(0, 0, size, size)
  for (let row = 0; row < cellRows; row++) {
    for (let col = 0; col < cellCols; col++) {
      const x = cX(col), y = cY(row), cv = 50 + Math.random() * 5
      r.fillStyle = `rgb(${cv|0},${cv|0},${cv|0})`; r.fillRect(x, y, cellW, cellH)
      for (let b = 0; b < busBarCount; b++) { const bY = y + cellH * (b+1) / (busBarCount+1); r.strokeStyle = "rgb(30,30,30)"; r.lineWidth = 1.5; r.beginPath(); r.moveTo(x, bY); r.lineTo(x+cellW, bY); r.stroke() }
    }
  }

  const { c: normalC, ctx: n } = makeCanvas()
  n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, size, size)
  for (let row = 0; row < cellRows; row++) {
    for (let col = 0; col < cellCols; col++) {
      const x = cX(col), y = cY(row)
      n.fillStyle = "rgba(118,128,255,0.6)"; n.fillRect(x, y, 2, cellH); n.fillStyle = "rgba(138,128,255,0.6)"; n.fillRect(x+cellW-2, y, 2, cellH)
      n.fillStyle = "rgba(128,118,255,0.6)"; n.fillRect(x, y, cellW, 2); n.fillStyle = "rgba(128,138,255,0.6)"; n.fillRect(x, y+cellH-2, cellW, 2)
      for (let b = 0; b < busBarCount; b++) { const bY = y + cellH * (b+1) / (busBarCount+1); n.fillStyle = "rgba(128,118,255,0.4)"; n.fillRect(x, bY-1, cellW, 1); n.fillStyle = "rgba(128,138,255,0.4)"; n.fillRect(x, bY+1, cellW, 1) }
    }
  }

  const mkTex = (canvas, cs) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = cs; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 16; return t }
  return { albedo: mkTex(albedoC, THREE.SRGBColorSpace), rough: mkTex(roughC, THREE.NoColorSpace), normal: mkTex(normalC, THREE.NoColorSpace) }
}

// =============================================================================
// Materials
// =============================================================================

const cfGlossy = makeCarbonFiberTextures({ glossy: true,  towCount: 32 })
const cfMatte  = makeCarbonFiberTextures({ glossy: false, towCount: 24 })
const solarTex = makeSolarPanelTextures()

const droneMats = {
  solarPanel: new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: solarTex.albedo, metalness: 0.08, roughness: 0.45, roughnessMap: solarTex.rough,
    clearcoat: 0.9, clearcoatRoughness: 0.05, normalMap: solarTex.normal, normalScale: new THREE.Vector2(0.4, 0.4),
    envMapIntensity: 0.5, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
  }),
  carbonGlossy: new THREE.MeshPhysicalMaterial({
    color: 0x676d7e, map: cfGlossy.albedo, metalness: 0.05, roughness: 0.18, roughnessMap: cfGlossy.rough,
    clearcoat: 0.5, clearcoatRoughness: 0.03, normalMap: cfGlossy.normal, normalScale: new THREE.Vector2(0.6, 0.6),
    envMapIntensity: 2.0, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
  }),
  carbonMatte: new THREE.MeshPhysicalMaterial({
    color: 0x6d6d6d, map: cfMatte.albedo, metalness: 0.0, roughness: 0.92, roughnessMap: cfMatte.rough,
    clearcoat: 0.0, normalMap: cfMatte.normal, normalScale: new THREE.Vector2(0.2, 0.2),
    envMapIntensity: 0.25, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
  }),
  tailMatte: new THREE.MeshPhysicalMaterial({
    color: 0xc9c9c9, map: cfMatte.albedo, metalness: 0.0, roughness: 0.92, roughnessMap: cfMatte.rough,
    clearcoat: 0.0, normalMap: cfMatte.normal, normalScale: new THREE.Vector2(0.2, 0.2),
    envMapIntensity: 0.25, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
  }),
}

const CF_DENSITY = { glossy: 12.0, matte: 40.0 }
const SOLAR_DENSITY = 3.0

// =============================================================================
// Shared scene + lighting
// =============================================================================

const clock = new THREE.Clock()
const scene = new THREE.Scene()

const hemi = new THREE.HemisphereLight(0x8eafc2, 0x584838, 0.8)
scene.add(hemi)

CloudSystem.create(scene)

// =============================================================================
// Drone renderer — #scene-drone (z-index 1, close-up, always transparent bg)
// =============================================================================

const droneContainer = document.getElementById("scene-drone")

const droneCamera = new THREE.PerspectiveCamera(60, droneContainer.clientWidth / droneContainer.clientHeight, 0.1, 1000)
droneCamera.position.set(0, 0.5, 2)
const droneCamTarget = new THREE.Vector3(0, 0.3, 0)

const droneRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
droneRenderer.setSize(droneContainer.clientWidth, droneContainer.clientHeight)
droneRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
droneRenderer.outputColorSpace = THREE.SRGBColorSpace
droneRenderer.toneMapping = THREE.ACESFilmicToneMapping
droneRenderer.toneMappingExposure = 2.0
droneRenderer.setClearColor(0x000000, 0) // always transparent
droneRenderer.domElement.style.cssText = "width:100%;height:100%;display:block;"
droneContainer.appendChild(droneRenderer.domElement)

// =============================================================================
// Background renderer — #scene-background (z-index 0, wide shot, EXR sky + sharpen)
// Starts with white clear color, crossfades to EXR background during intro
// =============================================================================

const bgContainer = document.getElementById("scene-background")

const bgCamera = new THREE.PerspectiveCamera(15, bgContainer.clientWidth / bgContainer.clientHeight, 0.1, 1000)
bgCamera.position.set(0, 1.2, 5.2)
const bgCamTarget = new THREE.Vector3(0.6, 0.98, 0)

const bgRenderer = new THREE.WebGLRenderer({ antialias: false })
bgRenderer.setSize(bgContainer.clientWidth, bgContainer.clientHeight)
bgRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
bgRenderer.outputColorSpace = THREE.SRGBColorSpace
bgRenderer.toneMapping = THREE.ACESFilmicToneMapping
bgRenderer.toneMappingExposure = 2.0
bgRenderer.setClearColor(0xffffff, 1) // white during intro, fades to EXR
bgRenderer.domElement.style.cssText = "width:100%;height:100%;display:block;"
bgContainer.appendChild(bgRenderer.domElement)

// =============================================================================
// Sharpen postprocessing — bgRenderer only
// Multi-scale unsharp mask: tight (1px) + wide (uRadius px) for panoramic backgrounds
// =============================================================================

const SharpenShader = {
  name: "SharpenShader",
  uniforms: {
    tDiffuse:   { value: null },
    uPixelSize: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uStrength:  { value: 1.5 },
    uRadius:    { value: 3.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uPixelSize;
    uniform float uStrength;
    uniform float uRadius;
    varying vec2 vUv;
    void main() {
      vec3 center = texture2D(tDiffuse, vUv).rgb;
      vec2 off1 = uPixelSize;
      vec3 blur1 = (
        texture2D(tDiffuse, vUv + vec2( off1.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(-off1.x, 0.0)).rgb +
        texture2D(tDiffuse, vUv + vec2(0.0,  off1.y)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, -off1.y)).rgb +
        texture2D(tDiffuse, vUv + vec2( off1.x,  off1.y)).rgb + texture2D(tDiffuse, vUv + vec2(-off1.x,  off1.y)).rgb +
        texture2D(tDiffuse, vUv + vec2( off1.x, -off1.y)).rgb + texture2D(tDiffuse, vUv + vec2(-off1.x, -off1.y)).rgb
      ) / 8.0;
      vec2 off2 = uPixelSize * uRadius;
      vec3 blur2 = (
        texture2D(tDiffuse, vUv + vec2( off2.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(-off2.x, 0.0)).rgb +
        texture2D(tDiffuse, vUv + vec2(0.0,  off2.y)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, -off2.y)).rgb +
        texture2D(tDiffuse, vUv + vec2( off2.x,  off2.y)).rgb + texture2D(tDiffuse, vUv + vec2(-off2.x,  off2.y)).rgb +
        texture2D(tDiffuse, vUv + vec2( off2.x, -off2.y)).rgb + texture2D(tDiffuse, vUv + vec2(-off2.x, -off2.y)).rgb
      ) / 8.0;
      vec3 detail    = center + uStrength * (center - blur1) * 0.4;
      vec3 structure = center + uStrength * (center - blur2) * 0.6;
      gl_FragColor = vec4(max(detail + structure - center, vec3(0.0)), 1.0);
    }
  `,
}

const bgComposer = new EffectComposer(bgRenderer)
bgComposer.addPass(new RenderPass(scene, bgCamera))
const sharpenPass = new ShaderPass(SharpenShader)
sharpenPass.enabled = false // disabled during intro, enabled after
bgComposer.addPass(sharpenPass)
bgComposer.addPass(new OutputPass())

function updateSharpenResolution() {
  const pr = bgRenderer.getPixelRatio()
  sharpenPass.uniforms.uPixelSize.value.set(
    1 / (bgContainer.clientWidth * pr),
    1 / (bgContainer.clientHeight * pr)
  )
}
updateSharpenResolution()

// Dev console controls: window.sharpen.strength, .radius, .enabled
window.sharpen = {
  get strength() { return sharpenPass.uniforms.uStrength.value },
  set strength(v) { sharpenPass.uniforms.uStrength.value = Math.max(0, v) },
  get radius()   { return sharpenPass.uniforms.uRadius.value },
  set radius(v)  { sharpenPass.uniforms.uRadius.value = Math.max(0.5, v) },
  get enabled()  { return sharpenPass.enabled },
  set enabled(v) { sharpenPass.enabled = !!v },
}

// =============================================================================
// Topographic wireframe terrain grid — background intro effect
// Displaced by EXR luminance, fades in then out during intro phases
// =============================================================================

let topoMesh = null
let topoGeo  = null
let topoMat  = null

function buildTopoGrid(scene) {
  topoGeo = new THREE.PlaneGeometry(200, 200, 180, 180)
  topoGeo.rotateX(-Math.PI / 2)

  topoMat = new THREE.ShaderMaterial({
    uniforms: {
      tSky:               { value: null },
      uOpacity:           { value: 0.0 },
      uDisplacementScale: { value: 3.5 },
    },
    vertexShader: /* glsl */ `
      uniform sampler2D tSky;
      uniform float uDisplacementScale;
      varying float vLuminance;
      void main() {
        vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 dir = normalize(worldPos - vec3(0.0, -2.0, 0.0));
        float u = 0.5 + atan(dir.x, dir.z) / (2.0 * 3.14159265);
        float v = acos(clamp(dir.y, -1.0, 1.0)) / 3.14159265;
        vec4 texSample = texture2D(tSky, vec2(u, v));
        float luminance = clamp(dot(texSample.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 2.0);
        vLuminance = luminance;
        vec3 displaced = worldPos;
        displaced.y += luminance * uDisplacementScale;
        gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vLuminance;
      void main() {
        float brightness = 0.82 + vLuminance * 0.05;
        gl_FragColor = vec4(vec3(brightness), uOpacity);
      }
    `,
    wireframe: true,
    transparent: true,
    depthWrite: false,
  })

  topoMesh = new THREE.Mesh(topoGeo, topoMat)
  topoMesh.position.set(-1.5, -1, -1)
  scene.add(topoMesh)
}

function disposeTopoGrid(scene) {
  if (topoMesh) { scene.remove(topoMesh); topoGeo.dispose(); topoMat.dispose() }
  topoMesh = topoGeo = topoMat = null
}

buildTopoGrid(scene)

// =============================================================================
// Background intro animation state
// =============================================================================

const bgAnim = {
  phase: "waiting", // "waiting" | "gridReveal" | "fadeIn" | "done"
  phaseStart: 0,
  gridRevealDuration: 1.3,  // matches reveal.wireframeDuration
  fadeInDuration: 0.8,       // matches reveal.fadeOutDuration
}

let bgOpacity    = 0         // 0 = white, 1 = full EXR
let exrTexture   = null      // the loaded EXR background texture
let exrReady     = false
const _clearColor = new THREE.Color()

// =============================================================================
// Assets
// =============================================================================

const HDR_URL   = "https://webflow-zypsy.github.io/icarus/green-512.hdr"  // PBR env reflections on drone materials
const EXR_URL   = "https://webflow-zypsy.github.io/icarus/green-2k.exr"   // visible sky background + topo grid displacement
const MODEL_URL = "https://webflow-zypsy.github.io/icarus/drone-apollo.glb"

const MODEL_TUNING = {
  extraScale: 16.0,
  rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
}

// PMREM for PBR env reflections — built against droneRenderer (shared across both)
const pmrem = new THREE.PMREMGenerator(droneRenderer)
pmrem.compileEquirectangularShader()

// Load HDR → PBR environment (reflections on drone materials)
new RGBELoader().load(
  HDR_URL,
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping
    const envMap = pmrem.fromEquirectangular(texture).texture
    scene.environment = envMap
    scene.environmentRotation = new THREE.Euler(-840 * Math.PI / 180, 2070 * Math.PI / 180, 0)
    texture.dispose()
    console.log("✅ HDR env loaded")
  },
  undefined,
  (err) => console.error("❌ HDR failed:", err)
)

// Load EXR → visible sky background for bgRenderer
new EXRLoader().load(
  EXR_URL,
  (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    exrTexture = texture
    // Feed into topo grid for displacement
    if (topoMat) topoMat.uniforms.tSky.value = texture
    exrReady = true
    console.log("✅ EXR sky loaded")
  },
  undefined,
  (err) => console.error("❌ EXR failed:", err)
)

// =============================================================================
// Model loading
// =============================================================================

let droneObject  = null
let droneBasePos = new THREE.Vector3()
let droneBaseRot = new THREE.Euler()
let glbReady     = false

const bobCfg = { bobAmp: 0.04, bobPeriod: 5.0, stallPeriod: 3.0, stallDepth: 0.35, pitchAmp: 0.0075 }

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)

gltfLoader.load(
  MODEL_URL,
  (gltf) => {
    const object = gltf.scene
    object.position.set(0, 0, 0); object.rotation.set(0, 0, 0)

    const box = new THREE.Box3().setFromObject(object)
    const size = new THREE.Vector3(), center = new THREE.Vector3()
    box.getSize(size); box.getCenter(center)

    const maxDim = Math.max(size.x, size.y, size.z)
    if (isFinite(maxDim) && maxDim > 0) {
      const s = 1.4 / maxDim; object.scale.setScalar(s); object.position.sub(center.multiplyScalar(s))
    } else { object.scale.setScalar(1) }

    object.rotation.copy(MODEL_TUNING.rotation)
    if (MODEL_TUNING.extraScale !== 1.0) object.scale.multiplyScalar(MODEL_TUNING.extraScale)

    droneBasePos.copy(object.position)
    droneBaseRot.copy(object.rotation)
    object.updateMatrixWorld(true)

    const meshes = []
    object.traverse((child) => { if (child.isMesh) meshes.push(child) })

    for (const m of meshes) {
      if (m.geometry && !m.geometry.attributes.normal) m.geometry.computeVertexNormals()
      m.material = droneMats.carbonMatte; m.castShadow = true; m.receiveShadow = true
    }

    const wingMeshNames = new Set(["mesh73", "mesh100", "mesh76", "mesh103"])
    let namedAssigned = 0
    for (const m of meshes) { if (wingMeshNames.has(m.name)) { m.material = droneMats.solarPanel; namedAssigned++ } }
    if (namedAssigned === 0) {
      const scored = meshes.map((m) => {
        const bb = new THREE.Box3().setFromObject(m); const sz = new THREE.Vector3(), ct = new THREE.Vector3()
        bb.getSize(sz); bb.getCenter(ct)
        return { m, score: sz.x * sz.z * (1 / (sz.y / Math.max(sz.x, sz.z, 1e-6) + 0.02)) * (0.6 + Math.abs(ct.x)) }
      }).sort((a, b) => b.score - a.score)
      for (let i = 0; i < Math.min(4, scored.length); i++) scored[i].m.material = droneMats.solarPanel
    }

    scene.add(object)
    object.updateMatrixWorld(true)

    const tailMeshNames = new Set(["mesh159","mesh160","mesh161","mesh162","mesh163","mesh164","mesh165","mesh166","mesh167","mesh168","mesh169","mesh170","mesh171","mesh172","mesh173","mesh174","mesh175","mesh176","mesh177","mesh178","mesh179","mesh180","mesh181","mesh182","mesh183","mesh184"])
    for (const m of meshes) { if (tailMeshNames.has(m.name)) m.material = droneMats.tailMatte }

    for (const m of meshes) {
      let density = CF_DENSITY.matte
      if (m.material === droneMats.solarPanel)   density = SOLAR_DENSITY
      if (m.material === droneMats.carbonGlossy) density = CF_DENSITY.glossy
      generateWorldScaleUVs(m, density)
    }

    droneObject = object

    const revealBox = new THREE.Box3().setFromObject(object)
    const maxR = Math.max(Math.abs(revealBox.min.x), Math.abs(revealBox.max.x), Math.abs(revealBox.min.z), Math.abs(revealBox.max.z))
    reveal.maxRadius = maxR > 0 ? maxR * 1.05 : 10
    for (const mat of Object.values(droneMats)) injectRevealShader(mat, reveal.solidUniforms)
    createWireframeClones(meshes, reveal.wireUniforms)
    reveal.solidUniforms.revealRadius.value = 0
    reveal.wireUniforms.revealRadius.value  = 0
    reveal.startTime = clock.elapsedTime
    reveal.active = true
    glbReady = true

    console.log("✅ GLB loaded")

    // ---- Camera poses ----
    const dronePoses = [
      { cam: new THREE.Vector3(-2.822,  1.964, -2.34),  tgt: new THREE.Vector3(0,   0.3,  0) },
      { cam: new THREE.Vector3(-4.641,  3.509,  0),     tgt: new THREE.Vector3(0,   0.3,  0) },
      { cam: new THREE.Vector3(-5.613, 11.412,  0),     tgt: new THREE.Vector3(0,   0.3,  0) },
    ]
    const bgPoses = [
      { cam: new THREE.Vector3(-23.705, 16.498, -19.656), tgt: new THREE.Vector3(0.6, 0.98, 0) },
      { cam: new THREE.Vector3(-38.986, 29.477,   0),     tgt: new THREE.Vector3(0.6, 0.98, 0) },
      { cam: new THREE.Vector3(-29.263, 37.163,   0.053), tgt: new THREE.Vector3(0.6, 0.98, 0) },
    ]

    function buildPoseApplier(poses, cam, tgt) {
      return (t) => {
        const c = Math.max(0, Math.min(1, t)), seg = poses.length - 1
        const sc = c * seg, i = Math.min(Math.floor(sc), seg - 1), f = sc - i
        const p = poses[i].cam.clone().lerp(poses[i+1].cam, f)
        const q = poses[i].tgt.clone().lerp(poses[i+1].tgt, f)
        cam.position.set(p.x, p.y, p.z); tgt.set(q.x, q.y, q.z); cam.lookAt(tgt)
      }
    }

    window.__applyDronePose = buildPoseApplier(dronePoses, droneCamera, droneCamTarget)
    window.__applyBgPose    = buildPoseApplier(bgPoses,    bgCamera,    bgCamTarget)
    window.__applyDronePose(0)
    window.__applyBgPose(0)
  },
  undefined,
  (err) => console.error("❌ GLB failed:", err)
)

// =============================================================================
// Scroll — shared progress from #scenes-track
// =============================================================================

let scrollT = 0, droneSmooth = 0, bgSmooth = 0

function getScrollProgress() {
  const track = document.getElementById("scenes-track")
  if (!track) return 0
  const scrollable = track.offsetHeight - window.innerHeight
  return scrollable > 0 ? Math.max(0, Math.min(1, -track.getBoundingClientRect().top / scrollable)) : 0
}

window.addEventListener("scroll", () => { scrollT = getScrollProgress() }, { passive: true })
window.addEventListener("message", (e) => {
  if (e.data && typeof e.data.scrollProgress === "number") scrollT = e.data.scrollProgress
  if (e.data && e.data.sharpen) {
    const s = e.data.sharpen
    if (typeof s.strength === "number") window.sharpen.strength = s.strength
    if (typeof s.radius   === "number") window.sharpen.radius   = s.radius
    if (typeof s.enabled  === "boolean") window.sharpen.enabled = s.enabled
  }
})

// =============================================================================
// Resize
// =============================================================================

window.addEventListener("resize", () => {
  const dW = droneContainer.clientWidth, dH = droneContainer.clientHeight
  const bW = bgContainer.clientWidth,    bH = bgContainer.clientHeight
  droneCamera.aspect = dW / dH; droneCamera.updateProjectionMatrix()
  bgCamera.aspect    = bW / bH; bgCamera.updateProjectionMatrix()
  droneRenderer.setSize(dW, dH)
  bgRenderer.setSize(bW, bH)
  bgComposer.setSize(bW, bH)
  droneRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  bgRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  updateSharpenResolution()
})

// =============================================================================
// Dev helpers
// =============================================================================

window.addEventListener("keydown", (e) => {
  const step = Math.PI / 12
  if (scene.environmentRotation) {
    if (e.key === "ArrowLeft")  scene.environmentRotation.y -= step
    if (e.key === "ArrowRight") scene.environmentRotation.y += step
    if (e.key === "ArrowUp")    scene.environmentRotation.x -= step
    if (e.key === "ArrowDown")  scene.environmentRotation.x += step
  }
  // Sharpen controls: a/s = strength, d/f = radius, g = toggle
  if (e.key === "a") { window.sharpen.strength = Math.max(0, window.sharpen.strength - 0.1); console.log(`Sharpen strength: ${window.sharpen.strength.toFixed(2)}`) }
  if (e.key === "s") { window.sharpen.strength += 0.1; console.log(`Sharpen strength: ${window.sharpen.strength.toFixed(2)}`) }
  if (e.key === "d") { window.sharpen.radius = Math.max(0.5, window.sharpen.radius - 0.5); console.log(`Sharpen radius: ${window.sharpen.radius.toFixed(1)}`) }
  if (e.key === "f") { window.sharpen.radius += 0.5; console.log(`Sharpen radius: ${window.sharpen.radius.toFixed(1)}`) }
  if (e.key === "g") { window.sharpen.enabled = !window.sharpen.enabled; console.log(`Sharpen ${window.sharpen.enabled ? "ON" : "OFF"}`) }
  if (e.key === "p" || e.key === "P") { console.log("📸 Drone cam:", droneCamera.position); console.log("📸 BG cam:", bgCamera.position) }
  // bg exposure
  if (e.key === "z") { bgRenderer.toneMappingExposure = Math.max(0, bgRenderer.toneMappingExposure - 0.1); console.log(`BG exposure: ${bgRenderer.toneMappingExposure.toFixed(1)}`) }
  if (e.key === "x") { bgRenderer.toneMappingExposure += 0.1; console.log(`BG exposure: ${bgRenderer.toneMappingExposure.toFixed(1)}`) }
})

// =============================================================================
// Render loop
// =============================================================================

let lastTime = 0

function animate(now) {
  const dt     = Math.min((now - lastTime) / 1000, 0.05)
  lastTime     = now
  const nowSec = now / 1000
  const t      = clock.elapsedTime
  clock.getDelta()

  // --- Smooth scroll ---
  droneSmooth += (scrollT - droneSmooth) * 0.06
  bgSmooth    += (scrollT - bgSmooth)    * 0.06
  if (Math.abs(scrollT - droneSmooth) < 0.0001) droneSmooth = scrollT
  if (Math.abs(scrollT - bgSmooth)    < 0.0001) bgSmooth    = scrollT

  if (window.__applyDronePose) window.__applyDronePose(droneSmooth)
  if (window.__applyBgPose)    window.__applyBgPose(bgSmooth)

  // --- Drone bob ---
  if (droneObject) {
    const { bobAmp, bobPeriod, stallPeriod, stallDepth, pitchAmp } = bobCfg
    const bobFreq = (2 * Math.PI) / bobPeriod, stallFreq = (2 * Math.PI) / stallPeriod
    const stall = 1.0 - stallDepth * (Math.cos(t * stallFreq) ** 2)
    const dy    = Math.sin(t * bobFreq) * bobAmp * stall
    droneObject.position.set(droneBasePos.x, droneBasePos.y + dy, droneBasePos.z)
    droneObject.rotation.set(droneBaseRot.x + Math.cos(t * bobFreq) * stall * pitchAmp, droneBaseRot.y, droneBaseRot.z)
  }

  // --- Drone construction reveal ---
  if (reveal.active) {
    const elapsed    = t - reveal.startTime
    const wireLinear = Math.min(elapsed / reveal.wireframeDuration, 1)
    reveal.wireUniforms.revealRadius.value  = easeOutCubic(wireLinear) * reveal.maxRadius
    reveal.solidUniforms.revealRadius.value = 0
    if (wireLinear >= 1) {
      const fadeLinear = Math.min((elapsed - reveal.wireframeDuration) / reveal.fadeOutDuration, 1)
      const fade = easeOutCubic(fadeLinear)
      reveal.solidUniforms.revealRadius.value = fade * reveal.maxRadius * 1.05
      if (reveal.wireframeMat) reveal.wireframeMat.opacity = 0.6 * (1 - fade)
      if (fadeLinear >= 1) cleanupReveal()
    }
  }

  // --- Background intro phases ---
  // Waits for both EXR and GLB to be ready so the two reveals stay in sync
  if (bgAnim.phase === "waiting" && exrReady && glbReady) {
    bgAnim.phase = "gridReveal"
    bgAnim.phaseStart = nowSec
  }

  if (bgAnim.phase === "gridReveal") {
    const elapsed = nowSec - bgAnim.phaseStart
    const tPhase  = Math.min(elapsed / bgAnim.gridRevealDuration, 1)
    if (topoMat) topoMat.uniforms.uOpacity.value = easeInOutCubic(tPhase) * 0.45
    if (tPhase >= 1) { bgAnim.phase = "fadeIn"; bgAnim.phaseStart = nowSec }
  }

  if (bgAnim.phase === "fadeIn") {
    const elapsed = nowSec - bgAnim.phaseStart
    const tPhase  = Math.min(elapsed / bgAnim.fadeInDuration, 1)
    const eased   = easeOutCubic(tPhase)
    bgOpacity     = eased
    if (topoMat) topoMat.uniforms.uOpacity.value = 0.45 * (1 - eased)

    // Show EXR sky once bgOpacity passes threshold — ramp exposure up from 0.6
    const showThreshold = 0.3
    if (bgOpacity > showThreshold && exrTexture && !scene.background) scene.background = exrTexture
    if (scene.background && bgOpacity > showThreshold) {
      const remapped = (bgOpacity - showThreshold) / (1 - showThreshold)
      bgRenderer.toneMappingExposure = 0.6 + remapped * 1.4
    }

    // White clear color fades as EXR takes over
    const wb = 1 - bgOpacity
    bgRenderer.setClearColor(_clearColor.setRGB(wb, wb, wb), 1)

    if (tPhase >= 1) {
      bgAnim.phase = "done"
      if (exrTexture) scene.background = exrTexture
      bgOpacity = 1
      bgRenderer.toneMappingExposure = 2.0
      bgRenderer.setClearColor(0x000000, 1)
      disposeTopoGrid(scene)
      sharpenPass.enabled = true // activate sharpening now that intro is done
    }
  }

  // --- Scroll-driven effects on background (post-intro only) ---
  if (bgAnim.phase === "done") {
    const scrollPct  = Math.min(bgSmooth / 0.5, 1)
    const gray       = 0.60 + scrollPct * 0.20
    const contrast   = 1.0  - scrollPct * 0.10
    const brightness = 1.0  - scrollPct * 0.15
    bgRenderer.domElement.style.filter = `grayscale(${gray}) contrast(${contrast}) brightness(${brightness})`

    if (scene.environmentRotation) {
      const startY = 2070 * Math.PI / 180, endY = 2085 * Math.PI / 180
      scene.environmentRotation.y = startY + scrollPct * (endY - startY)
    }
  }

  // --- Clouds ---
  CloudSystem.update(t, droneCamera)

  // --- Render ---
  // Background: show EXR sky via scene.background, use composer (sharpen active post-intro)
  scene.background = bgAnim.phase === "done" ? exrTexture : (bgOpacity > 0.3 && exrTexture ? exrTexture : null)
  if (bgAnim.phase === "done") {
    bgComposer.render()
  } else {
    bgRenderer.render(scene, bgCamera)
  }

  // Drone: transparent background — only the model shows on top
  scene.background = null
  droneRenderer.render(scene, droneCamera)

  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)
