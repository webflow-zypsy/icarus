import * as THREE from "https://esm.sh/three@0.176.0"
import { GLTFLoader } from "https://esm.sh/three@0.176.0/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "https://esm.sh/three@0.176.0/examples/jsm/loaders/DRACOLoader.js"
import { EffectComposer } from "https://esm.sh/three@0.176.0/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "https://esm.sh/three@0.176.0/examples/jsm/postprocessing/RenderPass.js"
import { SSAOPass } from "https://esm.sh/three@0.176.0/examples/jsm/postprocessing/SSAOPass.js"
import { UnrealBloomPass } from "https://esm.sh/three@0.176.0/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "https://esm.sh/three@0.176.0/examples/jsm/postprocessing/OutputPass.js"

// ---------- CDN asset URL ----------
const MODEL_URL = "https://cdn.jsdelivr.net/gh/webflow-zypsy/icarus@main/topo-layers.glb"

// ---------- Config ----------
const GRID = 1
const TARGET_SIZE = 8
const params = {
  layerGap: 0.035,
  gapSpread: 2.0,
  color: "#e8e8e8",
  lightAngle: 170,
  lightElevation: 32,
  shadowStrength: 3.0,
  shadowSoftness: 15.0,
  ambientLevel: 3.5,
  fillIntensity: 0.4,
}

// ---------- Camera waypoints ----------
const waypoints = [
  { pos: new THREE.Vector3(0.336, 2.622, -0.318), target: new THREE.Vector3(-0.845, 0.500, 0.799) },
  { pos: new THREE.Vector3(4.262, 2.622, -4.028), target: new THREE.Vector3(3.081, 0.500, -2.911) },
]

// ---------- Scene ----------
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xffffff)

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 100)
camera.position.copy(waypoints[0].pos)
camera.lookAt(waypoints[0].target)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.5
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

// Mount to #strat-scene
let container = document.getElementById("strat-scene")
if (!container) {
  container = document.createElement("div")
  container.id = "strat-scene"
  document.body.appendChild(container)
}
container.innerHTML = ""
container.appendChild(renderer.domElement)

// ---------- Lighting ----------
scene.add(new THREE.AmbientLight(0xffffff, params.ambientLevel))
scene.add(new THREE.HemisphereLight(0xffffff, 0xf5f0eb, 0.6))

const EXT = 30
const dirLight = new THREE.DirectionalLight(0xffffff, params.shadowStrength)
dirLight.castShadow = true
dirLight.shadow.mapSize.set(4096, 4096)
dirLight.shadow.camera.near = 0.1
dirLight.shadow.camera.far = 60
dirLight.shadow.camera.left = -EXT
dirLight.shadow.camera.right = EXT
dirLight.shadow.camera.top = EXT
dirLight.shadow.camera.bottom = -EXT
dirLight.shadow.bias = -0.0002
dirLight.shadow.normalBias = 0.02
dirLight.shadow.radius = params.shadowSoftness
scene.add(dirLight)

const fillLight = new THREE.DirectionalLight(0xffffff, params.fillIntensity)
scene.add(fillLight)

;(function updateLighting() {
  const a = (params.lightAngle * Math.PI) / 180
  const e = (params.lightElevation * Math.PI) / 180
  const d = 12
  dirLight.position.set(Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d, Math.sin(a) * Math.cos(e) * d)
  fillLight.position.set(-Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d * 0.5, -Math.sin(a) * Math.cos(e) * d)
})()

// ---------- Material ----------
const material = new THREE.MeshStandardMaterial({
  color: params.color, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
})

// ---------- Mirror grid ----------
const MIRRORS = [{ sx: 1, sz: 1 }, { sx: -1, sz: 1 }, { sx: 1, sz: -1 }, { sx: -1, sz: -1 }]

function getGridPositions() {
  const half = Math.floor(GRID / 2)
  const buckets = [[], [], [], []]
  for (let gx = -half; gx <= half; gx++)
    for (let gz = -half; gz <= half; gz++) {
      const mx = (((gx % 2) + 2) % 2 === 1) ? -1 : 1
      const mz = (((gz % 2) + 2) % 2 === 1) ? -1 : 1
      buckets[(mx === -1 ? 1 : 0) + (mz === -1 ? 2 : 0)].push({ gx, gz })
    }
  return buckets
}

const GAP_START = 0.01

function getLayerY(num, total, gap) {
  const t = (total - num) / (total - 1)
  return Math.pow(t, params.gapSpread) * gap * (total - 1)
}

// ---------- GLB loader ----------
const layerGroup = new THREE.Group()
scene.add(layerGroup)

const draco = new DRACOLoader()
draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
const loader = new GLTFLoader()
loader.setDRACOLoader(draco)

loader.load(MODEL_URL, (gltf) => {
  const layerGeometries = new Map()
  gltf.scene.traverse((child) => {
    if (child.isMesh && child.name.startsWith("layer_"))
      layerGeometries.set(parseInt(child.name.replace("layer_", ""), 10), child.geometry)
  })
  draco.dispose()

  const totalLayers = layerGeometries.size
  const grid = getGridPositions()

  for (const [layerNum, baseGeo] of layerGeometries) {
    for (let vi = 0; vi < 4; vi++) {
      const pos = grid[vi]
      if (!pos.length) continue
      const { sx, sz } = MIRRORS[vi]
      const geo = baseGeo.clone()

      if (sx !== 1 || sz !== 1) {
        const p = geo.attributes.position.array
        const n = geo.attributes.normal.array
        for (let i = 0; i < p.length; i += 3) {
          if (sx === -1) { p[i] = -p[i]; n[i] = -n[i] }
          if (sz === -1) { p[i + 2] = -p[i + 2]; n[i + 2] = -n[i + 2] }
        }
        if (sx * sz < 0 && geo.index) {
          const idx = geo.index.array
          for (let i = 0; i < idx.length; i += 3) {
            const tmp = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = tmp
          }
        }
        geo.attributes.position.needsUpdate = true
        geo.attributes.normal.needsUpdate = true
        if (geo.index) geo.index.needsUpdate = true
      }

      const iMesh = new THREE.InstancedMesh(geo, material, pos.length)
      iMesh.castShadow = true
      iMesh.receiveShadow = true
      const y = getLayerY(layerNum, totalLayers, GAP_START)
      for (let i = 0; i < pos.length; i++) {
        const m = new THREE.Matrix4()
        m.makeTranslation(pos[i].gx * TARGET_SIZE, y, pos[i].gz * TARGET_SIZE)
        iMesh.setMatrixAt(i, m)
      }
      iMesh.instanceMatrix.needsUpdate = true
      layerGroup.add(iMesh)
    }
  }

  layerGroup.position.set(0, -getLayerY(1, totalLayers, GAP_START) / 2, 0)
})

// ---------- Post-processing ----------
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))

const ssaoPass = new SSAOPass(scene, camera, innerWidth, innerHeight)
ssaoPass.kernelRadius = 0.95
ssaoPass.minDistance = 0.001
ssaoPass.maxDistance = 0.01
ssaoPass.output = SSAOPass.OUTPUT.Default
composer.addPass(ssaoPass)

composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.01, 0.3, 0.92))
composer.addPass(new OutputPass())

// ---------- Resize ----------
window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  composer.setSize(innerWidth, innerHeight)
})

// ---------- GSAP ScrollTrigger — camera animation ----------
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

const _target = new THREE.Vector3()
const scrollProxy = { progress: 0 }

window.addEventListener("DOMContentLoaded", () => {
  const gsap = window.gsap
  const ScrollTrigger = window.ScrollTrigger
  if (!gsap || !ScrollTrigger) return

  gsap.registerPlugin(ScrollTrigger)

  gsap.to(scrollProxy, {
    progress: 1,
    ease: "none",
    scrollTrigger: {
      trigger: "[data-strat-track]",
      start: "top center",
      end: "bottom top",
      scrub: 1.25,
      invalidateOnRefresh: true,
    },
    onUpdate: () => {
      const t = easeInOutCubic(scrollProxy.progress * 0.75)
      camera.position.lerpVectors(waypoints[0].pos, waypoints[1].pos, t)
      _target.lerpVectors(waypoints[0].target, waypoints[1].target, t)
      camera.lookAt(_target)
    },
  })
})

// ---------- Animate ----------
function animate() {
  requestAnimationFrame(animate)
  composer.render()
}
animate()
