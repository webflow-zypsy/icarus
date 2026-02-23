// Branch: greenland-image-3d
import {
  Scene, PerspectiveCamera, WebGLRenderer,
  PlaneGeometry, ShaderMaterial, Mesh, SphereGeometry,
  Vector2, Vector3, Color, LinearFilter, BackSide,
  TextureLoader, ClampToEdgeWrapping,
} from "three"

// ---------- Ease helpers ----------
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3)
}
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

// ---------- Animation state ----------
let skyReady = false
let bgTexture = null
let topoMesh = null
let topoMat = null
let topoGeo = null

const anim = {
  phase: "waiting", // 'waiting' | 'gridReveal' | 'fadeIn' | 'done'
  phaseStart: 0,
  gridRevealDuration: 1.3,   // matches drone wireframeDuration
  fadeInDuration: 0.8,        // matches drone fadeOutDuration
}

const scene = new Scene()

const camera = new PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
)

// Renderer — white clear color so background starts white instead of black
const renderer = new WebGLRenderer({ antialias: false })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.toneMapping = 0  // NoToneMapping — render image at true colors
renderer.setClearColor(0xffffff, 1)

// ---------- Background Sky Sphere ----------
// Half-dome equirectangular mapping: the 2D image wraps around the inside
// of a hemisphere, creating an immersive panoramic feel even from flat photos.
// The camera sits at the center looking outward into the dome.
const SKY_RADIUS = 500
const skyGeo = new SphereGeometry(SKY_RADIUS, 64, 32)

// Half-dome angular coverage (radians)
// hFov = horizontal wrap (PI = 180° half-dome, TWO_PI = full 360°)
// vFov = vertical wrap (computed from hFov / aspect to avoid stretch)
const DOME_H_FOV = 183.0 * Math.PI / 180.0  // 183° horizontal wrap

const skyMat = new ShaderMaterial({
  uniforms: {
    tImage:       { value: null },
    uOpacity:     { value: 0.0 },
    uCenterDir:   { value: new Vector3(0.642, -0.506, 0.576) },
    uHFov:        { value: DOME_H_FOV },
    uImageAspect: { value: 16.0 / 9.0 },
    uHOffset:     { value: 0.0 },
    uVOffset:     { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vLocalPos;

    void main() {
      vLocalPos = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tImage;
    uniform float uOpacity;
    uniform vec3 uCenterDir;
    uniform float uHFov;
    uniform float uImageAspect;
    uniform float uHOffset;
    uniform float uVOffset;

    varying vec3 vLocalPos;

    void main() {
      vec3 dir = normalize(vLocalPos);

      // Build orthonormal basis from center direction
      vec3 forward = normalize(uCenterDir);
      vec3 worldUp = abs(forward.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 right = normalize(cross(worldUp, forward));
      vec3 up = cross(forward, right);

      // Project view dir into the basis
      float dForward = dot(dir, forward);
      float dRight   = dot(dir, right);
      float dUp      = dot(dir, up);

      // Spherical angles relative to center direction
      float azimuth   = atan(dRight, dForward);  // horizontal angle from center
      float elevation = asin(clamp(dUp, -1.0, 1.0));  // vertical angle

      // Map angular range to [0,1] UVs
      float halfH = uHFov * 0.5;
      float vFov  = uHFov / uImageAspect;  // vertical FOV from aspect ratio
      float halfV = vFov * 0.5;

      float u = 1.0 - (azimuth / (2.0 * halfH) + 0.5);   // 180° rotation
      u += uHOffset;  // slow horizontal drift
      float v = 0.5 + elevation / (2.0 * halfV);          // 180° rotation
      v += uVOffset;  // slow vertical drift

      // Outside dome coverage — transparent
      if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        return;
      }

      // Soft edge fade
      float ew = 0.03;
      float edgeFade = smoothstep(0.0, ew, u) * smoothstep(0.0, ew, 1.0 - u)
                     * smoothstep(0.0, ew, v) * smoothstep(0.0, ew, 1.0 - v);

      vec4 texColor = texture2D(tImage, vec2(u, v));
      gl_FragColor = vec4(texColor.rgb, uOpacity * edgeFade);
    }
  `,
  side: BackSide,       // render inside of sphere
  transparent: true,
  depthWrite: false,
})

const skyMesh = new Mesh(skyGeo, skyMat)
skyMesh.renderOrder = -1000
scene.add(skyMesh)

// ---------- DOM ----------
let styleTag = document.getElementById("scroll-styles")
if (!styleTag) {
  styleTag = document.createElement("style")
  styleTag.id = "scroll-styles"
  document.head.appendChild(styleTag)
}
styleTag.textContent = `
  html, body { height: 100%; margin: 0; }
  body { overflow-x: hidden; }
  #canvas-wrap { position: fixed; inset: 0; z-index: 0; }
  #canvas-wrap canvas { width: 100%; height: 100%; display: block; }
  #scroll-spacer { position: relative; z-index: 1; pointer-events: none; }
`

let canvasWrap = document.getElementById("canvas-wrap")
if (!canvasWrap) {
  canvasWrap = document.createElement("div")
  canvasWrap.id = "canvas-wrap"
  document.body.appendChild(canvasWrap)
}
canvasWrap.innerHTML = ""
canvasWrap.appendChild(renderer.domElement)

// Scroll spacer for standalone testing (disabled inside iframes)
const isInIframe = window !== window.parent
if (!isInIframe) {
  let scrollSpacer = document.getElementById("scroll-spacer")
  if (!scrollSpacer) {
    scrollSpacer = document.createElement("div")
    scrollSpacer.id = "scroll-spacer"
    document.body.appendChild(scrollSpacer)
  }
  scrollSpacer.style.height = "200vh"
}

// ---------- Topographic wireframe terrain grid ----------
// A large plane in front of the camera, displaced by image luminance to form mountains.
const GRID_SEGMENTS = 180
const GRID_SIZE = 200
const GRID_OFFSET_X = -1.5
const GRID_OFFSET_Z = -1

topoGeo = new PlaneGeometry(GRID_SIZE, GRID_SIZE, GRID_SEGMENTS, GRID_SEGMENTS)
topoGeo.rotateX(-Math.PI / 2)

topoMat = new ShaderMaterial({
  uniforms: {
    tSky: { value: null },
    uOpacity: { value: 0.0 },
    uDisplacementScale: { value: 3.5 },
    uGridMin: { value: new Vector2(GRID_OFFSET_X - GRID_SIZE / 2, GRID_OFFSET_Z - GRID_SIZE / 2) },
    uGridMax: { value: new Vector2(GRID_OFFSET_X + GRID_SIZE / 2, GRID_OFFSET_Z + GRID_SIZE / 2) },
  },
  vertexShader: /* glsl */ `
    uniform sampler2D tSky;
    uniform float uDisplacementScale;
    uniform vec2 uGridMin;
    uniform vec2 uGridMax;
    varying float vLuminance;
    varying vec3 vWorldPos;

    void main() {
      vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;

      float u = (worldPos.x - uGridMin.x) / (uGridMax.x - uGridMin.x);
      float v = (worldPos.z - uGridMin.y) / (uGridMax.y - uGridMin.y);
      u = clamp(u, 0.0, 1.0);
      v = clamp(v, 0.0, 1.0);
      v = 1.0 - v;

      vec4 texSample = texture2D(tSky, vec2(u, v));
      float luminance = clamp(dot(texSample.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
      vLuminance = luminance;

      vec3 displaced = worldPos;
      displaced.y += luminance * uDisplacementScale;

      vWorldPos = displaced;
      gl_Position = projectionMatrix * viewMatrix * vec4(displaced, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uOpacity;
    varying float vLuminance;

    void main() {
      float brightness = 0.82 + vLuminance * 0.05;
      gl_FragColor = vec4(vec3(brightness), uOpacity);
    }
  `,
  wireframe: true,
  transparent: true,
  depthWrite: false,
})

topoMesh = new Mesh(topoGeo, topoMat)
topoMesh.position.set(GRID_OFFSET_X, -1, GRID_OFFSET_Z)
scene.add(topoMesh)

// ---------- Background Image ----------
const BASE_URL = (import.meta?.env?.BASE_URL ?? "/")
const baseWithSlash = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`
const BG_URL = new URL(`${baseWithSlash}bg/background-v2.webp`, window.location.href).toString()

new TextureLoader().load(
  BG_URL,
  (texture) => {
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.generateMipmaps = false
    texture.wrapS = ClampToEdgeWrapping
    texture.wrapT = ClampToEdgeWrapping
    // No colorSpace — pass raw pixel values through untouched
    bgTexture = texture

    // Feed to sky sphere + auto-detect aspect ratio
    skyMat.uniforms.tImage.value = texture
    skyMat.uniforms.uImageAspect.value = texture.image.width / texture.image.height

    // Feed to topo wireframe for displacement
    topoMat.uniforms.tSky.value = texture

    skyReady = true
  },
  undefined,
  (err) => console.error("Background image failed to load", err)
)

// ---------- Scroll-driven camera ----------
const poses = [
  { cam: new Vector3(-2.822, 1.964, -2.34),  tgt: new Vector3(0, 0.3, 0) },
  { cam: new Vector3(-4.641, 3.509, 0),       tgt: new Vector3(0, 0.3, 0) },
  { cam: new Vector3(-5.613, 11.412, 0),      tgt: new Vector3(0, 0.3, 0) },
]

const _camPos = new Vector3()
const _camTgt = new Vector3()
const _clearColor = new Color()
let scrollT = 0
let smoothT = 0

function applyPose(t) {
  const clamped = Math.max(0, Math.min(1, t))
  const segments = poses.length - 1
  const scaled = clamped * segments
  const i = Math.min(Math.floor(scaled), segments - 1)
  const frac = scaled - i

  _camPos.lerpVectors(poses[i].cam, poses[i + 1].cam, frac)
  _camTgt.lerpVectors(poses[i].tgt, poses[i + 1].tgt, frac)
  camera.position.copy(_camPos)
  camera.lookAt(_camTgt)
}

applyPose(0)

// Scroll input — native scroll (standalone) or postMessage (Framer iframe)
if (!isInIframe) {
  window.addEventListener("scroll", () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight
    scrollT = maxScroll > 0 ? window.scrollY / maxScroll : 0
  }, { passive: true })
}

window.addEventListener("message", (e) => {
  if (e.data && typeof e.data.scrollProgress === "number") {
    scrollT = e.data.scrollProgress
  }
})

// ---------- Resize ----------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

// ---------- Render loop ----------
let lastTime = 0
function animate(now) {
  const dt = Math.min((now - lastTime) / 1000, 0.05)
  lastTime = now
  const nowSec = now / 1000

  // Smooth scroll interpolation
  const rate = 1 - Math.exp(-18 * dt)
  smoothT += (scrollT - smoothT) * rate
  if (Math.abs(scrollT - smoothT) < 0.0001) smoothT = scrollT
  applyPose(smoothT)

  // Keep sky sphere centered on camera so it always surrounds the viewer
  skyMesh.position.copy(camera.position)

  // ---- Animation state machine ----
  if (anim.phase === "waiting" && skyReady) {
    anim.phase = "gridReveal"
    anim.phaseStart = nowSec
  }

  if (anim.phase === "gridReveal") {
    const elapsed = nowSec - anim.phaseStart
    const t = Math.min(elapsed / anim.gridRevealDuration, 1)
    const eased = easeInOutCubic(t)

    topoMat.uniforms.uOpacity.value = eased * 0.45

    if (t >= 1) {
      anim.phase = "fadeIn"
      anim.phaseStart = nowSec
    }
  } else if (anim.phase === "fadeIn") {
    const elapsed = nowSec - anim.phaseStart
    const t = Math.min(elapsed / anim.fadeInDuration, 1)
    const eased = easeOutCubic(t)

    // Crossfade: sky fades in, grid fades out, clear color shifts white→black
    skyMat.uniforms.uOpacity.value = eased
    if (topoMat) {
      topoMat.uniforms.uOpacity.value = 0.45 * (1 - eased)
    }
    const wb = 1 - eased
    renderer.setClearColor(_clearColor.setRGB(wb, wb, wb), 1)

    if (t >= 1) {
      anim.phase = "done"
      skyMat.uniforms.uOpacity.value = 1.0
      renderer.setClearColor(0x000000, 1)

      // Cleanup wireframe grid
      if (topoMesh) {
        scene.remove(topoMesh)
        topoGeo.dispose()
        topoMat.dispose()
        topoMesh = null
        topoGeo = null
        topoMat = null
      }
    }
  }
  // phase === "done": no animation work needed

  // Slow drift — amplitudes scale with scroll position
  const DRIFT_PERIOD = 40.0   // seconds per cycle
  const driftT = (nowSec % DRIFT_PERIOD) / DRIFT_PERIOD
  const hAmount = 0.06 * (1.0 - Math.min(smoothT / 0.3, 1.0))  // 6% → 0% over first 30% scroll
  skyMat.uniforms.uHOffset.value = driftT * hAmount
  skyMat.uniforms.uVOffset.value = -driftT * 0.10

  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
requestAnimationFrame(animate)

// ---------- DEBUG: WASD + ER controls ----------
// W/S = tilt up/down, A/D = pan left/right, R/E = dome width
// Values logged to console — copy them when happy
{
  const DEBUG_STEP_ANGLE = 0.02  // radians per keypress
  const DEBUG_STEP_FOV   = 0.05  // radians per keypress

  // Spherical coords for center direction
  // theta=0.840, phi=-0.530 from debug tuning
  let debugTheta = 0.840
  let debugPhi   = -0.530
  let debugHFov  = DOME_H_FOV

  function updateCenterDir() {
    const x = Math.sin(debugTheta) * Math.cos(debugPhi)
    const y = Math.sin(debugPhi)
    const z = Math.cos(debugTheta) * Math.cos(debugPhi)
    skyMat.uniforms.uCenterDir.value.set(x, y, z)
  }

  function logDebugValues() {
    const cd = skyMat.uniforms.uCenterDir.value
    const hDeg = (debugHFov * 180 / Math.PI).toFixed(0)
    console.log(
      `%c centerDir = (${cd.x.toFixed(3)}, ${cd.y.toFixed(3)}, ${cd.z.toFixed(3)})  |  hFov = ${hDeg}°  |  theta = ${debugTheta.toFixed(3)}  phi = ${debugPhi.toFixed(3)}`,
      "background: #222; color: #0f0; padding: 4px 8px; font-size: 13px;"
    )
  }

  updateCenterDir()

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase()
    let changed = false

    if (key === "a") { debugTheta -= DEBUG_STEP_ANGLE; changed = true }
    if (key === "d") { debugTheta += DEBUG_STEP_ANGLE; changed = true }
    if (key === "w") { debugPhi   += DEBUG_STEP_ANGLE; changed = true }
    if (key === "s") { debugPhi   -= DEBUG_STEP_ANGLE; changed = true }
    if (key === "r") { debugHFov = Math.max(0.3, debugHFov - DEBUG_STEP_FOV); changed = true }
    if (key === "e") { debugHFov = Math.min(Math.PI * 2, debugHFov + DEBUG_STEP_FOV); changed = true }

    if (changed) {
      debugPhi = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, debugPhi))
      updateCenterDir()
      skyMat.uniforms.uHFov.value = debugHFov
      logDebugValues()
    }
  })
}
