/**
 * hero-background-scene.js  —  ES Module
 * Mounts the hero sky/topo background into #scene-background.
 * Scroll driven by GSAP ScrollTrigger on #scenes-track.
 */

const BG_ASSETS = {
  image: "https://webflow-zypsy.github.io/icarus/hero-background-image.webp",
}
const LOOP = { period: 45.0 }

import * as THREE from "three"
import { webglAvailable, activateFallback } from "./webgl-fallback.js"

/*function triggerHeroAnimation() {
  if (window.__heroAnimTriggered) return
  window.__heroAnimTriggered = true
  document.querySelector('.home-hero_animation-trigger')?.click()
}*/

if (!window.matchMedia("(min-width: 992px)").matches) {
  console.info("[bg-scene] Skipped — non-desktop viewport.")
} else {

window.addEventListener("load", () => {
  if (!window.matchMedia("(min-width: 992px)").matches) return
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
    console.error("[bg-scene] GSAP / ScrollTrigger not found."); return
  }
  gsap.registerPlugin(ScrollTrigger)

  const trackEl = document.getElementById("scenes-track")
  if (!trackEl) { console.error("[bg-scene] #scenes-track not found."); return }

  // Init when #scenes-track is near the viewport
  const lazyObserver = new IntersectionObserver(
    entries => { if (entries[0].isIntersecting) { lazyObserver.disconnect(); initScene() } },
    { rootMargin: "0px 0px 20% 0px", threshold: 0 }
  )
  lazyObserver.observe(trackEl)

  function initScene() {
    if (!webglAvailable()) { activateFallback('scene-background'); return }

    const mountEl = document.getElementById("scene-background")
    if (!mountEl) { console.error("[bg-scene] #scene-background not found."); return }

    let skyReady = false
    let skyA = null

    const scene  = new THREE.Scene()
    const initW  = mountEl.clientWidth  || window.innerWidth
    const initH  = mountEl.clientHeight || window.innerHeight
    const camera = new THREE.PerspectiveCamera(70, initW / initH, 0.1, 1000)

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false })
    } catch (e) {
      console.warn("[bg-scene] WebGLRenderer threw:", e.message)
      activateFallback('scene-background'); return
    }
    renderer.setSize(initW, initH)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setClearColor(0xffffff, 1)
    renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;"
    mountEl.appendChild(renderer.domElement)

    const DOME_H_FOV = 183.0 * Math.PI / 180.0

    function makeSkyMesh(tex) {
      const geo = new THREE.SphereGeometry(500, 32, 16)
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          tImage:       { value: tex },
          uOpacity:     { value: 1.0 },
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

    new THREE.TextureLoader().load(BG_ASSETS.image, tex => {
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
      skyA = makeSkyMesh(tex)
      renderer.setClearColor(0x000000, 1)
      skyReady = true
      triggerHeroAnimation()
    }, undefined, err => console.error("[bg-scene] Image load failed:", err))

    const poses = [
      { cam: new THREE.Vector3(-2.820, 1.965, -2.340), tgt: new THREE.Vector3(0, 0.3, 0) },
      { cam: new THREE.Vector3(-4.640, 3.510,  0.000), tgt: new THREE.Vector3(0, 0.3, 0) },
      { cam: new THREE.Vector3(-5.615, 5.250,  0.000), tgt: new THREE.Vector3(0, 0.3, 0) },
    ]

    const _cp = new THREE.Vector3(), _ct = new THREE.Vector3()
    let scrollT = 0, smoothT = 0

    function applyPose(t) {
      const cl = Math.max(0, Math.min(1, t)), seg = poses.length - 1, sc = cl * seg
      const i = Math.min(Math.floor(sc), seg - 1), f = sc - i
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
      const w = mountEl.clientWidth || window.innerWidth, h = mountEl.clientHeight || window.innerHeight
      camera.aspect = w / h; camera.updateProjectionMatrix()
      renderer.setSize(w, h); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    }).observe(mountEl)

    // One-shot animation state. Null means "not yet started this viewing".
    let animStartTime = null  // seconds timestamp when the current play began
    let animDone = false      // true once frac has reached 1.0

    function resetSkyAnim() {
      animStartTime = null
      animDone = false
      if (skyA) {
        skyA.mat.uniforms.uHOffset.value = 0.0
        skyA.mat.uniforms.uVOffset.value = 0.0
      }
    }

    let rafId = null, isVisible = true, lastTime = 0

    // Pause rendering when the scene is off-screen; reset animation so it
    // plays again from the start next time the scene enters the viewport.
    new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting
      if (!isVisible) {
        cancelAnimationFrame(rafId); rafId = null
        resetSkyAnim()
      } else if (rafId === null) {
        lastTime = performance.now()
        rafId = requestAnimationFrame(animate)
      }
    }, { threshold: 0.01 }).observe(mountEl)

    // Pause when the tab is hidden
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId); rafId = null
      } else if (isVisible && rafId === null) {
        lastTime = performance.now()
        rafId = requestAnimationFrame(animate)
      }
    })

    function animate(now) {
      rafId = requestAnimationFrame(animate)
      const dt = Math.min((now - lastTime) / 1000, 0.05); lastTime = now
      const ns = now / 1000

      smoothT += (scrollT - smoothT) * (1 - Math.exp(-18 * dt))
      if (Math.abs(scrollT - smoothT) < 0.0001) smoothT = scrollT
      applyPose(smoothT)

      if (skyA) {
        skyA.mesh.position.copy(camera.position)

        const ha = 0.06 * (1 - Math.min(smoothT / 0.3, 1))

        if (!animDone) {
          // Start the clock on the first frame the sky is visible
          if (animStartTime === null) animStartTime = ns

          const frac = Math.min((ns - animStartTime) / LOOP.period, 1.0)
          skyA.mat.uniforms.uHOffset.value = frac * ha
          skyA.mat.uniforms.uVOffset.value = -frac * 0.10

          // Clamp and freeze once the full period has elapsed
          if (frac >= 1.0) animDone = true
        } else {
          // Hold at the final pose indefinitely
          skyA.mat.uniforms.uHOffset.value = ha
          skyA.mat.uniforms.uVOffset.value = -0.10
        }
      }

      renderer.render(scene, camera)
    }

    rafId = requestAnimationFrame(animate)

  } // end initScene
}) // end window load

} // end desktop guard
