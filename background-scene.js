/**
 * background-scene.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Three.js background scene for Webflow.
 * Mounts into:  #scene-background
 * Scroll driven by GSAP ScrollTrigger, triggered on: #scenes-track
 *
 * ASSET URL — update to wherever background-v2.webp lives in Webflow:
 * ─────────────────────────────────────────────────────────────────────────────
 */

window.addEventListener("load", function () {
;(function () {
  "use strict"

  // ─── ASSET CONFIGURATION — update URL if you move the file ───────────────
  const BG_ASSETS = {
    image: "https://webflow-zypsy.github.io/icarus/background-v2.webp",
  }
  // ───────────────────────────────────────────────────────────────────────────

  // ── Bail if Three.js / GSAP aren't loaded ──────────────────────────────────
  if (typeof THREE === "undefined") {
    console.error("[bg-scene] THREE is not defined. Load three.js before this script.")
    return
  }
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") {
    console.error("[bg-scene] GSAP / ScrollTrigger not found.")
    return
  }
  gsap.registerPlugin(ScrollTrigger)

  // ── Mount element ──────────────────────────────────────────────────────────
  const mountEl = document.getElementById("scene-background")
  if (!mountEl) {
    console.error("[bg-scene] #scene-background not found.")
    return
  }

  // ── Ease helpers ───────────────────────────────────────────────────────────
  function easeOutCubic(t)    { return 1 - Math.pow(1 - t, 3) }
  function easeInOutCubic(t)  { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2 }

  // ── State ──────────────────────────────────────────────────────────────────
  let skyReady  = false
  let topoMesh  = null
  let topoMat   = null
  let topoGeo   = null

  const anim = {
    phase:               "waiting",  // 'waiting' | 'gridReveal' | 'fadeIn' | 'done'
    phaseStart:          0,
    gridRevealDuration:  1.3,
    fadeInDuration:      0.8,
  }

  // ── Scene / Camera ─────────────────────────────────────────────────────────
  const scene  = new THREE.Scene()
  const initW = mountEl.clientWidth  || window.innerWidth
  const initH = mountEl.clientHeight || window.innerHeight
  const camera = new THREE.PerspectiveCamera(
    70, initW / initH, 0.1, 1000
  )

  // ── Renderer → mount into #scene-background ───────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: false })
  renderer.setSize(initW, initH)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = 0          // NoToneMapping — true colors
  renderer.setClearColor(0xffffff, 1)
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;"
  mountEl.appendChild(renderer.domElement)

  // ── Sky sphere (equirectangular half-dome) ─────────────────────────────────
  const SKY_RADIUS  = 500
  const DOME_H_FOV  = 183.0 * Math.PI / 180.0

  const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 64, 32)
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      tImage:       { value: null },
      uOpacity:     { value: 0.0 },
      uCenterDir:   { value: new THREE.Vector3(0.642, -0.506, 0.576) },
      uHFov:        { value: DOME_H_FOV },
      uImageAspect: { value: 16.0 / 9.0 },
      uHOffset:     { value: 0.0 },
      uVOffset:     { value: 0.0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tImage;
      uniform float     uOpacity;
      uniform vec3      uCenterDir;
      uniform float     uHFov;
      uniform float     uImageAspect;
      uniform float     uHOffset;
      uniform float     uVOffset;
      varying vec3      vLocalPos;

      void main() {
        vec3 dir     = normalize(vLocalPos);
        vec3 forward = normalize(uCenterDir);
        vec3 worldUp = abs(forward.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 right   = normalize(cross(worldUp, forward));
        vec3 up      = cross(forward, right);

        float dForward  = dot(dir, forward);
        float dRight    = dot(dir, right);
        float dUp       = dot(dir, up);

        float azimuth   = atan(dRight, dForward);
        float elevation = asin(clamp(dUp, -1.0, 1.0));

        float halfH = uHFov * 0.5;
        float vFov  = uHFov / uImageAspect;
        float halfV = vFov * 0.5;

        float u = 1.0 - (azimuth / (2.0 * halfH) + 0.5) + uHOffset;
        float v = 0.5 + elevation / (2.0 * halfV) + uVOffset;

        if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
          return;
        }

        float ew      = 0.03;
        float edgeFade = smoothstep(0.0, ew, u) * smoothstep(0.0, ew, 1.0 - u)
                       * smoothstep(0.0, ew, v) * smoothstep(0.0, ew, 1.0 - v);

        vec4 texColor = texture2D(tImage, vec2(u, v));
        gl_FragColor  = vec4(texColor.rgb, uOpacity * edgeFade);
      }
    `,
    side:        THREE.BackSide,
    transparent: true,
    depthWrite:  false,
  })

  const skyMesh = new THREE.Mesh(skyGeo, skyMat)
  skyMesh.renderOrder = -1000
  scene.add(skyMesh)

  // ── Topographic wireframe terrain ──────────────────────────────────────────
  const GRID_SEGMENTS = 180
  const GRID_SIZE     = 200
  const GRID_OFFSET_X = -1.5
  const GRID_OFFSET_Z = -1

  topoGeo = new THREE.PlaneGeometry(GRID_SIZE, GRID_SIZE, GRID_SEGMENTS, GRID_SEGMENTS)
  topoGeo.rotateX(-Math.PI / 2)

  topoMat = new THREE.ShaderMaterial({
    uniforms: {
      tSky:               { value: null },
      uOpacity:           { value: 0.0 },
      uDisplacementScale: { value: 3.5 },
      uGridMin: { value: new THREE.Vector2(GRID_OFFSET_X - GRID_SIZE / 2, GRID_OFFSET_Z - GRID_SIZE / 2) },
      uGridMax: { value: new THREE.Vector2(GRID_OFFSET_X + GRID_SIZE / 2, GRID_OFFSET_Z + GRID_SIZE / 2) },
    },
    vertexShader: /* glsl */`
      uniform sampler2D tSky;
      uniform float     uDisplacementScale;
      uniform vec2      uGridMin;
      uniform vec2      uGridMax;
      varying float     vLuminance;
      varying vec3      vWorldPos;

      void main() {
        vec3  worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        float u = clamp((worldPos.x - uGridMin.x) / (uGridMax.x - uGridMin.x), 0.0, 1.0);
        float v = clamp(1.0 - (worldPos.z - uGridMin.y) / (uGridMax.y - uGridMin.y), 0.0, 1.0);

        vec4  texSample = texture2D(tSky, vec2(u, v));
        float luminance = clamp(dot(texSample.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
        vLuminance = luminance;

        vec3 displaced  = worldPos;
        displaced.y    += luminance * uDisplacementScale;
        vWorldPos       = displaced;
        gl_Position     = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uOpacity;
      varying float vLuminance;

      void main() {
        float brightness = 0.82 + vLuminance * 0.05;
        gl_FragColor = vec4(vec3(brightness), uOpacity);
      }
    `,
    wireframe:   true,
    transparent: true,
    depthWrite:  false,
  })

  topoMesh = new THREE.Mesh(topoGeo, topoMat)
  topoMesh.position.set(GRID_OFFSET_X, -1, GRID_OFFSET_Z)
  scene.add(topoMesh)

  // ── Load background image ──────────────────────────────────────────────────
  new THREE.TextureLoader().load(
    BG_ASSETS.image,
    (texture) => {
      texture.minFilter    = THREE.LinearFilter
      texture.magFilter    = THREE.LinearFilter
      texture.generateMipmaps = false
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping

      skyMat.uniforms.tImage.value       = texture
      skyMat.uniforms.uImageAspect.value = texture.image.width / texture.image.height
      topoMat.uniforms.tSky.value        = texture
      skyReady = true
    },
    undefined,
    (err) => console.error("[bg-scene] Background image failed to load:", err)
  )

  // ── Scroll-driven camera poses ─────────────────────────────────────────────
  const poses = [
    { cam: new THREE.Vector3(-2.822,  1.964,  -2.34), tgt: new THREE.Vector3(0, 0.3, 0) },
    { cam: new THREE.Vector3(-4.641,  3.509,      0), tgt: new THREE.Vector3(0, 0.3, 0) },
    { cam: new THREE.Vector3(-5.613, 11.412,      0), tgt: new THREE.Vector3(0, 0.3, 0) },
  ]

  const _camPos   = new THREE.Vector3()
  const _camTgt   = new THREE.Vector3()
  const _clearCol = new THREE.Color()
  let scrollT     = 0   // set by GSAP ScrollTrigger
  let smoothT     = 0

  function applyPose(t) {
    const clamped  = Math.max(0, Math.min(1, t))
    const segments = poses.length - 1
    const scaled   = clamped * segments
    const i        = Math.min(Math.floor(scaled), segments - 1)
    const frac     = scaled - i
    _camPos.lerpVectors(poses[i].cam, poses[i + 1].cam, frac)
    _camTgt.lerpVectors(poses[i].tgt, poses[i + 1].tgt, frac)
    camera.position.copy(_camPos)
    camera.lookAt(_camTgt)
  }

  applyPose(0)

  // ── GSAP ScrollTrigger — drives scrollT (0 → 1) ───────────────────────────
  ScrollTrigger.create({
    trigger:  "#scenes-track",
    start:    "top top",
    end:      "bottom bottom",
    scrub:    true,
    onUpdate: (self) => { scrollT = self.progress },
  })

  // ── Resize ─────────────────────────────────────────────────────────────────
  const resizeObserver = new ResizeObserver(() => {
    const w = mountEl.clientWidth, h = mountEl.clientHeight
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  })
  resizeObserver.observe(mountEl)

  // ── Render loop ────────────────────────────────────────────────────────────
  let lastTime = 0

  function animate(now) {
    requestAnimationFrame(animate)
    const dt   = Math.min((now - lastTime) / 1000, 0.05)
    lastTime   = now
    const nowSec = now / 1000

    // Smooth scroll
    smoothT += (scrollT - smoothT) * (1 - Math.exp(-18 * dt))
    if (Math.abs(scrollT - smoothT) < 0.0001) smoothT = scrollT
    applyPose(smoothT)

    // Sky sphere follows camera
    skyMesh.position.copy(camera.position)

    // ── Animation state machine (reveal on load) ───────────────────────────
    if (anim.phase === "waiting" && skyReady) {
      anim.phase = "gridReveal"
      anim.phaseStart = nowSec
    }

    if (anim.phase === "gridReveal") {
      const elapsed = nowSec - anim.phaseStart
      const t       = Math.min(elapsed / anim.gridRevealDuration, 1)
      topoMat.uniforms.uOpacity.value = easeInOutCubic(t) * 0.45
      if (t >= 1) { anim.phase = "fadeIn"; anim.phaseStart = nowSec }
    }
    else if (anim.phase === "fadeIn") {
      const elapsed = nowSec - anim.phaseStart
      const t       = Math.min(elapsed / anim.fadeInDuration, 1)
      const eased   = easeOutCubic(t)

      skyMat.uniforms.uOpacity.value = eased
      if (topoMat) topoMat.uniforms.uOpacity.value = 0.45 * (1 - eased)

      const wb = 1 - eased
      renderer.setClearColor(_clearCol.setRGB(wb, wb, wb), 1)

      if (t >= 1) {
        anim.phase = "done"
        skyMat.uniforms.uOpacity.value = 1.0
        renderer.setClearColor(0x000000, 1)
        // Cleanup wireframe grid
        if (topoMesh) {
          scene.remove(topoMesh)
          topoGeo.dispose(); topoMat.dispose()
          topoMesh = null; topoGeo = null; topoMat = null
        }
      }
    }
    // phase === "done": no extra animation work

    // Slow panoramic drift — fades out as user scrolls
    const DRIFT_PERIOD = 40.0
    const driftT  = (nowSec % DRIFT_PERIOD) / DRIFT_PERIOD
    const hAmount = 0.06 * (1.0 - Math.min(smoothT / 0.3, 1.0))
    skyMat.uniforms.uHOffset.value = driftT * hAmount
    skyMat.uniforms.uVOffset.value = -driftT * 0.10

    renderer.render(scene, camera)
  }
  requestAnimationFrame(animate)

})()

}) // end window load
