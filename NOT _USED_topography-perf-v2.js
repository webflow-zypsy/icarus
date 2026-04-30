import * as THREE from "https://esm.sh/three@0.176.0"
import { GLTFLoader } from "https://esm.sh/three@0.176.0/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "https://esm.sh/three@0.176.0/examples/jsm/loaders/DRACOLoader.js"
import { EffectComposer } from "https://esm.sh/three@0.176.0/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "https://esm.sh/three@0.176.0/examples/jsm/postprocessing/RenderPass.js"
import { SSAOPass } from "https://esm.sh/three@0.176.0/examples/jsm/postprocessing/SSAOPass.js"
import { UnrealBloomPass } from "https://esm.sh/three@0.176.0/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "https://esm.sh/three@0.176.0/examples/jsm/postprocessing/OutputPass.js"
import { webglAvailable, activateFallback } from "./webgl-fallback.js"

;(function () {

  // ---------- WebGL guard ----------
  if (!webglAvailable()) { activateFallback("strat-scene"); return }

  // ---------- CDN asset URL ----------
  const MODEL_URL = "https://cdn.jsdelivr.net/gh/webflow-zypsy/icarus@main/topo-layers.glb"

  // ---------- Config ----------
  const GRID = 1
  const TARGET_SIZE = 8
  const params = {
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

  // ---------- Renderer ----------
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(innerWidth, innerHeight)
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.5
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.shadowMap.autoUpdate = false
  } catch (e) {
    activateFallback("strat-scene"); return
  }

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
  // With GRID=1, half=0, so only cell (0,0) exists → always bucket 0, mirror sx=1 sz=1.
  // We skip the bucket loop and handle a single tile directly.
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

    for (const [layerNum, geo] of layerGeometries) {
      const iMesh = new THREE.InstancedMesh(geo, material, 1)
      iMesh.castShadow = true
      iMesh.receiveShadow = true
      const y = getLayerY(layerNum, totalLayers, GAP_START)
      const m = new THREE.Matrix4()
      m.makeTranslation(0, y, 0)
      iMesh.setMatrixAt(0, m)
      iMesh.instanceMatrix.needsUpdate = true
      layerGroup.add(iMesh)
    }

    layerGroup.position.set(0, -getLayerY(1, totalLayers, GAP_START) / 2, 0)

    // Compute shadow map once — geometry and light are static, only camera moves
    renderer.shadowMap.needsUpdate = true
    // Re-warm with geometry loaded: compiles MeshStandardMaterial + shadow shaders
    _preWarmed = false
    preWarmScene()
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

  // ---------- Pre-warm ----------
  let _preWarmed = false
  function preWarmScene() {
    if (_preWarmed) return
    _preWarmed = true
    composer.render()
  }
  // Pre-warm #1: compile post-processing pipeline off-screen (model not yet loaded)
  preWarmScene()

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

  // ---------- Visibility guard — pause RAF when off-screen ----------
  let isVisible = false
  let rafId = null

  function startLoop() {
    if (rafId !== null) return
    preWarmScene() // no-op after first call; last-chance fallback
    rafId = requestAnimationFrame(loop)
  }

  function stopLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function loop() {
    rafId = null
    if (!isVisible) return
    composer.render()
    rafId = requestAnimationFrame(loop)
  }

  const observer = new IntersectionObserver(
    (entries) => {
      isVisible = entries[0].isIntersecting
      isVisible ? startLoop() : stopLoop()
    },
    { threshold: 0 }
  )
  observer.observe(container)

  // When the page preloader exits, start the RAF immediately so the GPU is
  // already rendering frames before the user scrolls to this section.
  // IntersectionObserver still pauses the loop when the section leaves the viewport.
  document.querySelector(".hero-animation-trigger")?.addEventListener("click", () => {
    isVisible = true
    _preWarmed = false
    preWarmScene()
    startLoop()
  }, { once: true })

})()
