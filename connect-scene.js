/**
 * connect-scene.js  —  ES Module
 * Connect section drone scene (#connect-drone, #connect-track).
 * Two-pass render: sky sphere (day/night crossfade) + drone + clouds.
 */

const ASSETS = {
  hdr:    "https://webflow-zypsy.github.io/icarus/green-512.hdr",
  model:  "https://webflow-zypsy.github.io/icarus/apollo-drone.glb",
  bg:     "https://webflow-zypsy.github.io/icarus/connect-background-image.webp",
  bg2:    "https://webflow-zypsy.github.io/icarus/connect-background-image-2.webp",
  cloud1: "https://webflow-zypsy.github.io/icarus/connect-cloud-image-1.webp",
  cloud2: "https://webflow-zypsy.github.io/icarus/connect-cloud-image-2.webp",
}

import * as THREE     from "three"
import { RGBELoader } from "three/addons/loaders/RGBELoader.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js"
import { webglAvailable, activateFallback } from "./webgl-fallback.js"

if (!window.matchMedia("(min-width: 992px)").matches) {
  console.info("[connect-scene] Skipped — non-desktop viewport.")
} else {

window.addEventListener("load", () => {
  if (!window.matchMedia("(min-width: 992px)").matches) return
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
    console.error("[connect-scene] GSAP / ScrollTrigger not found."); return
  }
  gsap.registerPlugin(ScrollTrigger)

  const trackEl = document.getElementById("connect-track")
  if (!trackEl) { console.error("[connect-scene] #connect-track not found."); return }

  // Lazy init — boot only when the connect section is approaching the viewport
  const lazyObserver = new IntersectionObserver(
    entries => { if (entries[0].isIntersecting) { lazyObserver.disconnect(); initConnectScene() } },
    { rootMargin: "0px 0px 30% 0px", threshold: 0 }
  )
  lazyObserver.observe(trackEl)

  function initConnectScene() {
    if (!webglAvailable()) { activateFallback('connect-drone'); return }

    const mountEl = document.getElementById("connect-drone")
    if (!mountEl) { console.error("[connect-scene] #connect-drone not found."); return }

    const initW = mountEl.clientWidth  || window.innerWidth
    const initH = mountEl.clientHeight || window.innerHeight
    const clock = new THREE.Clock()

    // ── Sky (background pass) — two spheres, crossfade day → night ──────────
    const skyScene = new THREE.Scene()
    const DOME_H_FOV = 42.0 * Math.PI / 180.0

    function makeSkyMat(opacity) {
      return new THREE.ShaderMaterial({
        uniforms: {
          tImage:       { value: null },
          uOpacity:     { value: opacity },
          uCenterDir:   { value: new THREE.Vector3(-0.621, -0.343, -0.705) },
          uHFov:        { value: DOME_H_FOV },
          uImageAspect: { value: 16.0 / 9.0 },
          uHOffset:     { value: 0.0 },
          uVOffset:     { value: 0.0 },
        },
        vertexShader: `
          varying vec3 vLocalPos;
          void main(){ vLocalPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
        `,
        fragmentShader: `
          uniform sampler2D tImage; uniform float uOpacity; uniform vec3 uCenterDir;
          uniform float uHFov,uImageAspect,uHOffset,uVOffset;
          varying vec3 vLocalPos;
          void main(){
            vec3 dir=normalize(vLocalPos);
            vec3 fwd=normalize(uCenterDir);
            vec3 wu=abs(fwd.y)<0.99?vec3(0,1,0):vec3(1,0,0);
            vec3 rt=normalize(cross(wu,fwd)),up=cross(fwd,rt);
            float az=atan(dot(dir,rt),dot(dir,fwd));
            float el=asin(clamp(dot(dir,up),-1.0,1.0));
            float hh=uHFov*0.5,vv=uHFov/uImageAspect*0.5;
            float u=(az/(2.0*hh)+0.5)+uHOffset;
            float v=0.5+el/(2.0*vv)+uVOffset;
            if(u<0.0||u>1.0||v<0.0||v>1.0){gl_FragColor=vec4(0);return;}
            float ew=0.03,ef=smoothstep(0.0,ew,u)*smoothstep(0.0,ew,1.0-u)*smoothstep(0.0,ew,v)*smoothstep(0.0,ew,1.0-v);
            gl_FragColor=vec4(texture2D(tImage,vec2(u,v)).rgb,uOpacity*ef);
          }
        `,
        side: THREE.BackSide, transparent: true, depthWrite: false,
      })
    }

    // Reduced from 64×32 — projection done in shader, low vertex count is fine
    const skyMat  = makeSkyMat(1.0)
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat)
    skyMesh.renderOrder = -1001
    skyScene.add(skyMesh)

    const skyMat2  = makeSkyMat(0.0)
    const skyMesh2 = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat2)
    skyMesh2.renderOrder = -1000
    skyScene.add(skyMesh2)

    // ── Drone scene ──────────────────────────────────────────────────────────
    const scene = new THREE.Scene()
    let droneObject  = null
    let droneBasePos = new THREE.Vector3()
    let droneBaseRot = new THREE.Euler()

    const bobCfg = { bobAmp: 0.005, bobPeriod: 5.0, stallPeriod: 3.0, stallDepth: 0.35, pitchAmp: 0.0075 }
    const droneOffsetPos1 = { x: -0.040, y: 1.045, z: -0.560 }
    const droneOffsetPos2 = { x:  0.030, y: 0.168, z: -0.650 }
    const droneOffset = { x: droneOffsetPos1.x, y: 0, z: droneOffsetPos1.z }

    // World-space box projection UVs
    function genUVs(mesh, tpu) {
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
        uvs[i*2] = u*tpu; uvs[i*2+1] = v*tpu
      }
      g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2)); g.attributes.uv.needsUpdate = true
    }

    function mkTex(canvas, colorSpace) {
      const t = new THREE.CanvasTexture(canvas)
      t.colorSpace = colorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter; t.anisotropy = 4  // reduced from 16
      return t
    }

    function makeCF(opts = {}) {
      const sz = 512, tc = opts.towCount || 32, tp = sz / tc, gap = opts.gap || 1
      const mk = () => { const c = document.createElement("canvas"); c.width = c.height = sz; return { c, ctx: c.getContext("2d") } }

      const { c: aC, ctx: a } = mk()
      a.fillStyle = "#1a1a1e"; a.fillRect(0, 0, sz, sz)
      for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
        const x = col*tp, y = row*tp, iw = ((col+row)%4) < 2
        const base = iw ? 120+Math.random()*20 : 85+Math.random()*20
        a.fillStyle = iw ? `rgb(${base},${base},${base+3})` : `rgb(${base+2},${base},${base})`
        a.fillRect(x+gap, y+gap, tp-gap*2, tp-gap*2)
        for (let s = 0; s < 5; s++) {
          a.strokeStyle = `rgba(255,255,255,${0.03+Math.random()*0.04})`; a.lineWidth = 0.8; a.beginPath()
          if (iw) { const sx = x+gap+((tp-gap*2)*(s+0.5))/5; a.moveTo(sx,y+gap); a.lineTo(sx,y+tp-gap) }
          else    { const sy = y+gap+((tp-gap*2)*(s+0.5))/5; a.moveTo(x+gap,sy); a.lineTo(x+tp-gap,sy) }
          a.stroke()
        }
      }

      const { c: rC, ctx: r } = mk(), br = 90
      r.fillStyle = `rgb(${br},${br},${br})`; r.fillRect(0, 0, sz, sz)
      for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
        const x = col*tp, y = row*tp, iw = ((col+row)%4) < 2
        const v = iw ? br-6+Math.random()*4 : br+2+Math.random()*6
        r.fillStyle = `rgb(${v},${v},${v})`; r.fillRect(x+gap, y+gap, tp-gap*2, tp-gap*2)
        const gv = br+30; r.fillStyle = `rgb(${gv},${gv},${gv})`; r.fillRect(x,y,tp,gap); r.fillRect(x,y,gap,tp)
      }

      const { c: nC, ctx: n } = mk()
      n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, sz, sz)
      for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
        const x = col*tp, y = row*tp, iw = ((col+row)%4) < 2
        if (iw) {
          const hw = (tp-gap*2)/2
          n.fillStyle = "rgba(110,128,255,0.45)"; n.fillRect(x+gap,y+gap,hw,tp-gap*2)
          n.fillStyle = "rgba(146,128,255,0.45)"; n.fillRect(x+gap+hw,y+gap,hw,tp-gap*2)
          n.fillStyle = "rgba(128,115,255,0.3)";  n.fillRect(x+gap,y+gap,tp-gap*2,2)
          n.fillStyle = "rgba(128,141,255,0.3)";  n.fillRect(x+gap,y+tp-gap-2,tp-gap*2,2)
        } else {
          const hh = (tp-gap*2)/2
          n.fillStyle = "rgba(128,110,255,0.45)"; n.fillRect(x+gap,y+gap,tp-gap*2,hh)
          n.fillStyle = "rgba(128,146,255,0.45)"; n.fillRect(x+gap,y+gap+hh,tp-gap*2,hh)
          n.fillStyle = "rgba(115,128,255,0.3)";  n.fillRect(x+gap,y+gap,2,tp-gap*2)
          n.fillStyle = "rgba(141,128,255,0.3)";  n.fillRect(x+tp-gap-2,y+gap,2,tp-gap*2)
        }
      }
      for (let row = 0; row < tc; row++) for (let col = 0; col < tc; col++) {
        const x = col*tp, y = row*tp
        n.fillStyle = "rgba(128,108,240,0.5)"; n.fillRect(x,y,tp,gap+1)
        n.fillStyle = "rgba(108,128,240,0.5)"; n.fillRect(x,y,gap+1,tp)
      }
      return { albedo: mkTex(aC, THREE.SRGBColorSpace), rough: mkTex(rC, THREE.NoColorSpace), normal: mkTex(nC, THREE.NoColorSpace) }
    }

    function makeSolar(opts = {}) {
      const sz = 512, cc = opts.cellCols || 4, cr = opts.cellRows || 6
      const cg = opts.cellGap || 10, bbc = opts.busBarCount || 5, fs = opts.fingerSpacing || 4
      const cw = (sz-(cc+1)*cg)/cc, ch = (sz-(cr+1)*cg)/cr
      const cx = c => cg+c*(cw+cg), cy = r => cg+r*(ch+cg)
      const mk = () => { const c = document.createElement("canvas"); c.width = c.height = sz; return { c, ctx: c.getContext("2d") } }

      const { c: aC, ctx: a } = mk()
      a.fillStyle = "#474751"; a.fillRect(0, 0, sz, sz)
      for (let row = 0; row < cr; row++) for (let col = 0; col < cc; col++) {
        const x = cx(col), y = cy(row), rv = Math.random()*4-2
        a.fillStyle = `rgb(${6+rv},${8+rv},${18+rv})`; a.fillRect(x,y,cw,ch)
        a.strokeStyle = "rgba(30,50,100,0.5)"; a.lineWidth = 2; a.strokeRect(x+1,y+1,cw-2,ch-2)
        const grad = a.createLinearGradient(x,y,x+cw,y+ch)
        grad.addColorStop(0,"rgba(40,50,90,0.08)"); grad.addColorStop(1,"rgba(20,25,50,0.08)")
        a.fillStyle = grad; a.fillRect(x,y,cw,ch)
        for (let b = 0; b < bbc; b++) {
          const barY = y+ch*(b+1)/(bbc+1)
          a.strokeStyle = "rgba(50,50,58,0.95)"; a.lineWidth = 1.5; a.beginPath(); a.moveTo(x,barY); a.lineTo(x+cw,barY); a.stroke()
        }
        a.strokeStyle = "rgba(45,45,55,0.50)"; a.lineWidth = 0.5
        for (let fx = x+fs; fx < x+cw; fx += fs) { a.beginPath(); a.moveTo(fx,y); a.lineTo(fx,y+ch); a.stroke() }
        for (let b = 0; b < bbc; b++) {
          const barY = y+ch*(b+1)/(bbc+1)
          for (let fx = x+fs*3; fx < x+cw; fx += fs*4) {
            a.save(); a.translate(fx,barY); a.rotate(Math.PI/4)
            a.fillStyle = "rgba(55,55,65,0.7)"; a.fillRect(-1.5,-1.5,3,3); a.restore()
          }
        }
      }

      const { c: rC, ctx: r } = mk()
      r.fillStyle = "rgb(90,90,90)"; r.fillRect(0,0,sz,sz)
      for (let row = 0; row < cr; row++) for (let col = 0; col < cc; col++) {
        const x = cx(col), y = cy(row), cv = 50+Math.random()*5
        r.fillStyle = `rgb(${cv},${cv},${cv})`; r.fillRect(x,y,cw,ch)
        r.strokeStyle = "rgb(60,60,60)"; r.lineWidth = 2; r.strokeRect(x+1,y+1,cw-2,ch-2)
        for (let b = 0; b < bbc; b++) {
          const barY = y+ch*(b+1)/(bbc+1)
          r.strokeStyle = "rgb(30,30,30)"; r.lineWidth = 1.5; r.beginPath(); r.moveTo(x,barY); r.lineTo(x+cw,barY); r.stroke()
        }
      }

      const { c: nC, ctx: n } = mk()
      n.fillStyle = "rgb(128,128,255)"; n.fillRect(0,0,sz,sz)
      for (let row = 0; row < cr; row++) for (let col = 0; col < cc; col++) {
        const x = cx(col), y = cy(row)
        n.fillStyle = "rgba(118,128,255,0.6)"; n.fillRect(x,y,2,ch)
        n.fillStyle = "rgba(138,128,255,0.6)"; n.fillRect(x+cw-2,y,2,ch)
        n.fillStyle = "rgba(128,118,255,0.6)"; n.fillRect(x,y,cw,2)
        n.fillStyle = "rgba(128,138,255,0.6)"; n.fillRect(x,y+ch-2,cw,2)
        for (let b = 0; b < bbc; b++) {
          const barY = y+ch*(b+1)/(bbc+1)
          n.fillStyle = "rgba(128,118,255,0.4)"; n.fillRect(x,barY-1,cw,1)
          n.fillStyle = "rgba(128,138,255,0.4)"; n.fillRect(x,barY+1,cw,1)
        }
      }
      for (let row = 0; row < cr; row++) for (let col = 0; col < cc; col++) {
        const x = cx(col), y = cy(row)
        n.fillStyle = "rgba(128,108,240,0.5)"; n.fillRect(x-cg,y-cg,cw+cg*2,cg)
        n.fillStyle = "rgba(108,128,240,0.5)"; n.fillRect(x-cg,y,cg,ch)
      }
      return { albedo: mkTex(aC, THREE.SRGBColorSpace), rough: mkTex(rC, THREE.NoColorSpace), normal: mkTex(nC, THREE.NoColorSpace) }
    }

    // droneMats and pendingGltf resolve a race: whichever arrives second triggers setupDrone
    let droneMats = null
    let pendingGltf = null
    const CF_DENSITY = 200.0, SOLAR_DENSITY = 48.0

    // ── Camera ───────────────────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(15, initW / initH, 0.1, 1000)
    const _camTarget = new THREE.Vector3(0.075, 0.123, 0)

    // ── Renderer (antialias: false — DPR 2 provides sufficient AA) ───────────
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false })
    } catch (e) {
      console.warn("[connect-scene] WebGLRenderer threw:", e.message)
      activateFallback('connect-drone'); return
    }
    renderer.setSize(initW, initH)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace    = THREE.SRGBColorSpace
    renderer.toneMapping         = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 3.2
    renderer.setClearColor(0x000000, 1)
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;"
    mountEl.appendChild(renderer.domElement)

    // ── Lighting ─────────────────────────────────────────────────────────────
    const hemiLight = new THREE.HemisphereLight(0x8eafc2, 0x584838, 0.8)
    scene.add(hemiLight)
    const _dayHemiColor    = new THREE.Color(0x8eafc2)
    const _nightHemiColor  = new THREE.Color('#173a72')
    const _dayHemiGround   = new THREE.Color(0x584838)
    const _nightHemiGround = new THREE.Color('#0a0f1a')

    const nightKeyLight  = new THREE.DirectionalLight(0xd0e8ff, 0.0)
    nightKeyLight.position.set(-3.50, 2.50, 3.50)
    scene.add(nightKeyLight)
    const nightFillLight = new THREE.DirectionalLight(0x4a6080, 0.0)
    nightFillLight.position.set(-2.00, -3.00, -2.00)
    scene.add(nightFillLight)

    // ── HDR environment ───────────────────────────────────────────────────────
    const pmrem = new THREE.PMREMGenerator(renderer)
    pmrem.compileEquirectangularShader()
    new RGBELoader().load(ASSETS.hdr, tex => {
      tex.mapping = THREE.EquirectangularReflectionMapping
      scene.environment = pmrem.fromEquirectangular(tex).texture
      scene.environmentRotation = new THREE.Euler(-1070 * Math.PI/180, 1960 * Math.PI/180, 0)
      scene.environmentIntensity = 1.0
      tex.dispose()
    })

    // ── Background textures ───────────────────────────────────────────────────
    const texLoader = new THREE.TextureLoader()
    function loadBgTex(url, mat) {
      texLoader.load(url, tex => {
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter
        tex.generateMipmaps = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
        mat.uniforms.tImage.value = tex
        mat.uniforms.uImageAspect.value = tex.image.width / tex.image.height
      }, undefined, err => console.error("[connect-scene] BG load failed:", url, err))
    }
    loadBgTex(ASSETS.bg,  skyMat)
    loadBgTex(ASSETS.bg2, skyMat2)

    // ── Cloud parallax ────────────────────────────────────────────────────────
    const CLOUD_PARALLAX  = 0.7
    const CLOUD_EDGE_FADE = 0.25
    const cloudGroup  = new THREE.Group()
    const cloudMeshes = []
    scene.add(cloudGroup)
    const cloudCamStart = new THREE.Vector3(2.410, 2.036, 3.150)
    const _camDelta = new THREE.Vector3()

    const cloudVert = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`
    const cloudFrag = `
      uniform sampler2D tCloud; uniform float uOpacity,uEdgeFade; varying vec2 vUv;
      void main(){
        vec4 tex=texture2D(tCloud,vUv);
        float e=smoothstep(0.0,uEdgeFade,vUv.x)*smoothstep(0.0,uEdgeFade,1.0-vUv.x)
               *smoothstep(0.0,uEdgeFade,vUv.y)*smoothstep(0.0,uEdgeFade,1.0-vUv.y);
        gl_FragColor=vec4(tex.rgb,tex.a*uOpacity*e);
      }
    `
    function makeCloud(url, x, y, z, sx, sy, opacity) {
      new THREE.TextureLoader().load(url, tex => {
        tex.colorSpace = THREE.SRGBColorSpace
        const mat = new THREE.ShaderMaterial({
          uniforms: { tCloud: { value: tex }, uOpacity: { value: opacity ?? 0.85 }, uEdgeFade: { value: CLOUD_EDGE_FADE } },
          vertexShader: cloudVert, fragmentShader: cloudFrag,
          transparent: true, depthWrite: false, side: THREE.DoubleSide,
        })
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sx, sy), mat)
        mesh.position.set(x, y, z)
        mesh._baseOpacity = opacity ?? 0.85
        cloudGroup.add(mesh); cloudMeshes.push(mesh)
      })
    }
    makeCloud(ASSETS.cloud1, -1.5, -0.5, -1.0, 3.5, 1.75)
    makeCloud(ASSETS.cloud2,  1.2, -0.3, -0.8, 2.8, 1.4, 0.7)

    // ── Camera poses ─────────────────────────────────────────────────────────
    const poses = [
      { cam: new THREE.Vector3(2.410, 2.035, 3.150), tgt: new THREE.Vector3(-0.360, 0.190, 0.000) },
      { cam: new THREE.Vector3(3.140, 1.445, 2.755), tgt: new THREE.Vector3( 0.075, 0.120, 0.000) },
    ]
    let scrollT = 0, smoothT = 0
    const _posePos = new THREE.Vector3(), _poseTgt = new THREE.Vector3()

    camera.position.copy(poses[0].cam)
    camera.lookAt(_camTarget)

    function applyPose(t) {
      const cl = Math.max(0, Math.min(1, t)), seg = poses.length-1, sc = cl*seg
      const i = Math.min(Math.floor(sc), seg-1), f = sc-i
      _posePos.copy(poses[i].cam).lerp(poses[i+1].cam, f)
      _poseTgt.copy(poses[i].tgt).lerp(poses[i+1].tgt, f)
      camera.position.lerp(_posePos, 0.1)
      _camTarget.lerp(_poseTgt, 0.1)
      camera.lookAt(_camTarget)
      // Guard: only update projection matrix when FOV meaningfully changes
      const targetFov = 15 * (1 - 0.15 * t)
      const newFov = camera.fov + (targetFov - camera.fov) * 0.1
      if (Math.abs(newFov - camera.fov) > 0.001) {
        camera.fov = newFov
        camera.updateProjectionMatrix()
      }
    }

    // ── Model load ────────────────────────────────────────────────────────────
    const draco = new DRACOLoader()
    draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
    const gltfLoader = new GLTFLoader()
    gltfLoader.setDRACOLoader(draco)

    function setupDrone(g) {
      const obj = g.scene
      obj.position.set(0, 0, 0); obj.rotation.set(0, 0, 0)
      const box = new THREE.Box3().setFromObject(obj), bsz = new THREE.Vector3(), bctr = new THREE.Vector3()
      box.getSize(bsz); box.getCenter(bctr)
      const md = Math.max(bsz.x, bsz.y, bsz.z)
      if (isFinite(md) && md > 0) { const s = 1.4/md; obj.scale.setScalar(s); obj.position.sub(bctr.multiplyScalar(s)) }
      obj.rotation.set(-Math.PI/2, 0, 0)
      droneBasePos.copy(obj.position); droneBaseRot.copy(obj.rotation)
      obj.updateMatrixWorld(true)

      const meshes = []
      obj.traverse(c => { if (c.isMesh) meshes.push(c) })
      for (const m of meshes) {
        if (m.geometry && !m.geometry.attributes.normal) m.geometry.computeVertexNormals()
        m.material = droneMats.carbonMatte
      }

      const wingNames = new Set(["mesh73","mesh100","mesh76","mesh103"])
      let assigned = 0
      for (const m of meshes) { if (wingNames.has(m.name)) { m.material = droneMats.solarPanel; assigned++ } }
      if (assigned === 0) {
        const scored = meshes.map(m => {
          const b = new THREE.Box3().setFromObject(m), s = new THREE.Vector3(), ct = new THREE.Vector3()
          b.getSize(s); b.getCenter(ct)
          return { m, score: s.x*s.z*(1/(s.y/Math.max(s.x,s.z,1e-6)+0.02))*(0.6+Math.abs(ct.x)) }
        }).sort((a, b) => b.score - a.score)
        for (let i = 0; i < Math.min(4, scored.length); i++) scored[i].m.material = droneMats.solarPanel
      }

      scene.add(obj); obj.updateMatrixWorld(true)
      for (const m of meshes) genUVs(m, m.material === droneMats.solarPanel ? SOLAR_DENSITY : CF_DENSITY)

      const tailNames = new Set(["mesh159","mesh160","mesh161","mesh162","mesh163","mesh164","mesh165","mesh166","mesh167","mesh168","mesh169","mesh170","mesh171","mesh172","mesh173","mesh174","mesh175","mesh176","mesh177","mesh178","mesh179","mesh180","mesh181","mesh182","mesh183","mesh184"])
      for (const m of meshes) { if (tailNames.has(m.name)) m.material = droneMats.tailMatte }

      droneObject = obj
    }

    // If the GLB arrives before materials are ready, hold it in pendingGltf
    gltfLoader.load(ASSETS.model, g => {
      if (droneMats) { setupDrone(g) } else { pendingGltf = g }
    })

    // Defer heavy texture generation — avoids blocking the initial paint
    const scheduleIdle = fn => typeof requestIdleCallback !== "undefined"
      ? requestIdleCallback(fn, { timeout: 2000 })
      : setTimeout(fn, 0)

    scheduleIdle(() => {
      const cf  = makeCF({ glossy: false, towCount: 24 })
      const sol = makeSolar()

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
      // GLB may have already arrived while textures were being generated
      if (pendingGltf) { setupDrone(pendingGltf); pendingGltf = null }
    })

    // ── ScrollTrigger ─────────────────────────────────────────────────────────
    ScrollTrigger.create({
      trigger: "#connect-track", start: "top top", end: "bottom bottom", scrub: 1,
      onUpdate: s => { scrollT = s.progress },
    })

    // ── Resize ────────────────────────────────────────────────────────────────
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

    // ── Render loop ───────────────────────────────────────────────────────────
    function animate() {
      rafId = requestAnimationFrame(animate)
      const t = clock.getElapsedTime()

      smoothT += (scrollT - smoothT) * 0.08
      if (Math.abs(scrollT - smoothT) < 0.0001) smoothT = scrollT

      applyPose(smoothT)

      skyMesh.position.copy(camera.position)
      skyMesh2.position.copy(camera.position)

      _camDelta.copy(camera.position).sub(cloudCamStart).multiplyScalar(CLOUD_PARALLAX)
      cloudGroup.position.copy(_camDelta)
      cloudGroup.scale.setScalar(camera.fov / 15)
      for (const cm of cloudMeshes) cm.lookAt(camera.position)

      if (droneObject) {
        droneOffset.x = droneOffsetPos1.x + (droneOffsetPos2.x - droneOffsetPos1.x) * smoothT
        droneOffset.z = droneOffsetPos1.z + (droneOffsetPos2.z - droneOffsetPos1.z) * smoothT
        const bob      = Math.sin(t * (2 * Math.PI) / bobCfg.bobPeriod)
        const stallWave = Math.cos(t * (2 * Math.PI) / bobCfg.stallPeriod)
        const stall    = 1.0 - bobCfg.stallDepth * stallWave * stallWave
        droneObject.position.set(
          droneBasePos.x + droneOffset.x,
          droneBasePos.y + droneOffset.y + bob * bobCfg.bobAmp * stall,
          droneBasePos.z + droneOffset.z
        )
        droneObject.rotation.set(
          droneBaseRot.x + Math.cos(t * (2 * Math.PI) / bobCfg.bobPeriod) * stall * bobCfg.pitchAmp,
          droneBaseRot.y, droneBaseRot.z
        )
      }

      // Day → night crossfade over scroll 50% → 100%
      const nightT   = THREE.MathUtils.smoothstep(smoothT, 0.5, 1.0)
      skyMat2.uniforms.uOpacity.value = nightT

      // Cloud fade over scroll 80% → 100%
      const cloudFade = 1.0 - THREE.MathUtils.smoothstep(smoothT, 0.8, 1.0)
      for (const cm of cloudMeshes) cm.material.uniforms.uOpacity.value = (cm._baseOpacity ?? 0.85) * cloudFade

      // Lighting
      hemiLight.color.copy(_dayHemiColor).lerp(_nightHemiColor, nightT)
      hemiLight.groundColor.copy(_dayHemiGround).lerp(_nightHemiGround, nightT)
      hemiLight.intensity = 0.8
      scene.environmentIntensity = 1.0 - nightT * 0.75
      nightKeyLight.intensity  = nightT * 1.60
      nightFillLight.intensity = nightT * 0.00
      if (scene.environmentRotation) {
        scene.environmentRotation.y = 1960 * Math.PI / 180
      }
      renderer.toneMappingExposure = 3.20 - nightT * 1.35

      // Two-pass render: sky first (no tone mapping), then drone scene on top
      renderer.toneMapping = THREE.NoToneMapping
      renderer.autoClear = true
      renderer.render(skyScene, camera)
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.autoClear = false
      renderer.render(scene, camera)
      renderer.autoClear = true
    }

    rafId = requestAnimationFrame(animate)

  } // end initConnectScene
}) // end window load

} // end desktop guard
