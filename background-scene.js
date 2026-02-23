/**
 * background-scene.js  —  ES Module
 * Mounts Three.js background scene into #scene-background
 * Scroll driven by GSAP ScrollTrigger on #scenes-track
 * Load as: <script type="module" src="...background-scene.js"></script>
 */

// ─── ASSET URL ────────────────────────────────────────────────────────────────
const BG_ASSETS = {
  image: "https://webflow-zypsy.github.io/icarus/background-v2.webp",
}

import * as THREE from "three"

window.addEventListener("load", () => {
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
    console.error("[bg-scene] GSAP / ScrollTrigger not found."); return
  }
  gsap.registerPlugin(ScrollTrigger)

  const mountEl = document.getElementById("scene-background")
  if (!mountEl) { console.error("[bg-scene] #scene-background not found."); return }

  const easeOut    = t => 1 - Math.pow(1-t, 3)
  const easeInOut  = t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2

  let skyReady=false, topoMesh=null, topoMat=null, topoGeo=null
  const anim = { phase:"waiting", phaseStart:0, gridRevealDuration:1.3, fadeInDuration:0.8 }

  const scene  = new THREE.Scene()
  const initW  = mountEl.clientWidth  || window.innerWidth
  const initH  = mountEl.clientHeight || window.innerHeight
  const camera = new THREE.PerspectiveCamera(70, initW/initH, 0.1, 1000)

  const renderer = new THREE.WebGLRenderer({ antialias:false })
  renderer.setSize(initW, initH)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.NoToneMapping
  renderer.setClearColor(0xffffff, 1)
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;"
  mountEl.appendChild(renderer.domElement)

  // ── Sky sphere ────────────────────────────────────────────────────────────────
  const DOME_H_FOV = 183.0 * Math.PI / 180.0
  const skyGeo = new THREE.SphereGeometry(500, 64, 32)
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      tImage:      {value:null},
      uOpacity:    {value:0.0},
      uCenterDir:  {value:new THREE.Vector3(0.642,-0.506,0.576)},
      uHFov:       {value:DOME_H_FOV},
      uImageAspect:{value:16/9},
      uHOffset:    {value:0.0},
      uVOffset:    {value:0.0},
    },
    vertexShader:`
      varying vec3 vLP;
      void main(){ vLP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
    `,
    fragmentShader:`
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
    side:THREE.BackSide, transparent:true, depthWrite:false,
  })
  const skyMesh = new THREE.Mesh(skyGeo, skyMat)
  skyMesh.renderOrder = -1000
  scene.add(skyMesh)

  // ── Topo wireframe ────────────────────────────────────────────────────────────
  const GS=180, GSZ=200, GOX=-1.5, GOZ=-1
  topoGeo = new THREE.PlaneGeometry(GSZ,GSZ,GS,GS); topoGeo.rotateX(-Math.PI/2)
  topoMat = new THREE.ShaderMaterial({
    uniforms:{
      tSky:{value:null}, uOpacity:{value:0.0}, uDisplacementScale:{value:3.5},
      uGridMin:{value:new THREE.Vector2(GOX-GSZ/2,GOZ-GSZ/2)},
      uGridMax:{value:new THREE.Vector2(GOX+GSZ/2,GOZ+GSZ/2)},
    },
    vertexShader:`
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
    fragmentShader:`
      uniform float uOpacity; varying float vL;
      void main(){ gl_FragColor=vec4(vec3(0.82+vL*0.05),uOpacity); }
    `,
    wireframe:true, transparent:true, depthWrite:false,
  })
  topoMesh = new THREE.Mesh(topoGeo, topoMat)
  topoMesh.position.set(GOX,-1,GOZ)
  scene.add(topoMesh)

  // ── Load image ────────────────────────────────────────────────────────────────
  new THREE.TextureLoader().load(BG_ASSETS.image, tex=>{
    tex.minFilter=THREE.LinearFilter; tex.magFilter=THREE.LinearFilter
    tex.generateMipmaps=false; tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping
    skyMat.uniforms.tImage.value=tex
    skyMat.uniforms.uImageAspect.value=tex.image.width/tex.image.height
    topoMat.uniforms.tSky.value=tex
    skyReady=true
  }, undefined, err=>console.error("[bg-scene] Image load failed:",err))

  // ── Camera poses ──────────────────────────────────────────────────────────────
  const poses=[
    {cam:new THREE.Vector3(-2.822,1.964,-2.34),tgt:new THREE.Vector3(0,0.3,0)},
    {cam:new THREE.Vector3(-4.641,3.509,0),    tgt:new THREE.Vector3(0,0.3,0)},
    {cam:new THREE.Vector3(-5.613,11.412,0),   tgt:new THREE.Vector3(0,0.3,0)},
  ]
  const _cp=new THREE.Vector3(),_ct=new THREE.Vector3(),_cc=new THREE.Color()
  let scrollT=0,smoothT=0

  function applyPose(t){
    const cl=Math.max(0,Math.min(1,t)),seg=poses.length-1,sc=cl*seg,i=Math.min(Math.floor(sc),seg-1),f=sc-i
    _cp.lerpVectors(poses[i].cam,poses[i+1].cam,f); _ct.lerpVectors(poses[i].tgt,poses[i+1].tgt,f)
    camera.position.copy(_cp); camera.lookAt(_ct)
  }
  applyPose(0)

  ScrollTrigger.create({trigger:"#scenes-track",start:"top top",end:"bottom bottom",scrub:true,onUpdate:s=>{scrollT=s.progress}})

  new ResizeObserver(()=>{
    const w=mountEl.clientWidth||window.innerWidth,h=mountEl.clientHeight||window.innerHeight
    camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
  }).observe(mountEl)

  let lastTime=0
  function animate(now){
    requestAnimationFrame(animate)
    const dt=Math.min((now-lastTime)/1000,0.05); lastTime=now; const ns=now/1000
    smoothT+=(scrollT-smoothT)*(1-Math.exp(-18*dt)); if(Math.abs(scrollT-smoothT)<0.0001)smoothT=scrollT
    applyPose(smoothT); skyMesh.position.copy(camera.position)

    if(anim.phase==="waiting"&&skyReady){anim.phase="gridReveal";anim.phaseStart=ns}
    if(anim.phase==="gridReveal"){
      const t=Math.min((ns-anim.phaseStart)/anim.gridRevealDuration,1)
      topoMat.uniforms.uOpacity.value=easeInOut(t)*0.45
      if(t>=1){anim.phase="fadeIn";anim.phaseStart=ns}
    } else if(anim.phase==="fadeIn"){
      const t=Math.min((ns-anim.phaseStart)/anim.fadeInDuration,1),e=easeOut(t)
      skyMat.uniforms.uOpacity.value=e
      if(topoMat)topoMat.uniforms.uOpacity.value=0.45*(1-e)
      const wb=1-e; renderer.setClearColor(_cc.setRGB(wb,wb,wb),1)
      if(t>=1){
        anim.phase="done"; skyMat.uniforms.uOpacity.value=1.0; renderer.setClearColor(0x000000,1)
        if(topoMesh){scene.remove(topoMesh);topoGeo.dispose();topoMat.dispose();topoMesh=topoGeo=topoMat=null}
      }
    }

    const dp=40.0,dt2=(ns%dp)/dp,ha=0.06*(1-Math.min(smoothT/0.3,1))
    skyMat.uniforms.uHOffset.value=dt2*ha; skyMat.uniforms.uVOffset.value=-dt2*0.10
    renderer.render(scene,camera)
  }
  requestAnimationFrame(animate)
})
