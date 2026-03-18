/**
 * connect-scene.js  —  ES Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Single file for both background scenes:
 *
 *   Scene 1 — Hero (#scene-background, #scenes-track)
 *     Wide sky dome (183°, horizontally flipped) with topo wireframe intro + ping-pong drift.
 *     Inits 500ms after page load.
 *
 *   Scene 2 — Connect (#connect-drone, #connect-track)
 *     Two-pass renderer: sky sphere (42° FOV, connect-background-image, horizontally flipped) + drone + clouds.
 *     No intro animation. Inits 500ms after page load.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── ASSETS ───────────────────────────────────────────────────────────────────
const BG_ASSETS = {
  image: "https://webflow-zypsy.github.io/icarus/hero-background-image.webp",
}

const LOOP = { period: 45.0 }

const ASSETS = {
  hdr:    "https://webflow-zypsy.github.io/icarus/green-512.hdr",
  model:  "https://webflow-zypsy.github.io/icarus/apollo-drone.glb",
  bg:     "https://webflow-zypsy.github.io/icarus/connect-background-image.webp",
  cloud1: "https://webflow-zypsy.github.io/icarus/connect-cloud-image-1.webp",
  cloud2: "https://webflow-zypsy.github.io/icarus/connect-cloud-image-2.webp",
}

import * as THREE     from "three"
import { RGBELoader } from "three/addons/loaders/RGBELoader.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js"

// ─── Desktop-only guard ───────────────────────────────────────────────────────
if (!window.matchMedia("(min-width: 992px)").matches) {
  console.info("[scenes] Skipped — non-desktop viewport.")
} else {

window.addEventListener("load", () => {
  if (!window.matchMedia("(min-width: 992px)").matches) return
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
    console.error("[scenes] GSAP / ScrollTrigger not found."); return
  }
  gsap.registerPlugin(ScrollTrigger)

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE 1 — Hero background (#scene-background)
  // Inits 500ms after page load.
  // ═══════════════════════════════════════════════════════════════════════════
  ;(function () {
    setTimeout(initHeroBackground, 500)

    function initHeroBackground() {


  const mountEl = document.getElementById("scene-background")
  if (!mountEl) { console.error("[bg-scene] #scene-background not found."); return }

  const easeOut   = t => 1 - Math.pow(1-t, 3)
  const easeInOut = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2

  let skyReady = false, loadedTexture = null
  let topoMesh = null, topoMat = null, topoGeo = null
  const anim = { phase: "waiting", phaseStart: 0, gridRevealDuration: 1.3, fadeInDuration: 0.8 }

  const scene  = new THREE.Scene()
  const initW  = mountEl.clientWidth  || window.innerWidth
  const initH  = mountEl.clientHeight || window.innerHeight
  const camera = new THREE.PerspectiveCamera(70, initW/initH, 0.1, 1000)

  const renderer = new THREE.WebGLRenderer({ antialias: false })
  renderer.setSize(initW, initH)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(0xffffff, 1)
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;"
  mountEl.appendChild(renderer.domElement)

  // ── Sky mesh factory ──────────────────────────────────────────────────────────
  // Creates an independent sky sphere with its own material + uniforms.
  const DOME_H_FOV = 183.0 * Math.PI / 180.0

  function makeSkyMesh(tex) {
    const geo = new THREE.SphereGeometry(500, 64, 32)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tImage:       { value: tex },
        uOpacity:     { value: 0.0 },
        uCenterDir:   { value: new THREE.Vector3(0.642, -0.506, 0.576) },
        uHFov:        { value: DOME_H_FOV },
        uImageAspect: { value: tex ? tex.image.width / tex.image.height : 16/9 },
        uHOffset:     { value: 0.0 },
        uVOffset:     { value: 0.0 },
      },
      vertexShader: `
        varying vec3 vLP;
        void main(){ vLP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform sampler2D tImage; uniform float uOpacity; uniform vec3 uCenterDir;
        uniform float uHFov,uImageAspect,uHOffset,uVOffset;
        varying vec3 vLP;
        void main(){
          vec3 dir=normalize(vLP);
          vec3 fwd=normalize(uCenterDir);
          vec3 wu=abs(fwd.y)<0.99?vec3(0,1,0):vec3(1,0,0);
          vec3 rt=normalize(cross(wu,fwd)),up=cross(fwd,rt);
          float az=atan(dot(dir,rt),dot(dir,fwd));
          float el=asin(clamp(dot(dir,up),-1.0,1.0));
          float hh=uHFov*0.5,vv=uHFov/uImageAspect*0.5;
          float u=1.0-(az/(2.0*hh)+0.5)+uHOffset;
          float v=0.5+el/(2.0*vv)+uVOffset;
          if(u<0.0||u>1.0||v<0.0||v>1.0){gl_FragColor=vec4(0);return;}
          float ew=0.03,ef=smoothstep(0.0,ew,u)*smoothstep(0.0,ew,1.0-u)*smoothstep(0.0,ew,v)*smoothstep(0.0,ew,1.0-v);
          gl_FragColor=vec4(texture2D(tImage,vec2(u,v)).rgb,uOpacity*ef);
        }
      `,
      side: THREE.BackSide, transparent: true, depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = -1000
    scene.add(mesh)
    return { mesh, mat, geo }
  }

  // Disposes geometry + material but NOT the shared texture
  function destroySkyMesh(sky) {
    if (!sky) return
    scene.remove(sky.mesh)
    sky.geo.dispose()
    sky.mat.dispose()
    // sky.mat.uniforms.tImage.value is the shared texture — do NOT dispose it
  }

  // Single sky instance — ping-pong animation needs only one sphere
  let skyA = null

  // ── Topo wireframe ────────────────────────────────────────────────────────────
  const GS=180, GSZ=200, GOX=-1.5, GOZ=-1
  topoGeo = new THREE.PlaneGeometry(GSZ, GSZ, GS, GS); topoGeo.rotateX(-Math.PI/2)
  topoMat = new THREE.ShaderMaterial({
    uniforms: {
      tSky:               { value: null },
      uOpacity:           { value: 0.0  },
      uDisplacementScale: { value: 3.5  },
      uGridMin:           { value: new THREE.Vector2(GOX-GSZ/2, GOZ-GSZ/2) },
      uGridMax:           { value: new THREE.Vector2(GOX+GSZ/2, GOZ+GSZ/2) },
    },
    vertexShader: `
      uniform sampler2D tSky; uniform float uDisplacementScale; uniform vec2 uGridMin,uGridMax;
      varying float vL;
      void main(){
        vec3 wp=(modelMatrix*vec4(position,1.0)).xyz;
        float u=clamp((wp.x-uGridMin.x)/(uGridMax.x-uGridMin.x),0.0,1.0);
        float v=clamp(1.0-(wp.z-uGridMin.y)/(uGridMax.y-uGridMin.y),0.0,1.0);
        vec4 ts=texture2D(tSky,vec2(u,v));
        float lum=clamp(dot(ts.rgb,vec3(0.2126,0.7152,0.0722)),0.0,1.0);
        vL=lum; wp.y+=lum*uDisplacementScale;
        gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity; varying float vL;
      void main(){ gl_FragColor=vec4(vec3(0.82+vL*0.05),uOpacity); }
    `,
    wireframe: true, transparent: true, depthWrite: false,
  })
  topoMesh = new THREE.Mesh(topoGeo, topoMat)
  topoMesh.position.set(GOX, -1, GOZ)
  scene.add(topoMesh)

  // ── Load image ────────────────────────────────────────────────────────────────
  new THREE.TextureLoader().load(BG_ASSETS.image, tex => {
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    loadedTexture = tex
    skyA = makeSkyMesh(tex)
    topoMat.uniforms.tSky.value = tex
    skyReady = true
  }, undefined, err => console.error("[bg-scene] Image load failed:", err))

  // ── Camera poses ──────────────────────────────────────────────────────────────
  const poses = [
    { cam: new THREE.Vector3(-2.822, 1.964, -2.34), tgt: new THREE.Vector3(0, 0.3, 0), fov: 60 },
    { cam: new THREE.Vector3(-4.641, 3.509,  0   ), tgt: new THREE.Vector3(0, 0.3, 0), fov: 60 },
    { cam: new THREE.Vector3(-5.613,11.412,  0   ), tgt: new THREE.Vector3(0, 0.3, 0), fov: 60 },
  ]
      
  const _cp = new THREE.Vector3(), _ct = new THREE.Vector3(), _cc = new THREE.Color()
  let scrollT = 0, smoothT = 0

  function applyPose(t) {
    const cl=Math.max(0,Math.min(1,t)), seg=poses.length-1, sc=cl*seg
    const i=Math.min(Math.floor(sc),seg-1), f=sc-i
    _cp.lerpVectors(poses[i].cam, poses[i+1].cam, f)
    _ct.lerpVectors(poses[i].tgt, poses[i+1].tgt, f)
    camera.position.copy(_cp); camera.lookAt(_ct)
  }
  applyPose(0)

  ScrollTrigger.create({
    trigger: "#scenes-track", start: "top top", end: "bottom top", scrub: 1,
    onUpdate: s => { scrollT = s.progress }
  })

  new ResizeObserver(() => {
    const w = mountEl.clientWidth||window.innerWidth, h = mountEl.clientHeight||window.innerHeight
    camera.aspect = w/h; camera.updateProjectionMatrix()
    renderer.setSize(w, h); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  }).observe(mountEl)

  // ── Loop state ────────────────────────────────────────────────────────────────
  let cycleStart = 0   // absolute time when the current cycle began

  // ── Render loop ───────────────────────────────────────────────────────────────
  let lastTime = 0
  function animate(now) {
    requestAnimationFrame(animate)
    const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now
    const ns = now / 1000

    // Smooth scroll
    smoothT += (scrollT - smoothT) * (1 - Math.exp(-18 * dt))
    if (Math.abs(scrollT - smoothT) < 0.0001) smoothT = scrollT
    applyPose(smoothT)

    // Keep sky sphere centred on camera so it never clips
    if (skyA) skyA.mesh.position.copy(camera.position)

    // ── Intro reveal ────────────────────────────────────────────────────────────
    if (anim.phase === "waiting" && skyReady) {
      anim.phase = "gridReveal"; anim.phaseStart = ns
    }

    if (anim.phase === "gridReveal") {
      const t = Math.min((ns - anim.phaseStart) / anim.gridRevealDuration, 1)
      topoMat.uniforms.uOpacity.value = easeInOut(t) * 0.45
      if (t >= 1) { anim.phase = "fadeIn"; anim.phaseStart = ns }

    } else if (anim.phase === "fadeIn") {
      const t = Math.min((ns - anim.phaseStart) / anim.fadeInDuration, 1), e = easeOut(t)
      if (skyA) skyA.mat.uniforms.uOpacity.value = e
      if (topoMat) topoMat.uniforms.uOpacity.value = 0.45 * (1 - e)
      const wb = 1 - e; renderer.setClearColor(_cc.setRGB(wb, wb, wb), 1)
      if (t >= 1) {
        anim.phase = "running"; cycleStart = ns   // reset cycle clock here so offsets start from 0
        if (skyA) skyA.mat.uniforms.uOpacity.value = 1.0
        renderer.setClearColor(0x000000, 1)
        if (topoMesh) {
          scene.remove(topoMesh); topoGeo.dispose(); topoMat.dispose()
          topoMesh = topoGeo = topoMat = null
        }
      }

    } else if (anim.phase === "running" && skyA) {

      // ── Ping-pong offset animation ───────────────────────────────────────────
      // totalT counts up forever. We divide by period to get which half-cycle
      // we're in: even half = forward (0→1), odd half = reverse (1→0).
      // This gives a seamless bounce with no hard cuts or crossfades needed.
      const ha     = 0.06 * (1 - Math.min(smoothT / 0.3, 1))
      const totalT = ns - cycleStart
      const halfN  = Math.floor(totalT / LOOP.period)   // which half-cycle (0, 1, 2, ...)
      const phase  = (totalT % LOOP.period) / LOOP.period  // 0 → 1 within this half

      // Even half = forward, odd half = reverse
      const frac = (halfN % 2 === 0) ? phase : 1.0 - phase

      skyA.mat.uniforms.uHOffset.value = frac * ha
      skyA.mat.uniforms.uVOffset.value = -frac * 0.10
    }

    renderer.render(scene, camera)
  }
  requestAnimationFrame(animate)

    } // end initHeroBackground
  })()

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE 2 — Connect section (#connect-drone, two-pass)
  // Inits 500ms after page load.
  // ═══════════════════════════════════════════════════════════════════════════
  ;(function () {
    setTimeout(initConnectScene, 500)

    function initConnectScene() {

  // Mount into #connect-drone (z-index 2 — sits above #connect-background)
  const mountEl = document.getElementById("connect-drone")
  if (!mountEl) { console.error("[connect-scene] #connect-drone not found."); return }

  const initW = mountEl.clientWidth  || window.innerWidth
  const initH = mountEl.clientHeight || window.innerHeight

  const clock = new THREE.Clock()

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE 1: SKY (background pass) — drone-about-v6 exact values
  // These are tuned specifically for connect-background-image.webp
  // ═══════════════════════════════════════════════════════════════════════════
  const skyScene = new THREE.Scene()

  // drone-about-v6 DOME_H_FOV = 42° (telephoto crop of the mountain image)
  // drone-about-v6 uCenterDir = (-0.621, -0.343, -0.705)
  const DOME_H_FOV = 42.0 * Math.PI / 180.0
  const skySphereGeo = new THREE.SphereGeometry(500, 64, 32)
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      tImage:       { value: null },
      uOpacity:     { value: 1.0 },
      uCenterDir:   { value: new THREE.Vector3(-0.621, -0.343, -0.705) }, // v6 exact
      uHFov:        { value: DOME_H_FOV },
      uImageAspect: { value: 16.0 / 9.0 },
      uHOffset:     { value: 0.0 },
      uVOffset:     { value: 0.0 },
      uExposure:    { value: 1.0 }, // driven by scroll to darken sky in sync with drone pass
    },
    vertexShader: `
      varying vec3 vLocalPos;
      void main(){ vLocalPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform sampler2D tImage; uniform float uOpacity,uExposure; uniform vec3 uCenterDir;
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
        vec3 col=texture2D(tImage,vec2(u,v)).rgb*uExposure;
        gl_FragColor=vec4(col,uOpacity*ef);
      }
    `,
    side: THREE.BackSide, transparent: true, depthWrite: false,
  })
  const skySphereMesh = new THREE.Mesh(skySphereGeo, skyMat)
  skySphereMesh.renderOrder = -1000
  skyScene.add(skySphereMesh)


  // ══════════════════════════════════════════════════════════════════════════
  // SCENE 2: DRONE — from drone-about-v6
  // ═══════════════════════════════════════════════════════════════════════════
  const scene = new THREE.Scene()
  let droneObject  = null
  let droneBasePos = new THREE.Vector3()
  let droneBaseRot = new THREE.Euler()

  // Bob — from drone-about-v6 bobCfg, bobAmp ÷8
  const bobCfg = { bobAmp:0.005, bobPeriod:5.0, stallPeriod:3.0, stallDepth:0.35, pitchAmp:0.0075 }

  // Drone offset — v6 values ÷8
  const droneOffsetPos1 = { x: -0.040, y: 1.045, z: -0.560 }
  const droneOffsetPos2 = { x: 0.030, y: 0.168, z: -0.650 }
      
  const droneOffset = { x:droneOffsetPos1.x, y:0, z:droneOffsetPos1.z }

  // ── UV generation ─────────────────────────────────────────────────────────
  function genUVs(mesh, tpu) {
    const g=mesh.geometry; if(!g) return
    const pos=g.attributes.position, nor=g.attributes.normal; if(!pos||!nor) return
    const uvs=new Float32Array(pos.count*2)
    mesh.updateMatrixWorld(true)
    const _v=new THREE.Vector3(),_n=new THREE.Vector3()
    const nm=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
    for (let i=0;i<pos.count;i++){
      _v.set(pos.getX(i),pos.getY(i),pos.getZ(i)).applyMatrix4(mesh.matrixWorld)
      _n.set(nor.getX(i),nor.getY(i),nor.getZ(i)).applyMatrix3(nm).normalize()
      const ax=Math.abs(_n.x),ay=Math.abs(_n.y),az=Math.abs(_n.z)
      let u,v
      if(ax>=ay&&ax>=az){u=_v.y;v=_v.z}
      else if(ay>=ax&&ay>=az){u=_v.x;v=_v.z}
      else{u=_v.x;v=_v.y}
      uvs[i*2]=u*tpu; uvs[i*2+1]=v*tpu
    }
    g.setAttribute("uv",new THREE.BufferAttribute(uvs,2)); g.attributes.uv.needsUpdate=true
  }

  function mkTex(canvas, colorSpace) {
    const t=new THREE.CanvasTexture(canvas)
    t.colorSpace=colorSpace; t.wrapS=t.wrapT=THREE.RepeatWrapping
    t.generateMipmaps=true; t.minFilter=THREE.LinearMipmapLinearFilter
    t.magFilter=THREE.LinearFilter; t.anisotropy=16; return t
  }

  // ── Carbon fiber ──────────────────────────────────────────────────────────
  function makeCF(opts={}) {
    const sz=512,tc=opts.towCount||32,tp=sz/tc,gap=opts.gap||1
    const mk=()=>{const c=document.createElement("canvas");c.width=c.height=sz;return{c,ctx:c.getContext("2d")}}
    const{c:aC,ctx:a}=mk()
    a.fillStyle="#1a1a1e"; a.fillRect(0,0,sz,sz)
    for(let row=0;row<tc;row++) for(let col=0;col<tc;col++){
      const x=col*tp,y=row*tp,iw=((col+row)%4)<2
      const base=iw?120+Math.random()*20:85+Math.random()*20
      a.fillStyle=iw?`rgb(${base},${base},${base+3})`:`rgb(${base+2},${base},${base})`
      a.fillRect(x+gap,y+gap,tp-gap*2,tp-gap*2)
      for(let s=0;s<5;s++){
        a.strokeStyle=`rgba(255,255,255,${0.03+Math.random()*0.04})`; a.lineWidth=0.8; a.beginPath()
        if(iw){const sx=x+gap+((tp-gap*2)*(s+0.5))/5;a.moveTo(sx,y+gap);a.lineTo(sx,y+tp-gap)}
        else{const sy=y+gap+((tp-gap*2)*(s+0.5))/5;a.moveTo(x+gap,sy);a.lineTo(x+tp-gap,sy)}
        a.stroke()
      }
    }
    const{c:rC,ctx:r}=mk(),br=90
    r.fillStyle=`rgb(${br},${br},${br})`; r.fillRect(0,0,sz,sz)
    for(let row=0;row<tc;row++) for(let col=0;col<tc;col++){
      const x=col*tp,y=row*tp,iw=((col+row)%4)<2
      const v=iw?br-6+Math.random()*4:br+2+Math.random()*6
      r.fillStyle=`rgb(${v},${v},${v})`; r.fillRect(x+gap,y+gap,tp-gap*2,tp-gap*2)
      const gv=br+30; r.fillStyle=`rgb(${gv},${gv},${gv})`; r.fillRect(x,y,tp,gap); r.fillRect(x,y,gap,tp)
    }
    const{c:nC,ctx:n}=mk()
    n.fillStyle="rgb(128,128,255)"; n.fillRect(0,0,sz,sz)
    for(let row=0;row<tc;row++) for(let col=0;col<tc;col++){
      const x=col*tp,y=row*tp,iw=((col+row)%4)<2
      if(iw){
        const hw=(tp-gap*2)/2
        n.fillStyle="rgba(110,128,255,0.45)";n.fillRect(x+gap,y+gap,hw,tp-gap*2)
        n.fillStyle="rgba(146,128,255,0.45)";n.fillRect(x+gap+hw,y+gap,hw,tp-gap*2)
        n.fillStyle="rgba(128,115,255,0.3)";n.fillRect(x+gap,y+gap,tp-gap*2,2)
        n.fillStyle="rgba(128,141,255,0.3)";n.fillRect(x+gap,y+tp-gap-2,tp-gap*2,2)
      } else {
        const hh=(tp-gap*2)/2
        n.fillStyle="rgba(128,110,255,0.45)";n.fillRect(x+gap,y+gap,tp-gap*2,hh)
        n.fillStyle="rgba(128,146,255,0.45)";n.fillRect(x+gap,y+gap+hh,tp-gap*2,hh)
        n.fillStyle="rgba(115,128,255,0.3)";n.fillRect(x+gap,y+gap,2,tp-gap*2)
        n.fillStyle="rgba(141,128,255,0.3)";n.fillRect(x+tp-gap-2,y+gap,2,tp-gap*2)
      }
    }
    for(let row=0;row<tc;row++) for(let col=0;col<tc;col++){
      const x=col*tp,y=row*tp
      n.fillStyle="rgba(128,108,240,0.5)";n.fillRect(x,y,tp,gap+1)
      n.fillStyle="rgba(108,128,240,0.5)";n.fillRect(x,y,gap+1,tp)
    }
    return{albedo:mkTex(aC,THREE.SRGBColorSpace),rough:mkTex(rC,THREE.NoColorSpace),normal:mkTex(nC,THREE.NoColorSpace)}
  }

  // ── Solar panel ───────────────────────────────────────────────────────────
  function makeSolar(opts={}) {
    const sz=512,cc=opts.cellCols||4,cr=opts.cellRows||6
    const cg=opts.cellGap||10,bbc=opts.busBarCount||5,fs=opts.fingerSpacing||4
    const cw=(sz-(cc+1)*cg)/cc,ch=(sz-(cr+1)*cg)/cr
    const cx=c=>cg+c*(cw+cg),cy=r=>cg+r*(ch+cg)
    const mk=()=>{const c=document.createElement("canvas");c.width=c.height=sz;return{c,ctx:c.getContext("2d")}}
    const{c:aC,ctx:a}=mk()
    a.fillStyle="#474751"; a.fillRect(0,0,sz,sz)
    for(let row=0;row<cr;row++) for(let col=0;col<cc;col++){
      const x=cx(col),y=cy(row),rv=Math.random()*4-2
      a.fillStyle=`rgb(${6+rv},${8+rv},${18+rv})`; a.fillRect(x,y,cw,ch)
      a.strokeStyle="rgba(30,50,100,0.5)";a.lineWidth=2;a.strokeRect(x+1,y+1,cw-2,ch-2)
      const grad=a.createLinearGradient(x,y,x+cw,y+ch)
      grad.addColorStop(0,"rgba(40,50,90,0.08)");grad.addColorStop(1,"rgba(20,25,50,0.08)")
      a.fillStyle=grad;a.fillRect(x,y,cw,ch)
      for(let b=0;b<bbc;b++){
        const by=y+ch*(b+1)/(bbc+1)
        a.strokeStyle="rgba(50,50,58,0.95)";a.lineWidth=1.5;a.beginPath();a.moveTo(x,by);a.lineTo(x+cw,by);a.stroke()
      }
      a.strokeStyle="rgba(45,45,55,0.50)";a.lineWidth=0.5
      for(let fx=x+fs;fx<x+cw;fx+=fs){a.beginPath();a.moveTo(fx,y);a.lineTo(fx,y+ch);a.stroke()}
      for(let b=0;b<bbc;b++){
        const by=y+ch*(b+1)/(bbc+1)
        for(let fx=x+fs*3;fx<x+cw;fx+=fs*4){
          a.save();a.translate(fx,by);a.rotate(Math.PI/4);a.fillStyle="rgba(55,55,65,0.7)";a.fillRect(-1.5,-1.5,3,3);a.restore()
        }
      }
    }
    const{c:rC,ctx:r}=mk()
    r.fillStyle="rgb(90,90,90)";r.fillRect(0,0,sz,sz)
    for(let row=0;row<cr;row++) for(let col=0;col<cc;col++){
      const x=cx(col),y=cy(row),cv=50+Math.random()*5
      r.fillStyle=`rgb(${cv},${cv},${cv})`;r.fillRect(x,y,cw,ch)
      r.strokeStyle="rgb(60,60,60)";r.lineWidth=2;r.strokeRect(x+1,y+1,cw-2,ch-2)
      for(let b=0;b<bbc;b++){
        const by=y+ch*(b+1)/(bbc+1)
        r.strokeStyle="rgb(30,30,30)";r.lineWidth=1.5;r.beginPath();r.moveTo(x,by);r.lineTo(x+cw,by);r.stroke()
      }
    }
    const{c:nC,ctx:n}=mk()
    n.fillStyle="rgb(128,128,255)";n.fillRect(0,0,sz,sz)
    for(let row=0;row<cr;row++) for(let col=0;col<cc;col++){
      const x=cx(col),y=cy(row)
      n.fillStyle="rgba(118,128,255,0.6)";n.fillRect(x,y,2,ch)
      n.fillStyle="rgba(138,128,255,0.6)";n.fillRect(x+cw-2,y,2,ch)
      n.fillStyle="rgba(128,118,255,0.6)";n.fillRect(x,y,cw,2)
      n.fillStyle="rgba(128,138,255,0.6)";n.fillRect(x,y+ch-2,cw,2)
      for(let b=0;b<bbc;b++){
        const by=y+ch*(b+1)/(bbc+1)
        n.fillStyle="rgba(128,118,255,0.4)";n.fillRect(x,by-1,cw,1)
        n.fillStyle="rgba(128,138,255,0.4)";n.fillRect(x,by+1,cw,1)
      }
    }
    for(let row=0;row<cr;row++) for(let col=0;col<cc;col++){
      const x=cx(col),y=cy(row)
      n.fillStyle="rgba(128,108,240,0.5)";n.fillRect(x-cg,y-cg,cw+cg*2,cg)
      n.fillStyle="rgba(108,128,240,0.5)";n.fillRect(x-cg,y,cg,ch)
    }
    return{albedo:mkTex(aC,THREE.SRGBColorSpace),rough:mkTex(rC,THREE.NoColorSpace),normal:mkTex(nC,THREE.NoColorSpace)}
  }

  const cf  = makeCF({ glossy:false, towCount:24 })
  const sol = makeSolar()

  const droneMats = {
    solarPanel: new THREE.MeshPhysicalMaterial({
      color:0xffffff,map:sol.albedo,metalness:0.01,roughness:0.02,roughnessMap:sol.rough,
      clearcoat:0.75,clearcoatRoughness:0.05,normalMap:sol.normal,normalScale:new THREE.Vector2(2.4,2.4),
      envMapIntensity:0.5,side:THREE.DoubleSide,
    }),
    carbonMatte: new THREE.MeshPhysicalMaterial({
      color:0x6d6d6d,map:cf.albedo,metalness:0.0,roughness:0.92,roughnessMap:cf.rough,
      clearcoat:0.0,normalMap:cf.normal,normalScale:new THREE.Vector2(0.2,0.2),
      envMapIntensity:0.25,side:THREE.DoubleSide,
    }),
    tailMatte: new THREE.MeshPhysicalMaterial({
      color:0xc9c9c9,map:cf.albedo,metalness:0.0,roughness:0.92,roughnessMap:cf.rough,
      clearcoat:0.0,normalMap:cf.normal,normalScale:new THREE.Vector2(0.2,0.2),
      envMapIntensity:0.25,side:THREE.DoubleSide,
    }),
  }
  const CF_DENSITY=200.0, SOLAR_DENSITY=48.0

  // ── Main camera — drone-about-v6 FOV + initial pose ÷8 ───────────────────
  const camera = new THREE.PerspectiveCamera(15, initW/initH, 0.1, 1000)
  const _camTarget = new THREE.Vector3(0.075, 0.123, 0)

  // ── Single combined renderer ──────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(initW, initH)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace    = THREE.SRGBColorSpace
  renderer.toneMapping         = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 3.2
  renderer.setClearColor(0x000000, 1)
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;"
  mountEl.appendChild(renderer.domElement)

  // ── Lighting ──────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0x8eafc2, 0x584838, 0.8))

  // ── HDR env — drone-about-v6 exact rotation ───────────────────────────────
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  new RGBELoader().load(ASSETS.hdr, tex => {
    tex.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = pmrem.fromEquirectangular(tex).texture
    scene.environmentRotation = new THREE.Euler(-1070*Math.PI/180, 1960*Math.PI/180, 0)
    tex.dispose()
  })

  // ── Load background image — feed to skyMat + topoMat ─────────────────────
  new THREE.TextureLoader().load(ASSETS.bg, tex => {
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    skyMat.uniforms.tImage.value = tex
    skyMat.uniforms.uImageAspect.value = tex.image.width / tex.image.height
  }, undefined, err => console.error("[connect-scene] BG load failed:", err))

  // ── Cloud parallax — drone-about-v6 values ÷8 ────────────────────────────
  // v6: connect-cloud-image-1 at (-12,-4,-8) scale 28×14, CLOUD_PARALLAX=0.7, CLOUD_EDGE_FADE=0.25
  // ÷8: (-1.5,-0.5,-1.0) scale 3.5×1.75
  const CLOUD_PARALLAX  = 0.7
  const CLOUD_EDGE_FADE = 0.25
  const cloudGroup  = new THREE.Group()
  const cloudMeshes = []
  scene.add(cloudGroup)
  // v6 cloudCamStart = camera start pos ÷8
  const cloudCamStart = new THREE.Vector3(2.410, 2.036, 3.150)
  const _camDelta = new THREE.Vector3()

  const cloudVert=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`
  const cloudFrag=`
    uniform sampler2D tCloud;uniform float uOpacity,uEdgeFade;varying vec2 vUv;
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
        uniforms:{tCloud:{value:tex},uOpacity:{value:opacity??0.85},uEdgeFade:{value:CLOUD_EDGE_FADE}},
        vertexShader:cloudVert, fragmentShader:cloudFrag,
        transparent:true, depthWrite:false, side:THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sx,sy), mat)
      mesh.position.set(x,y,z)
      mesh._baseOpacity = opacity ?? 0.85  // stored for scroll-driven fade
      cloudGroup.add(mesh); cloudMeshes.push(mesh)
    })
  }
  makeCloud(ASSETS.cloud1, -1.5, -0.5, -1.0, 3.5, 1.75)        // connect-cloud-image-1: bottom-left
  makeCloud(ASSETS.cloud2,  1.2, -0.3, -0.8, 2.8, 1.4,  0.7)   // connect-cloud-image-2: right side

  // ── Camera poses — drone-about-v6 ÷8 ─────────────────────────────────────
  // v6 pose 0: cam(19.28,16.29,25.20) tgt(0.6,0.98,0)  ÷8 = cam(2.410,2.036,3.150) tgt(0.075,0.123,0)
  // v6 pose 1: cam(24.92,12.85,22.04) tgt(0.6,0.98,0)  ÷8 = cam(3.115,1.606,2.755) tgt(0.075,0.123,0)
  const poses = [
    { cam: new THREE.Vector3(2.410, 2.035, 3.150), tgt: new THREE.Vector3(-0.360, 0.190, 0.000) },
    { cam: new THREE.Vector3(3.140, 1.445, 2.755), tgt: new THREE.Vector3(0.075, 0.120, 0.000) },    
  ]
  let scrollT=0, smoothT=0
  const _posePos=new THREE.Vector3(), _poseTgt=new THREE.Vector3()

  // Init camera at pose 0
  camera.position.copy(poses[0].cam)
  camera.lookAt(_camTarget)

  function applyPose(t) {
    const cl=Math.max(0,Math.min(1,t)),seg=poses.length-1,sc=cl*seg
    const i=Math.min(Math.floor(sc),seg-1),f=sc-i
    _posePos.copy(poses[i].cam).lerp(poses[i+1].cam,f)
    _poseTgt.copy(poses[i].tgt).lerp(poses[i+1].tgt,f)
    camera.position.lerp(_posePos, 0.1)
    _camTarget.lerp(_poseTgt, 0.1)
    camera.lookAt(_camTarget)
    // FOV: 15 → 12.75 over full scroll (v6: targetFov = 15*(1-0.15*smoothT))
    const targetFov = 15*(1-0.15*t)
    camera.fov += (targetFov-camera.fov)*0.1
    camera.updateProjectionMatrix()
  }

  // ── Model load ────────────────────────────────────────────────────────────
  const draco = new DRACOLoader()
  draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
  const gltfLoader = new GLTFLoader()
  gltfLoader.setDRACOLoader(draco)

  gltfLoader.load(ASSETS.model, g => {
    const obj=g.scene
    obj.position.set(0,0,0); obj.rotation.set(0,0,0)
    const box=new THREE.Box3().setFromObject(obj),bsz=new THREE.Vector3(),bctr=new THREE.Vector3()
    box.getSize(bsz); box.getCenter(bctr)
    const md=Math.max(bsz.x,bsz.y,bsz.z)
    if(isFinite(md)&&md>0){const s=1.4/md;obj.scale.setScalar(s);obj.position.sub(bctr.multiplyScalar(s))}
    obj.rotation.set(-Math.PI/2,0,0)
    droneBasePos.copy(obj.position); droneBaseRot.copy(obj.rotation)
    obj.updateMatrixWorld(true)

    const meshes=[]
    obj.traverse(c=>{if(c.isMesh)meshes.push(c)})
    for(const m of meshes){if(m.geometry&&!m.geometry.attributes.normal)m.geometry.computeVertexNormals();m.material=droneMats.carbonMatte}

    const wingNames=new Set(["mesh73","mesh100","mesh76","mesh103"])
    let assigned=0
    for(const m of meshes){if(wingNames.has(m.name)){m.material=droneMats.solarPanel;assigned++}}
    if(assigned===0){
      const scored=meshes.map(m=>{
        const b=new THREE.Box3().setFromObject(m),s=new THREE.Vector3(),ct=new THREE.Vector3()
        b.getSize(s);b.getCenter(ct)
        return{m,score:s.x*s.z*(1/(s.y/Math.max(s.x,s.z,1e-6)+0.02))*(0.6+Math.abs(ct.x))}
      }).sort((a,b)=>b.score-a.score)
      for(let i=0;i<Math.min(4,scored.length);i++)scored[i].m.material=droneMats.solarPanel
    }
    scene.add(obj); obj.updateMatrixWorld(true)
    for(const m of meshes)genUVs(m,m.material===droneMats.solarPanel?SOLAR_DENSITY:CF_DENSITY)

    const tailNames=new Set(["mesh159","mesh160","mesh161","mesh162","mesh163","mesh164","mesh165","mesh166","mesh167","mesh168","mesh169","mesh170","mesh171","mesh172","mesh173","mesh174","mesh175","mesh176","mesh177","mesh178","mesh179","mesh180","mesh181","mesh182","mesh183","mesh184"])
    for(const m of meshes){if(tailNames.has(m.name))m.material=droneMats.tailMatte}

    droneObject=obj
  })

  // ── ScrollTrigger ─────────────────────────────────────────────────────────
  ScrollTrigger.create({
    trigger:"#connect-track", start:"top top", end:"bottom bottom", scrub:1,
    onUpdate:s=>{scrollT=s.progress},
  })

  // ── Resize ────────────────────────────────────────────────────────────────
  new ResizeObserver(()=>{
    const w=mountEl.clientWidth||window.innerWidth, h=mountEl.clientHeight||window.innerHeight
    camera.aspect=w/h; camera.updateProjectionMatrix()
    
    renderer.setSize(w,h); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
  }).observe(mountEl)

  // ── Render loop ───────────────────────────────────────────────────────────
  let lastTime=0
  function animate(now) {
    requestAnimationFrame(animate)
    const dt=Math.min((now-lastTime)/1000,0.05); lastTime=now
    const ns=now/1000
    clock.getDelta()
    const t=clock.elapsedTime

    smoothT+=(scrollT-smoothT)*0.08
    if(Math.abs(scrollT-smoothT)<0.0001)smoothT=scrollT

    applyPose(smoothT)


    // Keep sky sphere centred on sky camera
    skySphereMesh.position.copy(camera.position)

    // Cloud parallax — drone-about-v6 exact logic
    _camDelta.copy(camera.position).sub(cloudCamStart).multiplyScalar(CLOUD_PARALLAX)
    cloudGroup.position.copy(_camDelta)
    cloudGroup.scale.setScalar(camera.fov/15)
    for(const cm of cloudMeshes)cm.lookAt(camera.position)

    // Drone bob + scroll offset
    if(droneObject){
      droneOffset.x=droneOffsetPos1.x+(droneOffsetPos2.x-droneOffsetPos1.x)*smoothT
      droneOffset.z=droneOffsetPos1.z+(droneOffsetPos2.z-droneOffsetPos1.z)*smoothT
      const bob=Math.sin(t*(2*Math.PI)/bobCfg.bobPeriod)
      const stallWave=Math.cos(t*(2*Math.PI)/bobCfg.stallPeriod)
      const stall=1.0-bobCfg.stallDepth*stallWave*stallWave
      droneObject.position.set(
        droneBasePos.x+droneOffset.x,
        droneBasePos.y+droneOffset.y+bob*bobCfg.bobAmp*stall,
        droneBasePos.z+droneOffset.z
      )
      droneObject.rotation.set(
        droneBaseRot.x+Math.cos(t*(2*Math.PI)/bobCfg.bobPeriod)*stall*bobCfg.pitchAmp,
        droneBaseRot.y, droneBaseRot.z
      )
    }

    // ── Day → night transition driven by scroll ────────────────────────────
    // Mirrors drone-about-v6: drop exposure sharply + rotate env so HDR
    // lighting swings to the dark side. ACES naturally desaturates + crushes
    // the image as exposure falls — no CSS filter needed.
    const nightT = THREE.MathUtils.smoothstep(smoothT, 0.5, 1.0)
    renderer.domElement.style.filter = ""
    // Exposure: 3.2 (day) → 0.4 (night) — ACES makes this look very dark/blue
    const currentExposure = 3.2 - nightT * 2.8
    // Sky brightness tracks the same curve so background darkens in sync
    skyMat.uniforms.uExposure.value = 1.0 - nightT * 0.88
    // Env rotation: shift Y by +120° so HDR warm key light swings away
    if (scene.environmentRotation) {
      const baseY = 1960 * Math.PI / 180
      scene.environmentRotation.y = baseY + nightT * (120 * Math.PI / 180)
    }

    // ── Cloud fade — 80% → 100% scroll ────────────────────────────────────
    const cloudFade = 1.0 - THREE.MathUtils.smoothstep(smoothT, 0.8, 1.0)
    for(const cm of cloudMeshes) cm.material.uniforms.uOpacity.value = (cm._baseOpacity ?? 0.85) * cloudFade

    // ── Two-pass render (drone-about-v6 exact approach) ────────────────────
    // Pass 1: sky — no tone mapping so image renders at true colors
    renderer.toneMapping = THREE.NoToneMapping
    renderer.autoClear = true
    renderer.render(skyScene, camera)
    // Pass 2: drone + clouds — ACESFilmic for PBR materials
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = currentExposure
    renderer.autoClear = false
    renderer.render(scene, camera)
    renderer.autoClear = true
  }
  requestAnimationFrame(animate)

    } // end initConnectScene
  })()

}) // end window load

} // end desktop guard
