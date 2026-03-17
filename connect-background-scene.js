/**
 * connect-background-scene.js  —  ES Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Mounts the background sky scene into #connect-background.
 * Scroll driven by GSAP ScrollTrigger on #connect-track.
 *
 * Sky sphere shader, FOV, uCenterDir, and skyCamera position are taken
 * directly from drone-about-v6.js so the background matches that scene exactly.
 *
 * Key difference from scene 1 (background-scene.js):
 *   - DOME_H_FOV = 42° (telephoto crop, not 183° wide dome)
 *   - uCenterDir = (-0.621, -0.343, -0.705) — v6's exact tuned value
 *   - skyCamera quaternion syncs with the drone camera each frame so the
 *     background pans naturally as the drone camera moves
 *   - Intro uses same topo wireframe → sky fade sequence as scene 1
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CONNECT_BG_ASSETS = {
  image: "https://webflow-zypsy.github.io/icarus/vienna-mountains.webp",
}

import * as THREE from "three"

const DESKTOP_MQ = window.matchMedia("(min-width: 992px)")
if (!DESKTOP_MQ.matches) {
  console.info("[connect-bg] Skipped — non-desktop viewport.")
} else {

window.addEventListener("load", () => {
  if (!window.matchMedia("(min-width: 992px)").matches) { return }
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
    console.error("[connect-bg] GSAP / ScrollTrigger not found."); return
  }
  gsap.registerPlugin(ScrollTrigger)

  const mountEl = document.getElementById("connect-background")
  if (!mountEl) { console.error("[connect-bg] #connect-background not found."); return }

  const easeOut   = t => 1 - Math.pow(1-t, 3)
  const easeInOut = t => t < 0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2

  let skyReady = false
  let topoMesh = null, topoMat = null, topoGeo = null
  const anim = { phase:"waiting", phaseStart:0, gridRevealDuration:1.3, fadeInDuration:0.8 }

  const scene = new THREE.Scene()
  const initW = mountEl.clientWidth  || window.innerWidth
  const initH = mountEl.clientHeight || window.innerHeight

  // ── Main background camera — matches v6's skyCamera exactly ÷8 ───────────
  // v6 skyCamera: pos(-23.705, 16.498, -19.656) lookAt(0.6, 0.98, 0)
  // ÷8: pos(-2.963, 2.062, -2.457) lookAt(0.075, 0.123, 0)
  // FOV 15 — same as v6's skyCamera
  const camera = new THREE.PerspectiveCamera(15, initW/initH, 0.1, 1000)
  camera.position.set(-2.963, 2.062, -2.457)
  camera.lookAt(0.075, 0.123, 0)

  // ── Renderer — opaque (this is the background layer) ─────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: false })
  renderer.setSize(initW, initH)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(0xffffff, 1)
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;"
  mountEl.appendChild(renderer.domElement)

  // ── Sky sphere — exact values from drone-about-v6 ─────────────────────────
  // DOME_H_FOV = 42° (v6's exact value — telephoto crop of the mountain image)
  // uCenterDir = (-0.621, -0.343, -0.705) — v6's tuned center direction
  const DOME_H_FOV = 42.0 * Math.PI / 180.0

  let skyMesh = null, skyMat = null

  function makeSkyMesh(tex) {
    const geo = new THREE.SphereGeometry(500, 64, 32)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tImage:       { value: tex },
        uOpacity:     { value: 0.0 },
        uCenterDir:   { value: new THREE.Vector3(-0.621, -0.343, -0.705) },
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

  let skyA = null

  // ── Topo wireframe for intro (same as scene 1) ────────────────────────────
  const GS=180, GSZ=200, GOX=-1.5, GOZ=-1
  topoGeo = new THREE.PlaneGeometry(GSZ, GSZ, GS, GS); topoGeo.rotateX(-Math.PI/2)
  topoMat = new THREE.ShaderMaterial({
    uniforms:{
      tSky:{value:null}, uOpacity:{value:0.0}, uDisplacementScale:{value:3.5},
      uGridMin:{value:new THREE.Vector2(GOX-GSZ/2,GOZ-GSZ/2)},
      uGridMax:{value:new THREE.Vector2(GOX+GSZ/2,GOZ+GSZ/2)},
    },
    vertexShader:`
      uniform sampler2D tSky;uniform float uDisplacementScale;uniform vec2 uGridMin,uGridMax;
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
    fragmentShader:`uniform float uOpacity;varying float vL;void main(){gl_FragColor=vec4(vec3(0.82+vL*0.05),uOpacity);}`,
    wireframe:true, transparent:true, depthWrite:false,
  })
  topoMesh = new THREE.Mesh(topoGeo, topoMat)
  topoMesh.position.set(GOX,-1,GOZ)
  scene.add(topoMesh)

  // ── Load background image ─────────────────────────────────────────────────
  new THREE.TextureLoader().load(CONNECT_BG_ASSETS.image, tex => {
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    skyA = makeSkyMesh(tex)
    topoMat.uniforms.tSky.value = tex
    skyReady = true
  }, undefined, err => console.error("[connect-bg] Image load failed:", err))

  // ── Scroll state — synced with drone scene via same trigger ───────────────
  let scrollT = 0, smoothT = 0

  ScrollTrigger.create({
    trigger:"#connect-track", start:"top top", end:"bottom top", scrub:1,
    onUpdate:s=>{ scrollT=s.progress }
  })

  new ResizeObserver(()=>{
    const w=mountEl.clientWidth||window.innerWidth,h=mountEl.clientHeight||window.innerHeight
    camera.aspect=w/h; camera.updateProjectionMatrix()
    renderer.setSize(w,h); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
  }).observe(mountEl)

  // ── Loop state ────────────────────────────────────────────────────────────
  let cycleStart = 0
  const _cc = new THREE.Color()

  // ── Expose camera so drone scene can sync sky quaternion ──────────────────
  // The drone scene's camera quaternion is copied to this camera each frame
  // in drone-about-v6 style (skyCamera.quaternion.copy(camera.quaternion)).
  // We achieve the same by storing our camera on window so the drone scene
  // can find it, OR simply let this scene handle its own gentle pan.
  // Since these are two independent modules we implement a soft self-driven
  // pan that mirrors the camera movement direction implied by the drone poses.
  // The background pans left→right as scroll goes 0→1, matching v6 behaviour.

  // v6 skyCamera stays at its fixed position and only its quaternion rotates
  // with the main camera. We replicate that by keeping our camera at its
  // fixed position and applying a yaw that mirrors the drone camera's
  // movement arc (pose 0 → pose 1: camera sweeps right and slightly lower).
  // Yaw range derived from the angle between pose 0 and pose 1 projected
  // onto the XZ plane.
  const YAW_START =  0.0
  const YAW_END   = -0.12  // radians — matches the rightward pan of drone cam

  let lastTime = 0
  function animate(now) {
    requestAnimationFrame(animate)
    const dt = Math.min((now-lastTime)/1000, 0.05); lastTime = now
    const ns = now/1000

    smoothT += (scrollT-smoothT)*(1-Math.exp(-18*dt))
    if(Math.abs(scrollT-smoothT)<0.0001)smoothT=scrollT

    // Keep sky sphere centred on camera
    if(skyA) skyA.mesh.position.copy(camera.position)

    // Apply scroll-driven yaw to background camera to match drone cam movement
    // Reset camera orientation then apply yaw
    camera.position.set(-2.963, 2.062, -2.457)
    const yaw = YAW_START + (YAW_END-YAW_START)*smoothT
    camera.lookAt(
      0.075 + Math.sin(yaw)*5,
      0.123,
      -5 + Math.cos(yaw)*5
    )

    // ── Intro reveal ────────────────────────────────────────────────────────
    if(anim.phase==="waiting"&&skyReady){anim.phase="gridReveal";anim.phaseStart=ns}

    if(anim.phase==="gridReveal"){
      const t=Math.min((ns-anim.phaseStart)/anim.gridRevealDuration,1)
      topoMat.uniforms.uOpacity.value=easeInOut(t)*0.45
      if(t>=1){anim.phase="fadeIn";anim.phaseStart=ns}

    } else if(anim.phase==="fadeIn"){
      const t=Math.min((ns-anim.phaseStart)/anim.fadeInDuration,1),e=easeOut(t)
      if(skyA)skyA.mat.uniforms.uOpacity.value=e
      if(topoMat)topoMat.uniforms.uOpacity.value=0.45*(1-e)
      const wb=1-e; renderer.setClearColor(_cc.setRGB(wb,wb,wb),1)
      if(t>=1){
        anim.phase="running"; cycleStart=ns
        if(skyA)skyA.mat.uniforms.uOpacity.value=1.0
        renderer.setClearColor(0x000000,1)
        if(topoMesh){
          scene.remove(topoMesh);topoGeo.dispose();topoMat.dispose()
          topoMesh=topoGeo=topoMat=null
        }
      }

    } else if(anim.phase==="running"&&skyA){
      // Gentle ping-pong pan — same LOOP period as scene 1 (45s)
      // Amplitude kept small (0.02) because 42° FOV amplifies movement a lot
      const period = 45.0
      const totalT = ns-cycleStart
      const halfN  = Math.floor(totalT/period)
      const phase  = (totalT%period)/period
      const frac   = (halfN%2===0)?phase:1.0-phase
      skyA.mat.uniforms.uHOffset.value = frac*0.02
      skyA.mat.uniforms.uVOffset.value = -frac*0.05
    }

    renderer.render(scene, camera)
  }
  requestAnimationFrame(animate)
})

}
