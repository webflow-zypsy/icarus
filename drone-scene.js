/**
 * drone-scene.js  —  ES Module
 * Mounts Three.js drone scene into #scene-drone
 * Scroll driven by GSAP ScrollTrigger on #scenes-track
 * Requires importmap with "three" and "three/addons/" defined in <head>
 */

// ─── ASSET URLS ───────────────────────────────────────────────────────────────
const DRONE_ASSETS = {
  hdr:   "https://webflow-zypsy.github.io/icarus/green-512.hdr",
  model: "https://webflow-zypsy.github.io/icarus/apollo-draco.glb",
}

import * as THREE     from "three"
import { RGBELoader } from "three/addons/loaders/RGBELoader.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js"

window.addEventListener("load", () => {
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
    console.error("[drone-scene] GSAP / ScrollTrigger not found."); return
  }
  gsap.registerPlugin(ScrollTrigger)

  const mountEl = document.getElementById("scene-drone")
  if (!mountEl) { console.error("[drone-scene] #scene-drone not found."); return }

  const clock = new THREE.Clock(), scene = new THREE.Scene()
  let droneObject = null
  let droneBasePos = new THREE.Vector3(), droneBaseRot = new THREE.Euler()
  const bobCfg = { bobAmp:0.04, bobPeriod:5.0, stallPeriod:3.0, stallDepth:0.35, pitchAmp:0.0075 }

  const reveal = {
    active:false, startTime:0, wireframeDuration:1.3, fadeOutDuration:0.8, maxRadius:1,
    wireframeClones:[], wireframeMat:null,
    solidUniforms:{ revealRadius:{value:0} }, wireUniforms:{ revealRadius:{value:0} },
  }
  const easeOut = t => 1 - Math.pow(1-t, 3)

  function injectRevealShader(mat, uni) {
    mat.onBeforeCompile = s => {
      s.uniforms.revealRadius = uni.revealRadius
      s.vertexShader = s.vertexShader
        .replace("#include <common>","#include <common>\nvarying vec3 vRWP;")
        .replace("#include <fog_vertex>","#include <fog_vertex>\nvRWP=(modelMatrix*vec4(transformed,1.0)).xyz;")
      s.fragmentShader = s.fragmentShader
        .replace("#include <clipping_planes_pars_fragment>","#include <clipping_planes_pars_fragment>\nuniform float revealRadius;\nvarying vec3 vRWP;")
        .replace("vec4 diffuseColor = vec4( diffuse, opacity );","vec4 diffuseColor=vec4(diffuse,opacity);\nif(max(abs(vRWP.x),abs(vRWP.z))>revealRadius)discard;\n")
    }
    mat.customProgramCacheKey = ()=>"reveal"; mat.needsUpdate = true
  }

  function createWireClones(meshes, uni) {
    const mat = new THREE.MeshBasicMaterial({color:0xff7700,wireframe:true,transparent:true,opacity:0.6,depthWrite:false})
    injectRevealShader(mat, uni); reveal.wireframeMat = mat
    for (const m of meshes) {
      const c = new THREE.Mesh(m.geometry, mat)
      c.position.copy(m.position); c.rotation.copy(m.rotation); c.scale.copy(m.scale); c.renderOrder=-1
      ;(m.parent||m).add(c); reveal.wireframeClones.push(c)
    }
  }

  function cleanupReveal() {
    for (const c of reveal.wireframeClones) c.parent?.remove(c)
    reveal.wireframeClones.length = 0
    if (reveal.wireframeMat) { reveal.wireframeMat.dispose(); reveal.wireframeMat=null }
    for (const m of [droneMats.solarPanel,droneMats.carbonMatte,droneMats.tailMatte]) {
      m.onBeforeCompile=()=>{}; m.customProgramCacheKey=()=>""; m.needsUpdate=true
    }
    reveal.active = false
  }

  function genUVs(mesh, tpu) {
    const g=mesh.geometry; if(!g) return
    const pos=g.attributes.position, nor=g.attributes.normal; if(!pos||!nor) return
    const uvs=new Float32Array(pos.count*2)
    mesh.updateMatrixWorld(true)
    const _v=new THREE.Vector3(), _n=new THREE.Vector3()
    const nm=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
    for (let i=0;i<pos.count;i++) {
      _v.set(pos.getX(i),pos.getY(i),pos.getZ(i)).applyMatrix4(mesh.matrixWorld)
      _n.set(nor.getX(i),nor.getY(i),nor.getZ(i)).applyMatrix3(nm).normalize()
      const ax=Math.abs(_n.x),ay=Math.abs(_n.y),az=Math.abs(_n.z)
      let u,v
      if(ax>=ay&&ax>=az){u=_v.y;v=_v.z}else if(ay>=ax&&ay>=az){u=_v.x;v=_v.z}else{u=_v.x;v=_v.y}
      uvs[i*2]=u*tpu; uvs[i*2+1]=v*tpu
    }
    g.setAttribute("uv",new THREE.BufferAttribute(uvs,2)); g.attributes.uv.needsUpdate=true
  }

  function mkTex(canvas, cs) {
    const t=new THREE.CanvasTexture(canvas)
    t.colorSpace=cs; t.wrapS=t.wrapT=THREE.RepeatWrapping
    t.generateMipmaps=true; t.minFilter=THREE.LinearMipmapLinearFilter
    t.magFilter=THREE.LinearFilter; t.anisotropy=16; return t
  }

  function makeCF(opts={}) {
    const sz=512,tc=opts.towCount||32,tp=sz/tc,gap=opts.gap||1
    const mk=()=>{const c=document.createElement("canvas");c.width=c.height=sz;return{c,ctx:c.getContext("2d")}}
    const{c:aC,ctx:a}=mk(); a.fillStyle="#1a1a1e"; a.fillRect(0,0,sz,sz)
    for(let row=0;row<tc;row++) for(let col=0;col<tc;col++){
      const x=col*tp,y=row*tp,ov=((col+row)%4)<2,b=ov?120+Math.random()*20:85+Math.random()*20
      a.fillStyle=ov?`rgb(${b},${b},${b+3})`:`rgb(${b+2},${b},${b})`; a.fillRect(x+gap,y+gap,tp-gap*2,tp-gap*2)
      for(let s=0;s<5;s++){
        a.strokeStyle=`rgba(255,255,255,${0.03+Math.random()*0.04})`; a.lineWidth=0.8; a.beginPath()
        if(ov){const sx=x+gap+((tp-gap*2)*(s+.5))/5;a.moveTo(sx,y+gap);a.lineTo(sx,y+tp-gap)}
        else{const sy=y+gap+((tp-gap*2)*(s+.5))/5;a.moveTo(x+gap,sy);a.lineTo(x+tp-gap,sy)}
        a.stroke()
      }
    }
    const{c:rC,ctx:r}=mk(); r.fillStyle="rgb(90,90,90)"; r.fillRect(0,0,sz,sz)
    for(let row=0;row<tc;row++) for(let col=0;col<tc;col++){
      const x=col*tp,y=row*tp,ov=((col+row)%4)<2,v=ov?84+Math.random()*4:92+Math.random()*6
      r.fillStyle=`rgb(${v},${v},${v})`; r.fillRect(x+gap,y+gap,tp-gap*2,tp-gap*2)
      r.fillStyle="rgb(120,120,120)"; r.fillRect(x,y,tp,gap); r.fillRect(x,y,gap,tp)
    }
    const{c:nC,ctx:n}=mk(); n.fillStyle="rgb(128,128,255)"; n.fillRect(0,0,sz,sz)
    for(let row=0;row<tc;row++) for(let col=0;col<tc;col++){
      const x=col*tp,y=row*tp,ov=((col+row)%4)<2,hw=(tp-gap*2)/2
      if(ov){n.fillStyle="rgba(110,128,255,0.45)";n.fillRect(x+gap,y+gap,hw,tp-gap*2);n.fillStyle="rgba(146,128,255,0.45)";n.fillRect(x+gap+hw,y+gap,hw,tp-gap*2)}
      else{n.fillStyle="rgba(128,110,255,0.45)";n.fillRect(x+gap,y+gap,tp-gap*2,hw);n.fillStyle="rgba(128,146,255,0.45)";n.fillRect(x+gap,y+gap+hw,tp-gap*2,hw)}
      n.fillStyle="rgba(128,108,240,0.5)";n.fillRect(x,y,tp,gap+1);n.fillStyle="rgba(108,128,240,0.5)";n.fillRect(x,y,gap+1,tp)
    }
    return{albedo:mkTex(aC,THREE.SRGBColorSpace),rough:mkTex(rC,THREE.NoColorSpace),normal:mkTex(nC,THREE.NoColorSpace)}
  }

  function makeSolar() {
    const sz=512,cCols=4,cRows=6,cGap=10,busN=5,fSp=4
    const cW=(sz-(cCols+1)*cGap)/cCols,cH=(sz-(cRows+1)*cGap)/cRows
    const mk=()=>{const c=document.createElement("canvas");c.width=c.height=sz;return{c,ctx:c.getContext("2d")}}
    const cx=col=>cGap+col*(cW+cGap),cy=row=>cGap+row*(cH+cGap)
    const{c:aC,ctx:a}=mk(); a.fillStyle="#474751"; a.fillRect(0,0,sz,sz)
    for(let row=0;row<cRows;row++) for(let col=0;col<cCols;col++){
      const x=cx(col),y=cy(row),rv=Math.random()*4-2
      a.fillStyle=`rgb(${6+rv},${8+rv},${18+rv})`; a.fillRect(x,y,cW,cH)
      a.strokeStyle="rgba(30,50,100,0.5)"; a.lineWidth=2; a.strokeRect(x+1,y+1,cW-2,cH-2)
      for(let b=0;b<busN;b++){const barY=y+cH*(b+1)/(busN+1);a.strokeStyle="rgba(50,50,58,0.95)";a.lineWidth=1.5;a.beginPath();a.moveTo(x,barY);a.lineTo(x+cW,barY);a.stroke()}
      a.strokeStyle="rgba(45,45,55,0.5)"; a.lineWidth=0.5
      for(let fx=x+fSp;fx<x+cW;fx+=fSp){a.beginPath();a.moveTo(fx,y);a.lineTo(fx,y+cH);a.stroke()}
    }
    const{c:rC,ctx:r}=mk(); r.fillStyle="rgb(90,90,90)"; r.fillRect(0,0,sz,sz)
    for(let row=0;row<cRows;row++) for(let col=0;col<cCols;col++){const x=cx(col),y=cy(row),cv=50+Math.random()*5;r.fillStyle=`rgb(${cv},${cv},${cv})`;r.fillRect(x,y,cW,cH)}
    const{c:nC,ctx:n}=mk(); n.fillStyle="rgb(128,128,255)"; n.fillRect(0,0,sz,sz)
    for(let row=0;row<cRows;row++) for(let col=0;col<cCols;col++){
      const x=cx(col),y=cy(row)
      n.fillStyle="rgba(118,128,255,0.6)";n.fillRect(x,y,2,cH);n.fillStyle="rgba(138,128,255,0.6)";n.fillRect(x+cW-2,y,2,cH)
      n.fillStyle="rgba(128,118,255,0.6)";n.fillRect(x,y,cW,2);n.fillStyle="rgba(128,138,255,0.6)";n.fillRect(x,y+cH-2,cW,2)
    }
    return{albedo:mkTex(aC,THREE.SRGBColorSpace),rough:mkTex(rC,THREE.NoColorSpace),normal:mkTex(nC,THREE.NoColorSpace)}
  }

  const cf=makeCF({glossy:false,towCount:24}), sol=makeSolar()
  const droneMats = {
    solarPanel: new THREE.MeshPhysicalMaterial({color:0xffffff,map:sol.albedo,metalness:0.08,roughness:0.45,roughnessMap:sol.rough,clearcoat:0.9,clearcoatRoughness:0.05,normalMap:sol.normal,normalScale:new THREE.Vector2(0.4,0.4),envMapIntensity:0.5,side:THREE.DoubleSide}),
    carbonMatte:new THREE.MeshPhysicalMaterial({color:0x6d6d6d,map:cf.albedo,metalness:0.0,roughness:0.92,roughnessMap:cf.rough,clearcoat:0.0,normalMap:cf.normal,normalScale:new THREE.Vector2(0.2,0.2),envMapIntensity:0.25,side:THREE.DoubleSide}),
    tailMatte:  new THREE.MeshPhysicalMaterial({color:0xc9c9c9,map:cf.albedo,metalness:0.0,roughness:0.92,roughnessMap:cf.rough,clearcoat:0.0,normalMap:cf.normal,normalScale:new THREE.Vector2(0.2,0.2),envMapIntensity:0.25,side:THREE.DoubleSide}),
  }

  const initW=mountEl.clientWidth||window.innerWidth, initH=mountEl.clientHeight||window.innerHeight
  const camera=new THREE.PerspectiveCamera(15,initW/initH,0.1,1000)
  camera.position.set(0,1.2,5.2)
  const cameraTarget=new THREE.Vector3(0,0.3,0)

  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true})
  renderer.setSize(initW,initH); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
  renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure=3.2; renderer.setClearColor(0x000000,0)
  renderer.domElement.style.cssText="position:absolute;inset:0;width:100%;height:100%;display:block;"
  mountEl.appendChild(renderer.domElement)

  scene.add(new THREE.HemisphereLight(0x8eafc2,0x584838,0.8))

  const pmrem=new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader()
  new RGBELoader().load(DRONE_ASSETS.hdr, tex=>{
    tex.mapping=THREE.EquirectangularReflectionMapping
    scene.environment=pmrem.fromEquirectangular(tex).texture
    scene.environmentRotation=new THREE.Euler(-840*Math.PI/180,2070*Math.PI/180,0)
    tex.dispose()
  })

  const poses=[
    {cam:new THREE.Vector3(-1.482,1.031,-1.228),tgt:new THREE.Vector3(0,0.06,0)},
    {cam:new THREE.Vector3(-2.437,1.842,0),     tgt:new THREE.Vector3(0,0.06,0)},
    {cam:new THREE.Vector3(-1.829,2.323,0.003), tgt:new THREE.Vector3(0,0.06,0)},
  ]
  let scrollT=0,smoothT=0
  function applyPose(t){
    const cl=Math.max(0,Math.min(1,t)),seg=poses.length-1,sc=cl*seg,i=Math.min(Math.floor(sc),seg-1),f=sc-i
    const p=poses[i].cam.clone().lerp(poses[i+1].cam,f),q=poses[i].tgt.clone().lerp(poses[i+1].tgt,f)
    camera.position.set(p.x,p.y,p.z); cameraTarget.set(q.x,q.y,q.z); camera.lookAt(cameraTarget)
  }
  applyPose(0)

  ScrollTrigger.create({trigger:"#scenes-track",start:"top top",end:"bottom bottom",scrub:true,onUpdate:s=>{scrollT=s.progress}})

  const draco=new DRACOLoader(); draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
  const gltf=new GLTFLoader(); gltf.setDRACOLoader(draco)
  gltf.load(DRONE_ASSETS.model, g=>{
    const obj=g.scene; obj.position.set(0,0,0); obj.rotation.set(0,0,0)
    const box=new THREE.Box3().setFromObject(obj),bsz=new THREE.Vector3(),bctr=new THREE.Vector3()
    box.getSize(bsz); box.getCenter(bctr)
    const md=Math.max(bsz.x,bsz.y,bsz.z)
    if(isFinite(md)&&md>0){const s=1.4/md;obj.scale.setScalar(s);obj.position.sub(bctr.multiplyScalar(s))}
    obj.rotation.set(-Math.PI/2,0,0)
    droneBasePos.copy(obj.position); droneBaseRot.copy(obj.rotation); obj.updateMatrixWorld(true)

    const meshes=[];obj.traverse(c=>{if(c.isMesh)meshes.push(c)})
    for(const m of meshes){if(m.geometry&&!m.geometry.attributes.normal)m.geometry.computeVertexNormals();m.material=droneMats.carbonMatte}

    const wn=new Set(["mesh73","mesh100","mesh76","mesh103"]); let asgn=0
    for(const m of meshes){if(wn.has(m.name)){m.material=droneMats.solarPanel;asgn++}}
    if(asgn===0){
      const sc=meshes.map(m=>{const b=new THREE.Box3().setFromObject(m),s=new THREE.Vector3(),ct=new THREE.Vector3();b.getSize(s);b.getCenter(ct);return{m,score:s.x*s.z*(1/(s.y/Math.max(s.x,s.z,1e-6)+0.02))*(0.6+Math.abs(ct.x))}}).sort((a,b)=>b.score-a.score)
      for(let i=0;i<Math.min(4,sc.length);i++)sc[i].m.material=droneMats.solarPanel
    }

    scene.add(obj); obj.updateMatrixWorld(true)
    for(const m of meshes)genUVs(m,m.material===droneMats.solarPanel?3.0:40.0)

    const tn=new Set(["mesh159","mesh160","mesh161","mesh162","mesh163","mesh164","mesh165","mesh166","mesh167","mesh168","mesh169","mesh170","mesh171","mesh172","mesh173","mesh174","mesh175","mesh176","mesh177","mesh178","mesh179","mesh180","mesh181","mesh182","mesh183","mesh184"])
    for(const m of meshes){if(tn.has(m.name))m.material=droneMats.tailMatte}
    droneObject=obj

    const rb=new THREE.Box3().setFromObject(obj)
    reveal.maxRadius=(Math.max(Math.abs(rb.min.x),Math.abs(rb.max.x),Math.abs(rb.min.z),Math.abs(rb.max.z))||9)*1.05
    injectRevealShader(droneMats.solarPanel,reveal.solidUniforms)
    injectRevealShader(droneMats.carbonMatte,reveal.solidUniforms)
    injectRevealShader(droneMats.tailMatte,reveal.solidUniforms)
    createWireClones(meshes,reveal.wireUniforms)
    reveal.solidUniforms.revealRadius.value=0; reveal.wireUniforms.revealRadius.value=0
    reveal.startTime=clock.elapsedTime; reveal.active=true
  })

  new ResizeObserver(()=>{
    const w=mountEl.clientWidth||window.innerWidth,h=mountEl.clientHeight||window.innerHeight
    camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
  }).observe(mountEl)

  function animate(){
    requestAnimationFrame(animate); clock.getDelta(); const t=clock.elapsedTime
    smoothT+=(scrollT-smoothT)*0.06; if(Math.abs(scrollT-smoothT)<0.0001)smoothT=scrollT
    applyPose(smoothT)
    if(droneObject){
      const bob=Math.sin(t*(2*Math.PI)/bobCfg.bobPeriod)
      const stall=1-bobCfg.stallDepth*Math.pow(Math.cos(t*(2*Math.PI)/bobCfg.stallPeriod),2)
      droneObject.position.set(droneBasePos.x,droneBasePos.y+bob*bobCfg.bobAmp*stall,droneBasePos.z)
      droneObject.rotation.set(droneBaseRot.x+Math.cos(t*(2*Math.PI)/bobCfg.bobPeriod)*stall*bobCfg.pitchAmp,droneBaseRot.y,droneBaseRot.z)
    }
    if(reveal.active){
      const el=t-reveal.startTime,wl=Math.min(el/reveal.wireframeDuration,1)
      reveal.wireUniforms.revealRadius.value=easeOut(wl)*reveal.maxRadius
      reveal.solidUniforms.revealRadius.value=0
      if(wl>=1){const fl=Math.min((el-reveal.wireframeDuration)/reveal.fadeOutDuration,1);reveal.solidUniforms.revealRadius.value=easeOut(fl)*reveal.maxRadius*1.05;if(reveal.wireframeMat)reveal.wireframeMat.opacity=0.6*(1-easeOut(fl));if(fl>=1)cleanupReveal()}
    }
    const sp=Math.min(smoothT/0.5,1),gray=sp*0.30
    renderer.domElement.style.filter=gray>0.001?`grayscale(${gray}) contrast(${1-sp*0.1}) brightness(${1-sp*0.15})`:"none"
    if(scene.environmentRotation)scene.environmentRotation.y=2070*Math.PI/180+sp*15*Math.PI/180
    renderer.render(scene,camera)
  }
  animate()
})
