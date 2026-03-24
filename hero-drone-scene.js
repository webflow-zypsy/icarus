/**
 * hero-drone-scene.js  —  ES Module
 * Mounts a Three.js drone scene into #scene-drone.
 * Scroll driven by GSAP ScrollTrigger on #scenes-track.
 */

const DRONE_ASSETS = {
  hdr:   "https://webflow-zypsy.github.io/icarus/green-512.hdr",
  model: "https://webflow-zypsy.github.io/icarus/apollo-drone.glb",
}

import * as THREE     from "three"
import { RGBELoader } from "three/addons/loaders/RGBELoader.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js"
import { webglAvailable, activateFallback } from "./webgl-fallback.js"

if (!window.matchMedia("(min-width: 992px)").matches) {
  console.info("[drone-scene] Skipped — non-desktop viewport.")
} else {

window.addEventListener("load", () => {
  if (!window.matchMedia("(min-width: 992px)").matches) return
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
    console.error("[drone-scene] GSAP / ScrollTrigger not found."); return
  }
  gsap.registerPlugin(ScrollTrigger)

  if (!webglAvailable()) { activateFallback('scene-drone'); return }

  const mountEl = document.getElementById("scene-drone")
  if (!mountEl) { console.error("[drone-scene] #scene-drone not found."); return }

  const clock = new THREE.Clock()
  const scene  = new THREE.Scene()
  let droneObject  = null
  let droneBasePos = new THREE.Vector3()
  let droneBaseRot = new THREE.Euler()

  const bobCfg = {
    bobAmp:      0.003,
    bobPeriod:   5.0,
    stallPeriod: 3.0,
    stallDepth:  0.30,
    pitchAmp:    0.009,
  }

  // Construction reveal: phase 1 — wireframe expands from centre; phase 2 — solid fills in
  const reveal = {
    active: false, startTime: 0,
    wireframeDuration: 1.3,
    fadeOutDuration:   0.8,
    maxRadius: 1,
    wireframeClones: [], wireframeMat: null,
    solidUniforms: { revealRadius: { value: 0 } },
    wireUniforms:  { revealRadius: { value: 0 } },
  }
  const easeOut = t => 1 - Math.pow(1 - t, 3)

  // Injects a centre-outward clip into any material via shader hooks
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

  function createWireClones(meshes, uni) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff7700, wireframe: true, transparent: true, opacity: 0.6, depthWrite: false,
    })
    injectRevealShader(mat, uni)
    reveal.wireframeMat = mat
    for (const m of meshes) {
      const c = new THREE.Mesh(m.geometry, mat)
      c.position.copy(m.position); c.rotation.copy(m.rotation); c.scale.copy(m.scale)
      c.renderOrder = -1
      ;(m.parent || m).add(c)
      reveal.wireframeClones.push(c)
    }
  }

  function cleanupReveal() {
    for (const c of reveal.wireframeClones) c.parent?.remove(c)
    reveal.wireframeClones.length = 0
    if (reveal.wireframeMat) { reveal.wireframeMat.dispose(); reveal.wireframeMat = null }
    if (droneMats) {
      for (const m of [droneMats.solarPanel, droneMats.carbonMatte, droneMats.tailMatte]) {
        m.onBeforeCompile = () => {}; m.customProgramCacheKey = () => ""; m.needsUpdate = true
      }
    }
    reveal.active = false
  }

  // World-space box projection UVs — uniform texture density across all meshes
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
      if      (ax >= ay && ax >= az) { u = _v.y; v = _v.z }
      else if (ay >= ax && ay >= az) { u = _v.x; v = _v.z }
      else                           { u = _v.x; v = _v.y }
      uvs[i * 2] = u * texelsPerUnit; uvs[i * 2 + 1] = v * texelsPerUnit
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2))
    g.attributes.uv.needsUpdate = true
  }

  function mkTex(canvas, colorSpace) {
    const t = new THREE.CanvasTexture(canvas)
    t.colorSpace = colorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.anisotropy = 4  // reduced from 16 — visually equivalent for these textures
    return t
  }

  function makeCarbonFiberTextures(opts = {}) {
    const sz = 512, tc = opts.towCount || 32, tp = sz / tc, gap = opts.gap || 1
    const mk = () => { const c = document.createElement("canvas"); c.width = c.height = sz; return { c, ctx: c.getContext("2d") } }

    const { c: aC, ctx: a } = mk()
    a.fillStyle = "#1a1a1e"; a.fillRect(0, 0, sz, sz)
    for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
      const x = col * tp, y = row * tp
      const isWarpOver = ((col + row) % 4) < 2
      const base = isWarpOver ? 120 + Math.random() * 20 : 85 + Math.random() * 20
      a.fillStyle = isWarpOver ? `rgb(${base},${base},${base+3})` : `rgb(${base+2},${base},${base})`
      a.fillRect(x + gap, y + gap, tp - gap * 2, tp - gap * 2)
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

    const { c: rC, ctx: r } = mk()
    const baseRough = 90
    r.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`; r.fillRect(0, 0, sz, sz)
    for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
      const x = col * tp, y = row * tp
      const isWarpOver = ((col + row) % 4) < 2
      const v = isWarpOver ? baseRough - 6 + Math.random() * 4 : baseRough + 2 + Math.random() * 6
      r.fillStyle = `rgb(${v},${v},${v})`; r.fillRect(x + gap, y + gap, tp - gap * 2, tp - gap * 2)
      const gv = baseRough + 30
      r.fillStyle = `rgb(${gv},${gv},${gv})`
      r.fillRect(x, y, tp, gap); r.fillRect(x, y, gap, tp)
    }

    const { c: nC, ctx: n } = mk()
    n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, sz, sz)
    for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
      const x = col * tp, y = row * tp
      const isWarpOver = ((col + row) % 4) < 2
      if (isWarpOver) {
        const hw = (tp - gap * 2) / 2
        n.fillStyle = "rgba(110,128,255,0.45)"; n.fillRect(x + gap, y + gap, hw, tp - gap * 2)
        n.fillStyle = "rgba(146,128,255,0.45)"; n.fillRect(x + gap + hw, y + gap, hw, tp - gap * 2)
        n.fillStyle = "rgba(128,115,255,0.3)";  n.fillRect(x + gap, y + gap, tp - gap * 2, 2)
        n.fillStyle = "rgba(128,141,255,0.3)";  n.fillRect(x + gap, y + tp - gap - 2, tp - gap * 2, 2)
      } else {
        const hh = (tp - gap * 2) / 2
        n.fillStyle = "rgba(128,110,255,0.45)"; n.fillRect(x + gap, y + gap, tp - gap * 2, hh)
        n.fillStyle = "rgba(128,146,255,0.45)"; n.fillRect(x + gap, y + gap + hh, tp - gap * 2, hh)
        n.fillStyle = "rgba(115,128,255,0.3)";  n.fillRect(x + gap, y + gap, 2, tp - gap * 2)
        n.fillStyle = "rgba(141,128,255,0.3)";  n.fillRect(x + tp - gap - 2, y + gap, 2, tp - gap * 2)
      }
    }
    for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
      const x = col * tp, y = row * tp
      n.fillStyle = "rgba(128,108,240,0.5)"; n.fillRect(x, y, tp, gap + 1)
      n.fillStyle = "rgba(108,128,240,0.5)"; n.fillRect(x, y, gap + 1, tp)
    }

    return { albedo: mkTex(aC, THREE.SRGBColorSpace), rough: mkTex(rC, THREE.NoColorSpace), normal: mkTex(nC, THREE.NoColorSpace) }
  }

  function makeSolarPanelTextures(opts = {}) {
    const sz = 512, cc = opts.cellCols || 4, cr = opts.cellRows || 6
    const cg = opts.cellGap || 10, bbc = opts.busBarCount || 5, fs = opts.fingerSpacing || 4
    const cw = (sz - (cc + 1) * cg) / cc, ch = (sz - (cr + 1) * cg) / cr
    const cx = c => cg + c * (cw + cg), cy = r => cg + r * (ch + cg)
    const mk = () => { const c = document.createElement("canvas"); c.width = c.height = sz; return { c, ctx: c.getContext("2d") } }

    const { c: aC, ctx: a } = mk()
    a.fillStyle = "#474751"; a.fillRect(0, 0, sz, sz)
    for (let row = 0; row < cr; row++) for (let col = 0; col < cc; col++) {
      const x = cx(col), y = cy(row), rv = Math.random() * 4 - 2
      a.fillStyle = `rgb(${6+rv},${8+rv},${18+rv})`; a.fillRect(x, y, cw, ch)
      a.strokeStyle = "rgba(30,50,100,0.5)"; a.lineWidth = 2; a.strokeRect(x+1, y+1, cw-2, ch-2)
      const grad = a.createLinearGradient(x, y, x+cw, y+ch)
      grad.addColorStop(0, "rgba(40,50,90,0.08)"); grad.addColorStop(1, "rgba(20,25,50,0.08)")
      a.fillStyle = grad; a.fillRect(x, y, cw, ch)
      for (let b = 0; b < bbc; b++) {
        const barY = y + ch * (b+1) / (bbc+1)
        a.strokeStyle = "rgba(50,50,58,0.95)"; a.lineWidth = 1.5
        a.beginPath(); a.moveTo(x, barY); a.lineTo(x+cw, barY); a.stroke()
      }
      a.strokeStyle = "rgba(45,45,55,0.50)"; a.lineWidth = 0.5
      for (let fx = x+fs; fx < x+cw; fx += fs) { a.beginPath(); a.moveTo(fx, y); a.lineTo(fx, y+ch); a.stroke() }
      for (let b = 0; b < bbc; b++) {
        const barY = y + ch * (b+1) / (bbc+1)
        for (let fx = x+fs*3; fx < x+cw; fx += fs*4) {
          a.save(); a.translate(fx, barY); a.rotate(Math.PI/4)
          a.fillStyle = "rgba(55,55,65,0.7)"; a.fillRect(-1.5, -1.5, 3, 3); a.restore()
        }
      }
    }

    const { c: rC, ctx: r } = mk()
    r.fillStyle = "rgb(90,90,90)"; r.fillRect(0, 0, sz, sz)
    for (let row = 0; row < cr; row++) for (let col = 0; col < cc; col++) {
      const x = cx(col), y = cy(row), cv = 50 + Math.random() * 5
      r.fillStyle = `rgb(${cv},${cv},${cv})`; r.fillRect(x, y, cw, ch)
      r.strokeStyle = "rgb(60,60,60)"; r.lineWidth = 2; r.strokeRect(x+1, y+1, cw-2, ch-2)
      for (let b = 0; b < bbc; b++) {
        const barY = y + ch * (b+1) / (bbc+1)
        r.strokeStyle = "rgb(30,30,30)"; r.lineWidth = 1.5
        r.beginPath(); r.moveTo(x, barY); r.lineTo(x+cw, barY); r.stroke()
      }
    }

    const { c: nC, ctx: n } = mk()
    n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, sz, sz)
    for (let row = 0; row < cr; row++) for (let col = 0; col < cc; col++) {
      const x = cx(col), y = cy(row)
      n.fillStyle = "rgba(118,128,255,0.6)"; n.fillRect(x, y, 2, ch)
      n.fillStyle = "rgba(138,128,255,0.6)"; n.fillRect(x+cw-2, y, 2, ch)
      n.fillStyle = "rgba(128,118,255,0.6)"; n.fillRect(x, y, cw, 2)
      n.fillStyle = "rgba(128,138,255,0.6)"; n.fillRect(x, y+ch-2, cw, 2)
      for (let b = 0; b < bbc; b++) {
        const barY = y + ch * (b+1) / (bbc+1)
        n.fillStyle = "rgba(128,118,255,0.4)"; n.fillRect(x, barY-1, cw, 1)
        n.fillStyle = "rgba(128,138,255,0.4)"; n.fillRect(x, barY+1, cw, 1)
      }
    }
    for (let row = 0; row < cr; row++) for (let col = 0; col < cc; col++) {
      const x = cx(col), y = cy(row)
      n.fillStyle = "rgba(128,108,240,0.5)"; n.fillRect(x-cg, y-cg, cw+cg*2, cg)
      n.fillStyle = "rgba(108,128,240,0.5)"; n.fillRect(x-cg, y, cg, ch)
    }

    return { albedo: mkTex(aC, THREE.SRGBColorSpace), rough: mkTex(rC, THREE.NoColorSpace), normal: mkTex(nC, THREE.NoColorSpace) }
  }

  // droneMats is assigned asynchronously in the idle callback below
  let droneMats = null

  const CF_DENSITY    = 200.0
  const SOLAR_DENSITY =  48.0

  const initW = mountEl.clientWidth  || window.innerWidth
  const initH = mountEl.clientHeight || window.innerHeight
  const camera = new THREE.PerspectiveCamera(15, initW / initH, 0.1, 1000)
  const cameraTarget = new THREE.Vector3(0, 0.3, 0)

  let renderer
  try {
    // antialias: false — DPR 2 already provides sufficient AA on Retina screens
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
  } catch (e) {
    console.warn("[drone-scene] WebGLRenderer threw:", e.message)
    activateFallback('scene-drone'); return
  }
  renderer.setSize(initW, initH)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace    = THREE.SRGBColorSpace
  renderer.toneMapping         = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 3.2
  renderer.setClearColor(0x000000, 0)
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;"
  mountEl.appendChild(renderer.domElement)

  scene.add(new THREE.HemisphereLight(0x8eafc2, 0x584838, 0.8))

  // Start HDR and model loads immediately — they don't depend on materials
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  new RGBELoader().load(DRONE_ASSETS.hdr, tex => {
    tex.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = pmrem.fromEquirectangular(tex).texture
    scene.environmentRotation = new THREE.Euler(-840 * Math.PI / 180, 2070 * Math.PI / 180, 0)
    tex.dispose()
  })

  const draco = new DRACOLoader()
  draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
  const gltfLoader = new GLTFLoader()
  gltfLoader.setDRACOLoader(draco)

  // GLB callback — materials are guaranteed ready by this point (network >> idle callback)
  gltfLoader.load(DRONE_ASSETS.model, g => {
    if (!droneMats) { console.warn("[drone-scene] Materials not ready at GLB load time"); return }

    const obj = g.scene
    obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0)
    const box = new THREE.Box3().setFromObject(obj)
    const bsz = new THREE.Vector3(), bctr = new THREE.Vector3()
    box.getSize(bsz); box.getCenter(bctr)
    const md = Math.max(bsz.x, bsz.y, bsz.z)
    if (isFinite(md) && md > 0) {
      const s = 1.4 / md
      obj.scale.setScalar(s)
      obj.position.sub(bctr.multiplyScalar(s))
    }
    obj.rotation.set(-Math.PI / 2, 0, 0)
    droneBasePos.copy(obj.position)
    droneBaseRot.copy(obj.rotation)
    obj.updateMatrixWorld(true)

    const meshes = []
    obj.traverse(c => { if (c.isMesh) meshes.push(c) })

    for (const m of meshes) {
      if (m.geometry && !m.geometry.attributes.normal) m.geometry.computeVertexNormals()
      m.material = droneMats.carbonMatte
    }

    const wingNames = new Set(["mesh73", "mesh100", "mesh76", "mesh103"])
    let assigned = 0
    for (const m of meshes) { if (wingNames.has(m.name)) { m.material = droneMats.solarPanel; assigned++ } }
    if (assigned === 0) {
      const scored = meshes.map(m => {
        const b = new THREE.Box3().setFromObject(m), s = new THREE.Vector3(), ct = new THREE.Vector3()
        b.getSize(s); b.getCenter(ct)
        return { m, score: s.x * s.z * (1 / (s.y / Math.max(s.x, s.z, 1e-6) + 0.02)) * (0.6 + Math.abs(ct.x)) }
      }).sort((a, b) => b.score - a.score)
      for (let i = 0; i < Math.min(4, scored.length); i++) scored[i].m.material = droneMats.solarPanel
    }

    scene.add(obj); obj.updateMatrixWorld(true)
    for (const m of meshes) genUVs(m, m.material === droneMats.solarPanel ? SOLAR_DENSITY : CF_DENSITY)

    const tailNames = new Set([
      "mesh159","mesh160","mesh161","mesh162","mesh163","mesh164","mesh165","mesh166","mesh167",
      "mesh168","mesh169","mesh170","mesh171","mesh172","mesh173","mesh174","mesh175","mesh176",
      "mesh177","mesh178","mesh179","mesh180","mesh181","mesh182","mesh183","mesh184",
    ])
    for (const m of meshes) { if (tailNames.has(m.name)) m.material = droneMats.tailMatte }

    droneObject = obj

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

  // Defer heavy canvas texture generation to idle time — avoids blocking first paint
  const scheduleIdle = fn => typeof requestIdleCallback !== "undefined"
    ? requestIdleCallback(fn, { timeout: 2000 })
    : setTimeout(fn, 0)

  scheduleIdle(() => {
    const cf  = makeCarbonFiberTextures({ glossy: false, towCount: 24 })
    const sol = makeSolarPanelTextures()

    droneMats = {
      solarPanel: new THREE.MeshPhysicalMaterial({
        color: 0xffffff, map: sol.albedo, metalness: 0.01, roughness: 0.02,
        roughnessMap: sol.rough, clearcoat: 0.75, clearcoatRoughness: 0.05,
        normalMap: sol.normal, normalScale: new THREE.Vector2(2.4, 2.4),
        envMapIntensity: 0.5, side: THREE.DoubleSide,  // DoubleSide needed for thin wing planes
      }),
      carbonMatte: new THREE.MeshPhysicalMaterial({
        color: 0x6d6d6d, map: cf.albedo, metalness: 0.0, roughness: 0.92,
        roughnessMap: cf.rough, clearcoat: 0.0,
        normalMap: cf.normal, normalScale: new THREE.Vector2(0.2, 0.2),
        envMapIntensity: 0.25, side: THREE.FrontSide,  // solid body parts — FrontSide only
      }),
      tailMatte: new THREE.MeshPhysicalMaterial({
        color: 0xc9c9c9, map: cf.albedo, metalness: 0.0, roughness: 0.92,
        roughnessMap: cf.rough, clearcoat: 0.0,
        normalMap: cf.normal, normalScale: new THREE.Vector2(0.2, 0.2),
        envMapIntensity: 0.25, side: THREE.FrontSide,  // solid body parts — FrontSide only
      }),
    }
  })

  const poses = [
    { cam: new THREE.Vector3(-2.070, 1.200, -1.400), tgt: new THREE.Vector3( 0.115, -0.180,  0.332), fov: 14.0 },
    { cam: new THREE.Vector3(-3.520, 2.360, -0.030), tgt: new THREE.Vector3(-0.238,  0.002, -0.032), fov: 12.0 },
    { cam: new THREE.Vector3(-2.785, 3.265, -0.030), tgt: new THREE.Vector3(-0.238,  0.180, -0.032), fov: 10.5 },
  ]

  let scrollT = 0, smoothT = 0

  function applyPose(t) {
    const cl = Math.max(0, Math.min(1, t)), seg = poses.length - 1
    const sc = cl * seg, i = Math.min(Math.floor(sc), seg - 1), f = sc - i
    const p = poses[i].cam.clone().lerp(poses[i+1].cam, f)
    const q = poses[i].tgt.clone().lerp(poses[i+1].tgt, f)
    camera.position.set(p.x, p.y, p.z)
    cameraTarget.set(q.x, q.y, q.z)
    camera.lookAt(cameraTarget)
    // Guard: only update projection matrix when FOV meaningfully changes
    const newFov = (poses[i].fov ?? 15) + ((poses[i+1].fov ?? 15) - (poses[i].fov ?? 15)) * f
    if (Math.abs(newFov - camera.fov) > 0.001) {
      camera.fov = newFov
      camera.updateProjectionMatrix()
    }
  }
  applyPose(0)

  ScrollTrigger.create({
    trigger: "#scenes-track", start: "top top", end: "bottom bottom", scrub: 1,
    onUpdate: s => { scrollT = s.progress },
  })

  new ResizeObserver(() => {
    const w = mountEl.clientWidth || window.innerWidth, h = mountEl.clientHeight || window.innerHeight
    camera.aspect = w / h; camera.updateProjectionMatrix()
    renderer.setSize(w, h); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  }).observe(mountEl)

  let rafId = null, isVisible = true

  // Pause rendering when the scene is off-screen
  new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting
    if (!isVisible) {
      cancelAnimationFrame(rafId); rafId = null
    } else if (rafId === null) {
      rafId = requestAnimationFrame(animate)
    }
  }, { threshold: 0.01 }).observe(mountEl)

  // Pause when tab is hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId); rafId = null
    } else if (isVisible && rafId === null) {
      rafId = requestAnimationFrame(animate)
    }
  })

  // Throttle CSS filter updates — only write to DOM when the value changes
  let _lastFilter = ""

  function animate() {
    rafId = requestAnimationFrame(animate)
    const t = clock.elapsedTime

    smoothT += (scrollT - smoothT) * 0.06
    if (Math.abs(scrollT - smoothT) < 0.0001) smoothT = scrollT
    applyPose(smoothT)

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

    // Scroll-driven CSS filter — only update DOM when value changes
    const sp         = Math.min(smoothT / 0.5, 1)
    const gray       = 0.60 + sp * 0.20
    const contrast   = 1.0  - sp * 0.10
    const brightness = 1.0  - sp * 0.15
    const newFilter  = `grayscale(${gray.toFixed(3)}) contrast(${contrast.toFixed(3)}) brightness(${brightness.toFixed(3)})`
    if (newFilter !== _lastFilter) {
      renderer.domElement.style.filter = newFilter
      _lastFilter = newFilter
    }

    if (scene.environmentRotation) {
      const startY = 2070 * Math.PI / 180
      scene.environmentRotation.y = startY + sp * (15 * Math.PI / 180)
    }

    renderer.render(scene, camera)
  }

  rafId = requestAnimationFrame(animate)
})

}
