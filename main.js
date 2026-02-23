/**
 * drone-scene.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Three.js drone scene for Webflow.
 * Mounts into:  #scene-drone
 * Scroll driven by GSAP ScrollTrigger, triggered on: #scenes-track
 *
 * ASSET URLS — update these to wherever your files live in Webflow
 * (publish them as hosted assets or paste a CDN / media URL):
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── ASSET CONFIGURATION ─────────────────────────────────────────────────────
const DRONE_ASSETS = {
  hdr:   "https://webflow-zypsy.github.io/icarus/green-512.hdr",
  model: "https://webflow-zypsy.github.io/icarus/apollo-draco.glb",
}
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  "use strict"

  // ── Bail if Three.js / GSAP aren't loaded yet ──────────────────────────────
  if (typeof THREE === "undefined") {
    console.error("[drone-scene] THREE is not defined. Load three.js before this script.")
    return
  }
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
    console.error("[drone-scene] GSAP / ScrollTrigger not found.")
    return
  }
  gsap.registerPlugin(ScrollTrigger)

  // ── Mount element ──────────────────────────────────────────────────────────
  const mountEl = document.getElementById("scene-drone")
  if (!mountEl) {
    console.error("[drone-scene] #scene-drone not found.")
    return
  }

  // ── Core Three.js objects ──────────────────────────────────────────────────
  const clock   = new THREE.Clock()
  const scene   = new THREE.Scene()

  let droneObject  = null
  let droneBasePos = new THREE.Vector3(0, 0, 0)
  let droneBaseRot = new THREE.Euler(0, 0, 0)

  // Drone hover-bob tuning
  const bobCfg = {
    bobAmp:    0.04,
    bobPeriod: 5.0,
    stallPeriod: 3.0,
    stallDepth:  0.35,
    pitchAmp:  0.0075,
  }

  // ── Construction reveal state ──────────────────────────────────────────────
  const reveal = {
    active:              false,
    startTime:           0,
    wireframeDuration:   1.3,
    fadeOutDuration:     0.8,
    maxRadius:           1,
    wireframeClones:     [],
    wireframeMat:        null,
    solidUniforms:       { revealRadius: { value: 0 } },
    wireUniforms:        { revealRadius: { value: 0 } },
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3) }

  function injectRevealShader(material, uniforms) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.revealRadius = uniforms.revealRadius
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vRevealWorldPos;")
        .replace("#include <fog_vertex>", "#include <fog_vertex>\nvRevealWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;")
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <clipping_planes_pars_fragment>",
          "#include <clipping_planes_pars_fragment>\nuniform float revealRadius;\nvarying vec3 vRevealWorldPos;"
        )
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          "vec4 diffuseColor = vec4( diffuse, opacity );\n{\n  float revDist = max(abs(vRevealWorldPos.x), abs(vRevealWorldPos.z));\n  if (revDist > revealRadius) discard;\n}\n"
        )
    }
    material.customProgramCacheKey = () => "reveal"
    material.needsUpdate = true
  }

  function createWireframeClones(meshes, uniforms) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xff7700, wireframe: true, transparent: true,
      opacity: 0.6, depthWrite: false,
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
    for (const mat of [droneMats.solarPanel, droneMats.carbonMatte, droneMats.tailMatte]) {
      mat.onBeforeCompile = () => {}
      mat.customProgramCacheKey = () => ""
      mat.needsUpdate = true
    }
    reveal.active = false
  }

  // ── UV generation (world-space box projection) ────────────────────────────
  function generateWorldScaleUVs(mesh, texelsPerUnit) {
    const geo  = mesh.geometry
    if (!geo) return
    const pos  = geo.attributes.position
    const norm = geo.attributes.normal
    if (!pos || !norm) return
    const uvs  = new Float32Array(pos.count * 2)
    mesh.updateMatrixWorld(true)
    const _v  = new THREE.Vector3()
    const _n  = new THREE.Vector3()
    const nm  = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      _v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld)
      _n.set(norm.getX(i), norm.getY(i), norm.getZ(i)).applyMatrix3(nm).normalize()
      const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z)
      let u, v
      if (ax >= ay && ax >= az)       { u = _v.y; v = _v.z }
      else if (ay >= ax && ay >= az)  { u = _v.x; v = _v.z }
      else                            { u = _v.x; v = _v.y }
      uvs[i * 2]     = u * texelsPerUnit
      uvs[i * 2 + 1] = v * texelsPerUnit
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2))
    geo.attributes.uv.needsUpdate = true
  }

  // ── Procedural carbon fiber textures ─────────────────────────────────────
  function makeCarbonFiberTextures(opts = {}) {
    const size     = 512
    const towCount = opts.towCount || 32
    const towPx    = size / towCount
    const gap      = opts.gap || 1
    const isGlossy = opts.glossy !== false
    const makeCanvas = () => {
      const c = document.createElement("canvas"); c.width = size; c.height = size
      return { c, ctx: c.getContext("2d") }
    }

    // Albedo
    const { c: aC, ctx: a } = makeCanvas()
    a.fillStyle = "#1a1a1e"; a.fillRect(0, 0, size, size)
    for (let row = 0; row < towCount; row++) {
      for (let col = 0; col < towCount; col++) {
        const x = col * towPx, y = row * towPx
        const over = ((col + row) % 4) < 2
        const base = over ? 120 + Math.random() * 20 : 85 + Math.random() * 20
        a.fillStyle = over ? `rgb(${base},${base},${base + 3})` : `rgb(${base + 2},${base},${base})`
        a.fillRect(x + gap, y + gap, towPx - gap * 2, towPx - gap * 2)
        const sc = 5
        for (let s = 0; s < sc; s++) {
          a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`
          a.lineWidth = 0.8; a.beginPath()
          if (over) {
            const sx = x + gap + ((towPx - gap * 2) * (s + 0.5)) / sc
            a.moveTo(sx, y + gap); a.lineTo(sx, y + towPx - gap)
          } else {
            const sy = y + gap + ((towPx - gap * 2) * (s + 0.5)) / sc
            a.moveTo(x + gap, sy); a.lineTo(x + towPx - gap, sy)
          }
          a.stroke()
        }
      }
    }

    // Roughness
    const { c: rC, ctx: r } = makeCanvas()
    const baseRough = 90
    r.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`; r.fillRect(0, 0, size, size)
    for (let row = 0; row < towCount; row++) {
      for (let col = 0; col < towCount; col++) {
        const x = col * towPx, y = row * towPx
        const over = ((col + row) % 4) < 2
        const v = over ? baseRough - 6 + Math.random() * 4 : baseRough + 2 + Math.random() * 6
        r.fillStyle = `rgb(${v},${v},${v})`; r.fillRect(x + gap, y + gap, towPx - gap * 2, towPx - gap * 2)
        const gv = baseRough + 30
        r.fillStyle = `rgb(${gv},${gv},${gv})`
        r.fillRect(x, y, towPx, gap); r.fillRect(x, y, gap, towPx)
      }
    }

    // Normal
    const { c: nC, ctx: n } = makeCanvas()
    n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, size, size)
    for (let row = 0; row < towCount; row++) {
      for (let col = 0; col < towCount; col++) {
        const x = col * towPx, y = row * towPx
        const over = ((col + row) % 4) < 2
        if (over) {
          const hw = (towPx - gap * 2) / 2
          n.fillStyle = "rgba(110,128,255,0.45)"; n.fillRect(x + gap, y + gap, hw, towPx - gap * 2)
          n.fillStyle = "rgba(146,128,255,0.45)"; n.fillRect(x + gap + hw, y + gap, hw, towPx - gap * 2)
        } else {
          const hh = (towPx - gap * 2) / 2
          n.fillStyle = "rgba(128,110,255,0.45)"; n.fillRect(x + gap, y + gap, towPx - gap * 2, hh)
          n.fillStyle = "rgba(128,146,255,0.45)"; n.fillRect(x + gap, y + gap + hh, towPx - gap * 2, hh)
        }
        n.fillStyle = "rgba(128,108,240,0.5)"; n.fillRect(x, y, towPx, gap + 1)
        n.fillStyle = "rgba(108,128,240,0.5)"; n.fillRect(x, y, gap + 1, towPx)
      }
    }

    const maxAniso = 16
    const mkTex = (canvas, colorSpace) => {
      const t = new THREE.CanvasTexture(canvas)
      t.colorSpace = colorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter; t.anisotropy = maxAniso
      return t
    }
    return {
      albedo: mkTex(aC, THREE.SRGBColorSpace),
      rough:  mkTex(rC, THREE.NoColorSpace),
      normal: mkTex(nC, THREE.NoColorSpace),
    }
  }

  // ── Procedural solar panel textures ──────────────────────────────────────
  function makeSolarPanelTextures(opts = {}) {
    const size         = 512
    const cellCols     = opts.cellCols     || 4
    const cellRows     = opts.cellRows     || 6
    const cellGap      = opts.cellGap      || 10
    const busBarCount  = opts.busBarCount  || 5
    const fingerSpacing = opts.fingerSpacing || 4
    const cellW = (size - (cellCols + 1) * cellGap) / cellCols
    const cellH = (size - (cellRows + 1) * cellGap) / cellRows
    const makeCanvas = () => {
      const c = document.createElement("canvas"); c.width = size; c.height = size
      return { c, ctx: c.getContext("2d") }
    }
    const cx = (col) => cellGap + col * (cellW + cellGap)
    const cy = (row) => cellGap + row * (cellH + cellGap)

    // Albedo
    const { c: aC, ctx: a } = makeCanvas()
    a.fillStyle = "#474751"; a.fillRect(0, 0, size, size)
    for (let row = 0; row < cellRows; row++) {
      for (let col = 0; col < cellCols; col++) {
        const x = cx(col), y = cy(row), rv = Math.random() * 4 - 2
        a.fillStyle = `rgb(${6 + rv},${8 + rv},${18 + rv})`; a.fillRect(x, y, cellW, cellH)
        a.strokeStyle = "rgba(30,50,100,0.5)"; a.lineWidth = 2; a.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)
        for (let b = 0; b < busBarCount; b++) {
          const barY = y + cellH * (b + 1) / (busBarCount + 1)
          a.strokeStyle = "rgba(50,50,58,0.95)"; a.lineWidth = 1.5
          a.beginPath(); a.moveTo(x, barY); a.lineTo(x + cellW, barY); a.stroke()
        }
        a.strokeStyle = "rgba(45,45,55,0.50)"; a.lineWidth = 0.5
        for (let fx = x + fingerSpacing; fx < x + cellW; fx += fingerSpacing) {
          a.beginPath(); a.moveTo(fx, y); a.lineTo(fx, y + cellH); a.stroke()
        }
      }
    }

    // Roughness
    const { c: rC, ctx: r } = makeCanvas()
    r.fillStyle = "rgb(90,90,90)"; r.fillRect(0, 0, size, size)
    for (let row = 0; row < cellRows; row++) {
      for (let col = 0; col < cellCols; col++) {
        const x = cx(col), y = cy(row), cv = 50 + Math.random() * 5
        r.fillStyle = `rgb(${cv},${cv},${cv})`; r.fillRect(x, y, cellW, cellH)
        for (let b = 0; b < busBarCount; b++) {
          const barY = y + cellH * (b + 1) / (busBarCount + 1)
          r.strokeStyle = "rgb(30,30,30)"; r.lineWidth = 1.5
          r.beginPath(); r.moveTo(x, barY); r.lineTo(x + cellW, barY); r.stroke()
        }
      }
    }

    // Normal
    const { c: nC, ctx: n } = makeCanvas()
    n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, size, size)
    for (let row = 0; row < cellRows; row++) {
      for (let col = 0; col < cellCols; col++) {
        const x = cx(col), y = cy(row)
        n.fillStyle = "rgba(118,128,255,0.6)"; n.fillRect(x, y, 2, cellH)
        n.fillStyle = "rgba(138,128,255,0.6)"; n.fillRect(x + cellW - 2, y, 2, cellH)
        n.fillStyle = "rgba(128,118,255,0.6)"; n.fillRect(x, y, cellW, 2)
        n.fillStyle = "rgba(128,138,255,0.6)"; n.fillRect(x, y + cellH - 2, cellW, 2)
        for (let b = 0; b < busBarCount; b++) {
          const barY = y + cellH * (b + 1) / (busBarCount + 1)
          n.fillStyle = "rgba(128,118,255,0.4)"; n.fillRect(x, barY - 1, cellW, 1)
          n.fillStyle = "rgba(128,138,255,0.4)"; n.fillRect(x, barY + 1, cellW, 1)
        }
      }
    }

    const maxAniso = 16
    const mkTex = (canvas, colorSpace) => {
      const t = new THREE.CanvasTexture(canvas)
      t.colorSpace = colorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter; t.anisotropy = maxAniso
      return t
    }
    return {
      albedo: mkTex(aC, THREE.SRGBColorSpace),
      rough:  mkTex(rC, THREE.NoColorSpace),
      normal: mkTex(nC, THREE.NoColorSpace),
    }
  }

  // ── Generate textures ─────────────────────────────────────────────────────
  const cfMatte  = makeCarbonFiberTextures({ glossy: false, towCount: 24 })
  const solarTex = makeSolarPanelTextures()

  // ── PBR Materials ─────────────────────────────────────────────────────────
  const droneMats = {
    solarPanel: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: solarTex.albedo, metalness: 0.08, roughness: 0.45,
      roughnessMap: solarTex.rough, clearcoat: 0.9, clearcoatRoughness: 0.05,
      normalMap: solarTex.normal, normalScale: new THREE.Vector2(0.4, 0.4),
      envMapIntensity: 0.5, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
    }),
    carbonMatte: new THREE.MeshPhysicalMaterial({
      color: 0x6d6d6d, map: cfMatte.albedo, metalness: 0.0, roughness: 0.92,
      roughnessMap: cfMatte.rough, clearcoat: 0.0,
      normalMap: cfMatte.normal, normalScale: new THREE.Vector2(0.2, 0.2),
      envMapIntensity: 0.25, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
    }),
    tailMatte: new THREE.MeshPhysicalMaterial({
      color: 0xc9c9c9, map: cfMatte.albedo, metalness: 0.0, roughness: 0.92,
      roughnessMap: cfMatte.rough, clearcoat: 0.0,
      normalMap: cfMatte.normal, normalScale: new THREE.Vector2(0.2, 0.2),
      envMapIntensity: 0.25, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide,
    }),
  }

  const CF_DENSITY   = { matte: 40.0 }
  const SOLAR_DENSITY = 3.0

  // ── Camera ────────────────────────────────────────────────────────────────
  const camera = new THREE.PerspectiveCamera(15, mountEl.clientWidth / mountEl.clientHeight, 0.1, 1000)
  camera.position.set(0, 1.2, 5.2)
  const cameraTarget = new THREE.Vector3(0, 0.3, 0)

  // ── Renderer → mount into #scene-drone ───────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setSize(mountEl.clientWidth, mountEl.clientHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping      = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 3.2
  renderer.setClearColor(0x000000, 0)
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;"
  mountEl.appendChild(renderer.domElement)

  // ── Lighting ──────────────────────────────────────────────────────────────
  const hemi = new THREE.HemisphereLight(0x8eafc2, 0x584838, 0.8)
  scene.add(hemi)

  // ── PMREM / HDR environment ───────────────────────────────────────────────
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()

  // RGBELoader — loaded from CDN (matches three.js version you use)
  const rgbeLoader = new THREE.RGBELoader
    ? new THREE.RGBELoader()
    : (() => { console.error("[drone-scene] RGBELoader not found on THREE namespace. Import it separately."); return null })()

  if (rgbeLoader) {
    rgbeLoader.load(DRONE_ASSETS.hdr, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping
      const envMap = pmrem.fromEquirectangular(texture).texture
      scene.environment = envMap
      scene.environmentRotation = new THREE.Euler(-840 * Math.PI / 180, 2070 * Math.PI / 180, 0)
      texture.dispose()
    })
  }

  // ── DRACO / GLB loader ────────────────────────────────────────────────────
  const dracoLoader = new THREE.DRACOLoader
    ? new THREE.DRACOLoader()
    : (() => { console.error("[drone-scene] DRACOLoader not found. Import it separately."); return null })()

  if (dracoLoader) dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")

  const gltfLoader = new THREE.GLTFLoader
    ? new THREE.GLTFLoader()
    : (() => { console.error("[drone-scene] GLTFLoader not found."); return null })()

  if (gltfLoader && dracoLoader) gltfLoader.setDRACOLoader(dracoLoader)

  // ── Scroll-driven camera poses ────────────────────────────────────────────
  const poses = [
    { cam: new THREE.Vector3(-23.705, 16.498, -19.656), tgt: new THREE.Vector3(0.6, 0.98, 0) },
    { cam: new THREE.Vector3(-38.986, 29.477,       0), tgt: new THREE.Vector3(0.6, 0.98, 0) },
    { cam: new THREE.Vector3(-29.263, 37.163,   0.053), tgt: new THREE.Vector3(0.6, 0.98, 0) },
  ]

  // scrollT is set by GSAP ScrollTrigger (0 → 1)
  let scrollT  = 0
  let smoothT  = 0

  function applyPose(t) {
    const clamped  = Math.max(0, Math.min(1, t))
    const segments = poses.length - 1
    const scaled   = clamped * segments
    const i        = Math.min(Math.floor(scaled), segments - 1)
    const frac     = scaled - i
    const p = poses[i].cam.clone().lerp(poses[i + 1].cam, frac)
    const q = poses[i].tgt.clone().lerp(poses[i + 1].tgt, frac)
    camera.position.set(p.x, p.y, p.z)
    cameraTarget.set(q.x, q.y, q.z)
    camera.lookAt(cameraTarget)
  }

  applyPose(0)

  // ── GSAP ScrollTrigger — drives scrollT (0 → 1) ──────────────────────────
  ScrollTrigger.create({
    trigger:  "#scenes-track",
    start:    "top top",
    end:      "bottom bottom",
    scrub:    true,
    onUpdate: (self) => { scrollT = self.progress },
  })

  // ── Model load ────────────────────────────────────────────────────────────
  const MODEL_TUNING = {
    extraScale: 16.0,
    rotation:   new THREE.Euler(-Math.PI / 2, 0, 0),
  }

  if (gltfLoader) {
    gltfLoader.load(DRONE_ASSETS.model, (gltf) => {
      const object = gltf.scene
      object.position.set(0, 0, 0)
      object.rotation.set(0, 0, 0)

      const box    = new THREE.Box3().setFromObject(object)
      const size   = new THREE.Vector3()
      const center = new THREE.Vector3()
      box.getSize(size)
      box.getCenter(center)
      const maxDim = Math.max(size.x, size.y, size.z)
      if (isFinite(maxDim) && maxDim > 0) {
        const s = 1.4 / maxDim
        object.scale.setScalar(s)
        object.position.sub(center.multiplyScalar(s))
      }

      object.rotation.copy(MODEL_TUNING.rotation)
      object.scale.multiplyScalar(MODEL_TUNING.extraScale)

      droneBasePos.copy(object.position)
      droneBaseRot.copy(object.rotation)
      object.updateMatrixWorld(true)

      const meshes = []
      object.traverse((child) => { if (child.isMesh) meshes.push(child) })

      for (const m of meshes) {
        if (m.geometry && !m.geometry.attributes.normal) m.geometry.computeVertexNormals()
        m.material = droneMats.carbonMatte
        m.castShadow = true; m.receiveShadow = true
      }

      const wingNames = new Set(["mesh73", "mesh100", "mesh76", "mesh103"])
      let namedAssigned = 0
      for (const m of meshes) {
        if (wingNames.has(m.name)) { m.material = droneMats.solarPanel; namedAssigned++ }
      }

      if (namedAssigned === 0) {
        const scored = meshes.map((m) => {
          const bb = new THREE.Box3().setFromObject(m)
          const sz = new THREE.Vector3(); const ct = new THREE.Vector3()
          bb.getSize(sz); bb.getCenter(ct)
          const flatness = sz.y / Math.max(sz.x, sz.z, 1e-6)
          const score    = sz.x * sz.z * (1 / (flatness + 0.02)) * (0.6 + Math.abs(ct.x))
          return { m, score }
        }).sort((a, b) => b.score - a.score)
        for (let i = 0; i < Math.min(4, scored.length); i++) scored[i].m.material = droneMats.solarPanel
      }

      scene.add(object)
      object.updateMatrixWorld(true)

      for (const m of meshes) {
        const density = m.material === droneMats.solarPanel ? SOLAR_DENSITY : CF_DENSITY.matte
        generateWorldScaleUVs(m, density)
      }

      const tailNames = new Set([
        "mesh159","mesh160","mesh161","mesh162","mesh163","mesh164","mesh165","mesh166","mesh167",
        "mesh168","mesh169","mesh170","mesh171","mesh172","mesh173","mesh174","mesh175","mesh176",
        "mesh177","mesh178","mesh179","mesh180","mesh181","mesh182","mesh183","mesh184",
      ])
      for (const m of meshes) { if (tailNames.has(m.name)) m.material = droneMats.tailMatte }

      droneObject = object

      // ── Construction reveal ────────────────────────────────────────────
      const rb = new THREE.Box3().setFromObject(object)
      const maxR = Math.max(
        Math.abs(rb.min.x), Math.abs(rb.max.x),
        Math.abs(rb.min.z), Math.abs(rb.max.z)
      )
      reveal.maxRadius = maxR > 0 ? maxR * 1.05 : 10
      injectRevealShader(droneMats.solarPanel,  reveal.solidUniforms)
      injectRevealShader(droneMats.carbonMatte, reveal.solidUniforms)
      injectRevealShader(droneMats.tailMatte,   reveal.solidUniforms)
      createWireframeClones(meshes, reveal.wireUniforms)
      reveal.solidUniforms.revealRadius.value = 0
      reveal.wireUniforms.revealRadius.value  = 0
      reveal.startTime = clock.elapsedTime
      reveal.active    = true
    })
  }

  // ── Resize ────────────────────────────────────────────────────────────────
  const resizeObserver = new ResizeObserver(() => {
    const w = mountEl.clientWidth, h = mountEl.clientHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  })
  resizeObserver.observe(mountEl)

  // ── Render loop ───────────────────────────────────────────────────────────
  function animate() {
    requestAnimationFrame(animate)
    clock.getDelta()
    const t = clock.elapsedTime

    // Smooth scroll interpolation
    smoothT += (scrollT - smoothT) * 0.06
    if (Math.abs(scrollT - smoothT) < 0.0001) smoothT = scrollT
    applyPose(smoothT)

    // Drone bob
    if (droneObject) {
      const s = bobCfg
      const bob   = Math.sin(t * (2 * Math.PI) / s.bobPeriod)
      const stall = 1.0 - s.stallDepth * Math.pow(Math.cos(t * (2 * Math.PI) / s.stallPeriod), 2)
      const dy    = bob * s.bobAmp * stall
      droneObject.position.set(droneBasePos.x, droneBasePos.y + dy, droneBasePos.z)
      droneObject.rotation.set(
        droneBaseRot.x + Math.cos(t * (2 * Math.PI) / s.bobPeriod) * stall * s.pitchAmp,
        droneBaseRot.y, droneBaseRot.z
      )
    }

    // Construction reveal
    if (reveal.active) {
      const elapsed     = t - reveal.startTime
      const wireLinear  = Math.min(elapsed / reveal.wireframeDuration, 1)
      reveal.wireUniforms.revealRadius.value  = easeOutCubic(wireLinear) * reveal.maxRadius
      reveal.solidUniforms.revealRadius.value = 0
      if (wireLinear >= 1) {
        const fl = Math.min((elapsed - reveal.wireframeDuration) / reveal.fadeOutDuration, 1)
        reveal.solidUniforms.revealRadius.value = easeOutCubic(fl) * reveal.maxRadius * 1.05
        if (reveal.wireframeMat) reveal.wireframeMat.opacity = 0.6 * (1 - easeOutCubic(fl))
        if (fl >= 1) cleanupReveal()
      }
    }

    // Scroll-driven CSS filter (desaturation + dim as user scrolls)
    const scrollPct = Math.min(smoothT / 0.5, 1)
    const gray       = 0.60 + scrollPct * 0.20
    const contrast   = 1.0  - scrollPct * 0.1
    const brightness = 1.0  - scrollPct * 0.15
    renderer.domElement.style.filter = `grayscale(${gray}) contrast(${contrast}) brightness(${brightness})`

    // Scroll-driven env rotation
    if (scene.environmentRotation) {
      const startY = 2070 * Math.PI / 180
      const endY   = 2085 * Math.PI / 180
      scene.environmentRotation.y = startY + scrollPct * (endY - startY)
    }

    renderer.render(scene, camera)
  }
  animate()

})()
