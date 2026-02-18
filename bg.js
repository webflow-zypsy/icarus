// Background scene — Three.js
import * as THREE from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js"
import { RGBELoader } from "three/addons/loaders/RGBELoader.js"

const clock = new THREE.Clock()
const scene = new THREE.Scene()

let droneObject = null
let droneBasePos = new THREE.Vector3(0, 0, 0)
let droneBaseRot = new THREE.Euler(0, 0, 0)

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
  for (const c of reveal.wireframeClones) c.parent?.remove(c)
  reveal.wireframeClones.length = 0

  if (reveal.wireframeMat) {
    reveal.wireframeMat.dispose()
    reveal.wireframeMat = null
  }

  for (const mat of [droneMats.solarPanel, droneMats.carbonMatte, droneMats.tailMatte]) {
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
    if (ax >= ay && ax >= az)      { u = _v.y; v = _v.z }
    else if (ay >= ax && ay >= az) { u = _v.x; v = _v.z }
    else                           { u = _v.x; v = _v.y }

    uvs[i * 2 + 0] = u * texelsPerUnit
    uvs[i * 2 + 1] = v * texelsPerUnit
  }

  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2))
  geo.attributes.uv.needsUpdate = true
}

const makeCarbonFiberTextures = (opts = {}) => {
  const size = 512
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

  const { c: roughC, ctx: r } = makeCanvas()
  const baseRough = isGlossy ? 90 : 90
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
    c.width = size; c.height = size
    return { c, ctx: c.getContext("2d") }
  }

  const cellX = (col) => cellGap + col * (cellW + cellGap)
  const cellY = (row) => cellGap + row * (cellH + cellGap)

  const { c: albedoC, ctx: a } = makeCanvas()
  a.fillStyle = "#474751"
  a.fillRect(0, 0, size, size)

  for (let row = 0; row < cellRows; row++) {
    for (let col = 0; col < cellCols; col++) {
      const x = cellX(col), y = cellY(row)
      const rv = Math.random() * 4 - 2
      a.fillStyle = `rgb(${6 + rv}, ${8 + rv}, ${18 + rv})`
      a.fillRect(x, y, cellW, cellH)

      a.strokeStyle = "rgba(30, 50, 100, 0.5)"
      a.lineWidth = 2
      a.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)

      const grad = a.createLinearGradient(x, y, x + cellW, y + cellH)
      grad.addColorStop(0, "rgba(40, 50, 90, 0.08)")
      grad.addColorStop(1, "rgba(20, 25, 50, 0.08)")
      a.fillStyle = grad
      a.fillRect(x, y, cellW, cellH)

      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        a.strokeStyle = "rgba(50, 50, 58, 0.95)"
        a.lineWidth = 1.5
        a.beginPath(); a.moveTo(x, barY); a.lineTo(x + cellW, barY); a.stroke()
      }

      a.strokeStyle = "rgba(45, 45, 55, 0.50)"
      a.lineWidth = 0.5
      for (let fx = x + fingerSpacing; fx < x + cellW; fx += fingerSpacing) {
        a.beginPath(); a.moveTo(fx, y); a.lineTo(fx, y + cellH); a.stroke()
      }

      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        for (let fx = x + fingerSpacing * 3; fx < x + cellW; fx += fingerSpacing * 4) {
          a.save(); a.translate(fx, barY); a.rotate(Math.PI / 4)
          a.fillStyle = "rgba(55, 55, 65, 0.7)"; a.fillRect(-1.5, -1.5, 3, 3)
          a.restore()
        }
      }
    }
  }

  const { c: roughC, ctx: r } = makeCanvas()
  r.fillStyle = "rgb(90, 90, 90)"
  r.fillRect(0, 0, size, size)

  for (let row = 0; row < cellRows; row++) {
    for (let col = 0; col < cellCols; col++) {
      const x = cellX(col), y = cellY(row)
      const cv = 50 + Math.random() * 5
      r.fillStyle = `rgb(${cv}, ${cv}, ${cv})`
      r.fillRect(x, y, cellW, cellH)
      r.strokeStyle = "rgb(60, 60, 60)"; r.lineWidth = 2
      r.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)

      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        r.strokeStyle = "rgb(30, 30, 30)"; r.lineWidth = 1.5
        r.beginPath(); r.moveTo(x, barY); r.lineTo(x + cellW, barY); r.stroke()
      }
    }
  }

  const { c: normalC, ctx: n } = makeCanvas()
  n.fillStyle = "rgb(128, 128, 255)"
  n.fillRect(0, 0, size, size)

  for (let row = 0; row < cellRows; row++) {
    for (let col = 0; col < cellCols; col++) {
      const x = cellX(col), y = cellY(row)
      n.fillStyle = "rgba(118, 128, 255, 0.6)"; n.fillRect(x, y, 2, cellH)
      n.fillStyle = "rgba(138, 128, 255, 0.6)"; n.fillRect(x + cellW - 2, y, 2, cellH)
      n.fillStyle = "rgba(128, 118, 255, 0.6)"; n.fillRect(x, y, cellW, 2)
      n.fillStyle = "rgba(128, 138, 255, 0.6)"; n.fillRect(x, y + cellH - 2, cellW, 2)

      for (let b = 0; b < busBarCount; b++) {
        const barY = y + cellH * (b + 1) / (busBarCount + 1)
        n.fillStyle = "rgba(128, 118, 255, 0.4)"; n.fillRect(x, barY - 1, cellW, 1)
        n.fillStyle = "rgba(128, 138, 255, 0.4)"; n.fillRect(x, barY + 1, cellW, 1)
      }
    }
  }

  for (let row = 0; row < cellRows; row++) {
    for (let col = 0; col < cellCols; col++) {
      const x = cellX(col), y = cellY(row)
      n.fillStyle = "rgba(128, 108, 240, 0.5)"; n.fillRect(x - cellGap, y - cellGap, cellW + cellGap * 2, cellGap)
      n.fillStyle = "rgba(108, 128, 240, 0.5)"; n.fillRect(x - cellGap, y, cellGap, cellH)
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

const cfMatte  = makeCarbonFiberTextures({ glossy: false, towCount: 24, repeat: 3.0 })
const solarTex = makeSolarPanelTextures()

const droneMats = {
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
  carbonMatte: new THREE.MeshPhysicalMaterial({
    color: 0x6d6d6d,
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

const CF_DENSITY   = { glossy: 12.0, matte: 40.0 }
const SOLAR_DENSITY = 3.0

// =====================================================================
// Renderer — mounted into Webflow's #scene-background container
// =====================================================================

const container = document.getElementById("scene-background")

const camera = new THREE.PerspectiveCamera(15, container.clientWidth / container.clientHeight, 0.1, 1000)
camera.position.set(0, 1.2, 5.2)

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setSize(container.clientWidth, container.clientHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 3.2
renderer.setClearColor(0x000000, 0)

// Style the canvas to fill its container
renderer.domElement.style.width = "100%"
renderer.domElement.style.height = "100%"
renderer.domElement.style.display = "block"

container.appendChild(renderer.domElement)

const hemi = new THREE.HemisphereLight(0x8eafc2, 0x584838, 0.8)
scene.add(hemi)

const cameraTarget = new THREE.Vector3(0, 0.3, 0)

// =====================================================================
// Asset URLs — hardcoded to the hosted GitHub Pages paths
// =====================================================================
const SKY_URL   = "https://webflow-zypsy.github.io/icarus/bg-img.hdr"
const MODEL_URL = "https://webflow-zypsy.github.io/icarus/bg-drone.glb"

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
    scene.environmentRotation = new THREE.Euler(-840 * Math.PI / 180, 2070 * Math.PI / 180, 0)
    texture.dispose()
    console.log("✅ bg.js: HDR environment loaded")
  },
  undefined,
  (err) => console.error("❌ bg.js: HDR failed to load", err)
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
    } else {
      object.scale.setScalar(1)
    }

    object.rotation.copy(MODEL_TUNING.rotation)
    if (MODEL_TUNING.extraScale !== 1.0) object.scale.multiplyScalar(MODEL_TUNING.extraScale)

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
      if (wingMeshNames.has(m.name)) { m.material = droneMats.solarPanel; namedAssigned++ }
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
      for (let i = 0; i < Math.min(4, scored.length); i++) scored[i].m.material = droneMats.solarPanel
    }

    scene.add(object)
    object.updateMatrixWorld(true)

    for (const m of meshes) {
      let density = CF_DENSITY.matte
      if (m.material === droneMats.solarPanel) density = SOLAR_DENSITY
      generateWorldScaleUVs(m, density)
    }

    const tailMeshNames = new Set([
      "mesh159","mesh160","mesh161","mesh162","mesh163","mesh164",
      "mesh165","mesh166","mesh167","mesh168","mesh169","mesh170",
      "mesh171","mesh172","mesh173","mesh174","mesh175","mesh176",
      "mesh177","mesh178","mesh179","mesh180","mesh181","mesh182",
      "mesh183","mesh184",
    ])
    for (const m of meshes) {
      if (tailMeshNames.has(m.name)) m.material = droneMats.tailMatte
    }

    droneObject = object

    {
      const revealBox = new THREE.Box3().setFromObject(object)
      const maxR = Math.max(
        Math.abs(revealBox.min.x), Math.abs(revealBox.max.x),
        Math.abs(revealBox.min.z), Math.abs(revealBox.max.z)
      )
      reveal.maxRadius = maxR > 0 ? maxR * 1.05 : 10
      injectRevealShader(droneMats.solarPanel,  reveal.solidUniforms)
      injectRevealShader(droneMats.carbonMatte, reveal.solidUniforms)
      injectRevealShader(droneMats.tailMatte,   reveal.solidUniforms)
      createWireframeClones(meshes, reveal.wireUniforms)
      reveal.solidUniforms.revealRadius.value = 0
      reveal.wireUniforms.revealRadius.value = 0
      reveal.startTime = clock.elapsedTime
      reveal.active = true
    }

    console.log("✅ bg.js: GLB loaded")

    // ---- Scroll-driven camera poses ----
    const poses = [
      { cam: new THREE.Vector3(-23.705, 16.498, -19.656), tgt: new THREE.Vector3(0.6, 0.98, 0) },
      { cam: new THREE.Vector3(-38.986, 29.477, 0),       tgt: new THREE.Vector3(0.6, 0.98, 0) },
      { cam: new THREE.Vector3(-29.263, 37.163, 0.053),   tgt: new THREE.Vector3(0.6, 0.98, 0) },
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

    // NOTE: globals use __bg prefix to avoid colliding with drone.js's __drone globals
    window.__bgApplyPose = applyPose
    window.__bgScrollState = {
      getScrollT: () => scrollT,
      getSmoothT: () => smoothT,
      setSmoothT: (v) => { smoothT = v },
      setScrollT: (v) => { scrollT = v },
    }
  },
  undefined,
  (err) => console.error("❌ bg.js: GLB failed to load", err)
)

// =====================================================================
// Scroll — read progress from the Webflow #scenes-track element
// =====================================================================

function getBgScrollProgress() {
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
  if (window.__bgScrollState) {
    window.__bgScrollState.setScrollT(getBgScrollProgress())
  }
}, { passive: true })

// postMessage fallback (Framer / iframe embeds)
window.addEventListener("message", (e) => {
  if (e.data && typeof e.data.scrollProgress === "number" && window.__bgScrollState) {
    window.__bgScrollState.setScrollT(e.data.scrollProgress)
  }
})

// =====================================================================
// Dev: arrow keys to rotate env light, a/s for exposure
// =====================================================================

function logEnvState() {
  const rx = scene.environmentRotation ? (scene.environmentRotation.x * 180 / Math.PI).toFixed(1) : '0.0'
  const ry = scene.environmentRotation ? (scene.environmentRotation.y * 180 / Math.PI).toFixed(1) : '0.0'
  console.log(`--- BG ENV ---  rotX: ${rx}°  rotY: ${ry}°  exposure: ${renderer.toneMappingExposure.toFixed(1)}`)
}

window.addEventListener("keydown", (e) => {
  const step = Math.PI / 12
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

  if (window.__bgScrollState && window.__bgApplyPose) {
    const state = window.__bgScrollState
    const target = state.getScrollT()
    let smooth = state.getSmoothT()
    smooth += (target - smooth) * 0.06
    if (Math.abs(target - smooth) < 0.0001) smooth = target
    state.setSmoothT(smooth)
    window.__bgApplyPose(smooth)
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

  // Scroll-driven desaturation + tonal compression
  if (window.__bgScrollState) {
    const scrollPct = Math.min(window.__bgScrollState.getSmoothT() / 0.5, 1)
    const gray = 0.60 + scrollPct * 0.20
    const contrast = 1.0 - scrollPct * 0.1
    const brightness = 1.0 - scrollPct * 0.15
    renderer.domElement.style.filter = `grayscale(${gray}) contrast(${contrast}) brightness(${brightness})`

    if (scene.environmentRotation) {
      const startY = 2070 * Math.PI / 180
      const endY   = 2085 * Math.PI / 180
      scene.environmentRotation.y = startY + scrollPct * (endY - startY)
    }
  }

  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()
