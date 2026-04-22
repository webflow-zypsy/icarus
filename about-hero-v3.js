import {
  Scene, PerspectiveCamera, WebGLRenderer,
  BoxGeometry, ShaderMaterial, Mesh, DoubleSide,
  Color, TextureLoader, LinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping,
  Vector3, Vector2, Matrix4, Matrix3, Box3, BufferAttribute,
  WebGLRenderTarget, PlaneGeometry, OrthographicCamera,
  MeshPhysicalMaterial, HemisphereLight,
  CanvasTexture, EquirectangularReflectionMapping, SRGBColorSpace, NoColorSpace,
  RepeatWrapping, PMREMGenerator, Euler, ACESFilmicToneMapping, Quaternion,
} from "https://esm.sh/three@0.176.0"
import { GLTFLoader } from "https://esm.sh/three@0.176.0/examples/jsm/loaders/GLTFLoader.js"
import { DRACOLoader } from "https://esm.sh/three@0.176.0/examples/jsm/loaders/DRACOLoader.js"
import { RGBELoader } from "https://esm.sh/three@0.176.0/examples/jsm/loaders/RGBELoader.js"
import { webglAvailable, activateFallback } from "./webgl-fallback.js"

;(function () {

  // ---------- WebGL guard ----------
  if (!webglAvailable()) { activateFallback("about-hero"); return }

  // ---------- CDN asset URLs (same repo as drone-atf) ----------
  const SKY_URL   = "https://cdn.jsdelivr.net/gh/webflow-zypsy/icarus@main/green-512.hdr"
  const MODEL_URL = "https://cdn.jsdelivr.net/gh/webflow-zypsy/icarus@main/apollo-draco.glb"
  const FLOOR_URL = "https://cdn.jsdelivr.net/gh/webflow-zypsy/icarus@main/land-v2.webp"

  // ---------- Scene ----------
  const scene = new Scene()
  scene.background = new Color("#000000")

  // Fixed camera for cube/blur (never moves)
  const BASE_FOV = 45
  const DESIGN_ASPECT = 16 / 9
  function getCoverFov(aspect) {
    if (aspect >= DESIGN_ASPECT) return BASE_FOV
    return 2 * Math.atan(Math.tan(BASE_FOV * Math.PI / 360) * DESIGN_ASPECT / aspect) * 180 / Math.PI
  }
  const fixedCamera = new PerspectiveCamera(getCoverFov(innerWidth / innerHeight), innerWidth / innerHeight, 1, 5000)
  fixedCamera.position.set(3.0, -94.7, -12.0)
  fixedCamera.lookAt(-2.0, -100.1, 6.1)

  // Orbiting camera for drone
  const camera = new PerspectiveCamera(getCoverFov(innerWidth / innerHeight), innerWidth / innerHeight, 1, 5000)
  camera.position.set(-26.9, -87.9, 2.6)

  // ---------- Renderer ----------
  let renderer
  try {
    renderer = new WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(innerWidth, innerHeight)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 3.2
    // Canvas is position:absolute so #about-hero (overflow:hidden) clips it during the GSAP Flip.
    // Layout and z-index are owned by the Webflow/GSAP Flip container, not the canvas directly.
    renderer.domElement.style.position = "absolute"
    renderer.domElement.style.top = "50%"
    renderer.domElement.style.left = "50%"
    renderer.domElement.style.transform = "translate(-50%, -50%)"
  } catch (e) {
    activateFallback("about-hero"); return
  }

  // ---------- Mount to #about-hero (same pattern as drone-atf scene-drone) ----------
  let container = document.getElementById("about-hero")
  if (!container) {
    container = document.createElement("div")
    container.id = "about-hero"
    document.body.appendChild(container)
  }
  container.innerHTML = ""
  container.appendChild(renderer.domElement)

  const CUBE_SIZE = 200

  // ---------- Post-processing: horizon blur ----------
  const pr = Math.min(devicePixelRatio, 2)
  let rtW = Math.floor(innerWidth * pr)
  let rtH = Math.floor(innerHeight * pr)
  const renderTarget = new WebGLRenderTarget(rtW, rtH, { minFilter: LinearFilter, magFilter: LinearFilter })

  const blurQuadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const blurQuadGeo = new PlaneGeometry(2, 2)
  const blurMat = new ShaderMaterial({
    uniforms: {
      tScene:         { value: renderTarget.texture },
      uResolution:    { value: new Vector2(rtW, rtH) },
      uCubeCenter:    { value: new Vector3() },
      uCubeHalf:      { value: CUBE_SIZE / 2 },
      uCubeRotation:  { value: new Matrix4() },
      uCameraPos:     { value: new Vector3() },
      uInvViewMatrix: { value: new Matrix4() },
      uInvProjMatrix: { value: new Matrix4() },
      uBlurRadius:    { value: 30.0 },
      uBlurEdge:      { value: 0.05 },
      uBlurFalloff:   { value: 0.8 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tScene;
      uniform vec2  uResolution;
      uniform vec3  uCubeCenter;
      uniform float uCubeHalf;
      uniform mat4  uCubeRotation;
      uniform vec3  uCameraPos;
      uniform mat4  uInvViewMatrix;
      uniform mat4  uInvProjMatrix;
      uniform float uBlurRadius;
      uniform float uBlurEdge;
      uniform float uBlurFalloff;
      varying vec2  vUv;

      vec3 screenToRay(vec2 uv) {
        vec4 ndc = vec4(uv * 2.0 - 1.0, -1.0, 1.0);
        vec4 viewPos = uInvProjMatrix * ndc;
        viewPos.xyz /= viewPos.w;
        vec3 worldDir = (uInvViewMatrix * vec4(viewPos.xyz, 0.0)).xyz;
        return normalize(worldDir);
      }

      float cubeEdgeProximity(vec2 uv) {
        vec3 rayDir = screenToRay(uv);
        vec3 ro = uCameraPos - uCubeCenter;
        vec3 localRo = (uCubeRotation * vec4(ro, 1.0)).xyz;
        vec3 localRd = (uCubeRotation * vec4(rayDir, 0.0)).xyz;

        vec3 invRd = 1.0 / localRd;
        vec3 t1 = (-vec3(uCubeHalf) - localRo) * invRd;
        vec3 t2 = ( vec3(uCubeHalf) - localRo) * invRd;
        vec3 tMin = min(t1, t2);
        vec3 tMax = max(t1, t2);
        float tNear = max(max(tMin.x, tMin.y), tMin.z);
        float tFar  = min(min(tMax.x, tMax.y), tMax.z);

        if (tNear > tFar || tFar < 0.0) return 1.0;

        float tHit = tNear > 0.0 ? tNear : tFar;
        vec3 hitLocal = localRo + localRd * tHit;
        vec3 absHit = abs(hitLocal);

        float maxCoord = max(absHit.x, max(absHit.y, absHit.z));

        bool isFloor = (absHit.y == maxCoord && hitLocal.y < 0.0);

        float edgeDist;
        if (isFloor) {
          float dx = uCubeHalf - absHit.x;
          float dz = uCubeHalf - absHit.z;
          edgeDist = min(dx, dz) / uCubeHalf;
        } else {
          float dy = hitLocal.y + uCubeHalf;
          edgeDist = dy / (2.0 * uCubeHalf);
        }

        return clamp(edgeDist, 0.0, 1.0);
      }

      const int SAMPLES = 16;
      const float GOLDEN_ANGLE = 2.39996;

      void main() {
        float proximity = cubeEdgeProximity(vUv);

        float blurT = 1.0 - smoothstep(0.0, uBlurEdge, proximity);
        blurT = pow(blurT, uBlurFalloff);

        float radius = blurT * uBlurRadius;

        if (radius < 0.5) {
          gl_FragColor = texture2D(tScene, vUv);
          return;
        }

        vec2 texel = 1.0 / uResolution;
        vec3 sum = vec3(0.0);
        float weightSum = 0.0;

        for (int i = 0; i < SAMPLES; i++) {
          float fi = float(i);
          float r = sqrt((fi + 0.5) / float(SAMPLES)) * radius;
          float theta = fi * GOLDEN_ANGLE;
          vec2 offset = vec2(cos(theta), sin(theta)) * r * texel;
          sum += texture2D(tScene, vUv + offset).rgb;
          weightSum += 1.0;
        }

        gl_FragColor = vec4(sum / weightSum, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  })
  const blurQuad = new Mesh(blurQuadGeo, blurMat)
  const blurScene = new Scene()
  blurScene.add(blurQuad)

  // ---------- Post-processing: color correction ----------
  const blurTarget = new WebGLRenderTarget(rtW, rtH, { minFilter: LinearFilter, magFilter: LinearFilter })

  const ccMat = new ShaderMaterial({
    uniforms: {
      tInput:       { value: blurTarget.texture },
      uExposure:    { value: -0.27 },
      uContrast:    { value: -0.23 },
      uSaturation:  { value: -0.11 },
      uTemperature: { value: 0.33 },
      uTint:        { value: 0.0 },
      uHighlights:  { value: 0.10 },
      uShadows:     { value: -0.30 },
      uHDR:         { value: 0.63 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tInput;
      uniform float uExposure;
      uniform float uContrast;
      uniform float uSaturation;
      uniform float uTemperature;
      uniform float uTint;
      uniform float uHighlights;
      uniform float uShadows;
      uniform float uHDR;
      varying vec2 vUv;

      void main() {
        vec3 col = texture2D(tInput, vUv).rgb;

        if (uHDR > 0.001) {
          float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
          float shadowCrush = (1.0 - luma) * (1.0 - luma);
          col -= col * shadowCrush * uHDR * 0.5;
          float highlightBoost = luma * luma;
          col = mix(col, col * 1.3, highlightBoost * uHDR * 0.3);
          float boostedLuma = dot(col, vec3(0.2126, 0.7152, 0.0722));
          float sCurve = boostedLuma * boostedLuma * (3.0 - 2.0 * boostedLuma);
          sCurve = mix(boostedLuma, sCurve, uHDR * 0.7);
          col *= sCurve / max(boostedLuma, 0.001);
          float finalLuma = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(finalLuma), col, 1.0 + uHDR * 0.5);
          col.b += uHDR * 0.02;
        }

        col *= pow(2.0, uExposure);

        float c = uContrast + 1.0;
        col = (col - 0.18) * c + 0.18;

        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(lum), col, 1.0 + uSaturation);

        col.r += uTemperature * 0.1;
        col.b -= uTemperature * 0.1;

        col.g += uTint * 0.1;

        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        float highlightMask = smoothstep(0.5, 1.0, l);
        float shadowMask = 1.0 - smoothstep(0.0, 0.5, l);
        col += col * highlightMask * uHighlights;
        col += col * shadowMask * uShadows;

        col = clamp(col, 0.0, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  })
  const ccQuad = new Mesh(new PlaneGeometry(2, 2), ccMat)
  const ccScene = new Scene()
  ccScene.add(ccQuad)

  // ---------- Image / horizon orbit angles (driven by scroll blend) ----------
  let imageOrbitAngle = 0
  let horizonOrbitAngle = 0

  // Point drone camera at drone position
  camera.lookAt(-12.5, -93.5, 10.5)

  // ---------- Cube (world/horizon box) ----------
  const cubeGeo = new BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE, 64, 64, 64)
  const cubeMat = new ShaderMaterial({
    uniforms: {
      tFloor: { value: null },
      uHasFloor: { value: 0.0 },
      uAtmosHeight: { value: 0.08 },
      uAtmosFalloff: { value: 1.6 },
      uAtmosIntensity: { value: 1.10 },
      uAtmosInner: { value: new Color("#e0f2ff") },
      uAtmosOuter: { value: new Color("#315aaa") },
      uFloorOffsetX: { value: -0.11 },
      uFloorOffsetY: { value: 0.27 },
      uFloorScale: { value: 2.08 },
      uFloorRotation: { value: 0.01 },
      uStretchTop: { value: 0.0 },
      uStretchBottom: { value: 0.0 },
      uStretchLeft: { value: 0.0 },
      uStretchRight: { value: 0.0 },
      uSkewTop: { value: 0.0 },
      uSkewBottom: { value: 0.0 },
      uSkewLeft: { value: 0.0 },
      uSkewRight: { value: 0.0 },
      uFresnelColor: { value: new Color("#a8c2ff") },
      uFresnelPower: { value: 0.90 },
      uFresnelStrength: { value: 2.80 },
      uBgColor0: { value: new Color("#009bc2") },
      uBgPos0: { value: 0.0 },
      uBgColor1: { value: new Color("#21739c") },
      uBgPos1: { value: 0.12 },
      uBgColor2: { value: new Color("#000000") },
      uBgPos2: { value: 0.41 },
      uCurvature: { value: 3.5 },
      uCornerBlur: { value: 0.5 },
      uOrbitAngle: { value: 0.0 },
    },
    vertexShader: /* glsl */ `
      uniform float uCurvature;
      varying vec3 vLocalPos;
      varying vec3 vOrigLocalPos;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vDepth;
      varying vec4 vScreenPos;
      void main() {
        vec3 pos = position;
        vOrigLocalPos = position;
        float halfSize = ${(CUBE_SIZE / 2).toFixed(1)};
        if (pos.y < -halfSize + 0.5) {
          float dx = pos.x / halfSize;
          float dz = pos.z / halfSize;
          float d2 = dx * dx + dz * dz;
          float bump = uCurvature * (1.0 - d2 * 0.5);
          pos.y += max(bump, 0.0);
        }
        vLocalPos = pos;
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
        vViewDir = normalize(-mvPos.xyz);
        vDepth = -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
        vScreenPos = gl_Position;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tFloor;
      uniform float uHasFloor;
      uniform float uAtmosHeight;
      uniform float uAtmosFalloff;
      uniform float uAtmosIntensity;
      uniform vec3 uAtmosInner;
      uniform vec3 uAtmosOuter;
      uniform float uFloorOffsetX;
      uniform float uFloorOffsetY;
      uniform float uFloorScale;
      uniform float uFloorRotation;
      uniform float uStretchTop;
      uniform float uStretchBottom;
      uniform float uStretchLeft;
      uniform float uStretchRight;
      uniform float uSkewTop;
      uniform float uSkewBottom;
      uniform float uSkewLeft;
      uniform float uSkewRight;
      uniform vec3 uFresnelColor;
      uniform float uFresnelPower;
      uniform float uFresnelStrength;
      uniform vec3 uBgColor0;
      uniform float uBgPos0;
      uniform vec3 uBgColor1;
      uniform float uBgPos1;
      uniform vec3 uBgColor2;
      uniform float uBgPos2;
      uniform float uCornerBlur;
      uniform float uOrbitAngle;
      varying vec3 vLocalPos;
      varying vec3 vOrigLocalPos;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      varying float vDepth;
      varying vec4 vScreenPos;

      void main() {
        vec3 p = vLocalPos / ${CUBE_SIZE.toFixed(1)} + 0.5;
        float halfSize = ${(CUBE_SIZE / 2).toFixed(1)};

        if (vNormal.y < -0.5) {
          if (uHasFloor > 0.5) {
            vec2 ndc = vScreenPos.xy / vScreenPos.w;
            vec2 uv = ndc * 0.5 + 0.5;
            uv -= 0.5;
            float oa = uOrbitAngle;
            float co = cos(oa), so = sin(oa);
            uv = mat2(co, -so, so, co) * uv;
            uv += 0.5;
            uv -= 0.5;
            uv /= uFloorScale;
            float ca = cos(uFloorRotation), sa = sin(uFloorRotation);
            uv = mat2(ca, -sa, sa, ca) * uv;
            uv += 0.5 + vec2(uFloorOffsetX, uFloorOffsetY);
            vec3 col = texture2D(tFloor, clamp(uv, 0.0, 1.0)).rgb;
            float depthNorm = clamp((vDepth - 20.0) / 300.0, 0.0, 1.0);
            vec3 fresnel = uFresnelColor * pow(depthNorm, uFresnelPower) * uFresnelStrength;
            col += fresnel;
            gl_FragColor = vec4(col, 1.0);
          } else {
            gl_FragColor = vec4(0.01, 0.01, 0.02, 1.0);
          }
          return;
        }

        if (vNormal.y > 0.5) {
          gl_FragColor = vec4(uBgColor2, 1.0);
          return;
        }

        float yNorm = (vLocalPos.y + halfSize) / ${CUBE_SIZE.toFixed(1)};

        vec3 bg;
        if (yNorm <= uBgPos1) {
          bg = mix(uBgColor0, uBgColor1, clamp(yNorm / uBgPos1, 0.0, 1.0));
        } else {
          bg = mix(uBgColor1, uBgColor2, clamp((yNorm - uBgPos1) / (uBgPos2 - uBgPos1), 0.0, 1.0));
        }

        float atmosT = 1.0 - clamp(yNorm / uAtmosHeight, 0.0, 1.0);
        atmosT = pow(atmosT, uAtmosFalloff) * uAtmosIntensity;
        float gradientT = clamp(yNorm / uAtmosHeight, 0.0, 1.0);
        vec3 atmosCol = mix(uAtmosInner, uAtmosOuter, gradientT);

        vec3 col = bg + atmosCol * atmosT;

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: DoubleSide,
  })

  const cubeMesh = new Mesh(cubeGeo, cubeMat)
  cubeMesh.rotation.set(0.11, -0.05, -0.28)
  scene.add(cubeMesh)

  const cubeBaseEuler = cubeMesh.rotation.clone()
  const cubeBaseQuat = new Quaternion().setFromEuler(cubeBaseEuler)
  const viewAxis = new Vector3()
    .subVectors(new Vector3(-2.0, -100.1, 6.1), new Vector3(3.0, -94.7, -12.0))
    .normalize()

  // ---------- Scroll-driven keyframe system ----------
  // POS1 = scroll start, POS2 = scroll end
  // Order: DroneX,Y,Z, DroneRotX,Y,Z, HorizonX,Y,Z, HorizonRotX,Y,Z, ImgOffX,OffY,Scale,Rot, OrbitAngle, HorizonOrbit
  const POS1 = [-12.5, -93.5, 10.5, -1.81, 0.25, 0.00,   0,   0,   0,  0.11, -0.05, -0.28, -0.11, 0.27, 2.08,  0.01,  0,    0   ]
  const POS2 = [-12.5, -93.5, 10.5, -1.73, 0.17, -0.21, -24,  -3, -41,  0.00,  0.02, -0.18, -0.11, 0.27, 2.08, -0.18,  0.00, 0.00]

  // ---------- Scroll progress — driven by GSAP ScrollTrigger ----------
  // Raw progress is updated by ScrollTrigger; the animate loop smooths it with its own lerp.
  let heroScrollProgress = 0

  window.addEventListener("DOMContentLoaded", () => {
    const gsap = window.gsap
    const ScrollTrigger = window.ScrollTrigger
    if (!gsap || !ScrollTrigger) return

    gsap.registerPlugin(ScrollTrigger)

    ScrollTrigger.create({
      trigger: "[data-hero-flip-wrapper]",
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => { heroScrollProgress = self.progress },
    })
  })

  const droneBasePos = new Vector3(POS1[0], POS1[1], POS1[2])
  let droneBaseRotX = POS1[3]
  let droneBaseRotY = POS1[4]
  let droneBaseRotZ = POS1[5]
  const droneOffsetPx1 = { x: 76,  y: -20 }
  const droneOffsetPx2 = { x: 16,  y: -20 }

  function applyScrollBlend(t) {
    const lerp = (a, b) => a + (b - a) * t
    droneBasePos.x = lerp(POS1[0], POS2[0])
    droneBasePos.y = lerp(POS1[1], POS2[1])
    droneBasePos.z = lerp(POS1[2], POS2[2])
    droneBaseRotX  = lerp(POS1[3], POS2[3])
    droneBaseRotY  = lerp(POS1[4], POS2[4])
    droneBaseRotZ  = lerp(POS1[5], POS2[5])
    cubeMesh.position.x = lerp(POS1[6], POS2[6])
    cubeMesh.position.y = lerp(POS1[7], POS2[7])
    cubeMesh.position.z = lerp(POS1[8], POS2[8])
    cubeBaseEuler.x = lerp(POS1[9],  POS2[9]);  cubeBaseQuat.setFromEuler(cubeBaseEuler)
    cubeBaseEuler.y = lerp(POS1[10], POS2[10]); cubeBaseQuat.setFromEuler(cubeBaseEuler)
    cubeBaseEuler.z = lerp(POS1[11], POS2[11]); cubeBaseQuat.setFromEuler(cubeBaseEuler)
    cubeMat.uniforms.uFloorOffsetX.value  = lerp(POS1[12], POS2[12])
    cubeMat.uniforms.uFloorOffsetY.value  = lerp(POS1[13], POS2[13])
    cubeMat.uniforms.uFloorScale.value    = lerp(POS1[14], POS2[14])
    cubeMat.uniforms.uFloorRotation.value = lerp(POS1[15], POS2[15])
    imageOrbitAngle   = lerp(POS1[16], POS2[16])
    horizonOrbitAngle = lerp(POS1[17], POS2[17])
  }

  // ---------- Floor texture (from CDN) ----------
  function applyFloorFromSrc(src) {
    new TextureLoader().load(src, (t) => {
      t.minFilter = LinearMipmapLinearFilter
      t.magFilter = LinearFilter
      t.wrapS = ClampToEdgeWrapping
      t.wrapT = ClampToEdgeWrapping
      t.anisotropy = renderer.capabilities.getMaxAnisotropy()
      cubeMat.uniforms.tFloor.value = t
      cubeMat.uniforms.uHasFloor.value = 1.0
    })
  }
  applyFloorFromSrc(FLOOR_URL)

  // ---------- Slide drift (baked defaults from dev panel) ----------
  const slideSpeed     = 0.001
  const slideDirection = -0.55
  let slideElapsed = 0
  let slideDriftX  = 0
  let slideDriftY  = 0

  // One-shot animation state.
  // cumulativeDriftX/Y tracks the total offset added so far; it is frozen once
  // animDone is true and always re-applied on top of the scroll-blend base value.
  let cumulativeDriftX = 0
  let cumulativeDriftY = 0
  let animDone = false

  function resetSlideDrift() {
    slideElapsed     = 0
    slideDriftX      = 0
    slideDriftY      = 0
    cumulativeDriftX = 0
    cumulativeDriftY = 0
    animDone         = false
  }

  // ---------- Drone: textures, materials, lighting, env map, model ----------

  const generateWorldScaleUVs = (mesh, texelsPerUnit) => {
    const geo = mesh.geometry
    if (!geo) return
    const pos  = geo.attributes.position
    const norm = geo.attributes.normal
    if (!pos || !norm) return
    const uvs = new Float32Array(pos.count * 2)
    mesh.updateMatrixWorld(true)
    const _v = new Vector3()
    const _n = new Vector3()
    const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      _v.set(pos.getX(i), pos.getY(i), pos.getZ(i))
      _v.applyMatrix4(mesh.matrixWorld)
      _n.set(norm.getX(i), norm.getY(i), norm.getZ(i))
      _n.applyMatrix3(normalMatrix).normalize()
      const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z)
      let u, v
      if (ax >= ay && ax >= az)      { u = _v.y; v = _v.z }
      else if (ay >= ax && ay >= az) { u = _v.x; v = _v.z }
      else                           { u = _v.x; v = _v.y }
      uvs[i * 2]     = u * texelsPerUnit
      uvs[i * 2 + 1] = v * texelsPerUnit
    }
    geo.setAttribute("uv", new BufferAttribute(uvs, 2))
    geo.attributes.uv.needsUpdate = true
  }

  const makeCarbonFiberTextures = (opts = {}) => {
    const size = 512
    const towCount = opts.towCount || 32
    const towPx = size / towCount
    const gap = opts.gap || 1
    const makeCanvas = () => {
      const c = document.createElement("canvas")
      c.width = size; c.height = size
      return { c, ctx: c.getContext("2d") }
    }
    const { c: albedoC, ctx: a } = makeCanvas()
    a.fillStyle = "#1a1a1e"; a.fillRect(0, 0, size, size)
    for (let row = 0; row < towCount; row++) {
      for (let col = 0; col < towCount; col++) {
        const x = col * towPx, y = row * towPx
        const isWarpOver = ((col + row) % 4) < 2
        if (isWarpOver) {
          const base = 120 + Math.random() * 20
          a.fillStyle = `rgb(${base},${base},${base + 3})`
        } else {
          const base = 85 + Math.random() * 20
          a.fillStyle = `rgb(${base},${base},${base})`
        }
        a.fillRect(x + gap, y + gap, towPx - gap * 2, towPx - gap * 2)
        const strandCount = 5
        if (isWarpOver) {
          for (let s = 0; s < strandCount; s++) {
            const sx = x + gap + ((towPx - gap * 2) * (s + 0.5)) / strandCount
            a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`
            a.lineWidth = 0.8; a.beginPath(); a.moveTo(sx, y + gap); a.lineTo(sx, y + towPx - gap); a.stroke()
          }
        } else {
          for (let s = 0; s < strandCount; s++) {
            const sy = y + gap + ((towPx - gap * 2) * (s + 0.5)) / strandCount
            a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`
            a.lineWidth = 0.8; a.beginPath(); a.moveTo(x + gap, sy); a.lineTo(x + towPx - gap, sy); a.stroke()
          }
        }
      }
    }
    const { c: roughC, ctx: r } = makeCanvas()
    const baseRough = 90
    r.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`; r.fillRect(0, 0, size, size)
    for (let row = 0; row < towCount; row++) {
      for (let col = 0; col < towCount; col++) {
        const x = col * towPx, y = row * towPx
        const isWarpOver = ((col + row) % 4) < 2
        const v = isWarpOver ? baseRough - 6 + Math.random() * 4 : baseRough + 2 + Math.random() * 6
        r.fillStyle = `rgb(${v},${v},${v})`; r.fillRect(x + gap, y + gap, towPx - gap * 2, towPx - gap * 2)
      }
    }
    for (let row = 0; row < towCount; row++) {
      for (let col = 0; col < towCount; col++) {
        const x = col * towPx, y = row * towPx
        const gapRough = baseRough + 30
        r.fillStyle = `rgb(${gapRough},${gapRough},${gapRough})`
        r.fillRect(x, y, towPx, gap); r.fillRect(x, y, gap, towPx)
      }
    }
    const { c: normalC, ctx: n } = makeCanvas()
    n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, size, size)
    for (let row = 0; row < towCount; row++) {
      for (let col = 0; col < towCount; col++) {
        const x = col * towPx, y = row * towPx
        const isWarpOver = ((col + row) % 4) < 2
        const halfW = (towPx - gap * 2) / 2
        if (isWarpOver) {
          n.fillStyle = "rgba(110,128,255,0.45)"; n.fillRect(x + gap, y + gap, halfW, towPx - gap * 2)
          n.fillStyle = "rgba(146,128,255,0.45)"; n.fillRect(x + gap + halfW, y + gap, halfW, towPx - gap * 2)
          n.fillStyle = "rgba(128,115,255,0.3)";  n.fillRect(x + gap, y + gap, towPx - gap * 2, 2)
          n.fillStyle = "rgba(128,141,255,0.3)";  n.fillRect(x + gap, y + towPx - gap - 2, towPx - gap * 2, 2)
        } else {
          const halfH = (towPx - gap * 2) / 2
          n.fillStyle = "rgba(128,110,255,0.45)"; n.fillRect(x + gap, y + gap, towPx - gap * 2, halfH)
          n.fillStyle = "rgba(128,146,255,0.45)"; n.fillRect(x + gap, y + gap + halfH, towPx - gap * 2, halfH)
          n.fillStyle = "rgba(115,128,255,0.3)";  n.fillRect(x + gap, y + gap, 2, towPx - gap * 2)
          n.fillStyle = "rgba(141,128,255,0.3)";  n.fillRect(x + towPx - gap - 2, y + gap, 2, towPx - gap * 2)
        }
      }
    }
    for (let row = 0; row < towCount; row++) {
      for (let col = 0; col < towCount; col++) {
        const x = col * towPx, y = row * towPx
        n.fillStyle = "rgba(128,108,240,0.5)"; n.fillRect(x, y, towPx, gap)
        n.fillStyle = "rgba(108,128,240,0.5)"; n.fillRect(x, y, gap, towPx)
      }
    }
    const maxAniso = 16
    const buildTex = (canvas, isSRGB) => {
      const t = new CanvasTexture(canvas)
      if (isSRGB) t.colorSpace = SRGBColorSpace
      else        t.colorSpace = NoColorSpace
      t.wrapS = t.wrapT = RepeatWrapping
      t.generateMipmaps = true
      t.minFilter = LinearMipmapLinearFilter
      t.magFilter = LinearFilter
      t.anisotropy = maxAniso
      return t
    }
    return { albedo: buildTex(albedoC, true), rough: buildTex(roughC, false), normal: buildTex(normalC, false) }
  }

  const makeSolarPanelTextures = (opts = {}) => {
    const size = 512
    const cellCols = opts.cellCols || 4, cellRows = opts.cellRows || 6
    const cellGap = opts.cellGap || 10, busBarCount = opts.busBarCount || 5, fingerSpacing = opts.fingerSpacing || 4
    const cellW = (size - (cellCols + 1) * cellGap) / cellCols
    const cellH = (size - (cellRows + 1) * cellGap) / cellRows
    const makeCanvas = () => {
      const c = document.createElement("canvas"); c.width = size; c.height = size
      return { c, ctx: c.getContext("2d") }
    }
    const cX = (col) => cellGap + col * (cellW + cellGap)
    const cY = (row) => cellGap + row * (cellH + cellGap)
    const { c: albedoC, ctx: a } = makeCanvas()
    a.fillStyle = "#474751"; a.fillRect(0, 0, size, size)
    for (let row = 0; row < cellRows; row++) {
      for (let col = 0; col < cellCols; col++) {
        const x = cX(col), y = cY(row)
        const rv = Math.random() * 4 - 2
        a.fillStyle = `rgb(${6 + rv},${8 + rv},${18 + rv})`; a.fillRect(x, y, cellW, cellH)
        a.strokeStyle = "rgba(30,50,100,0.5)"; a.lineWidth = 2; a.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)
        const grad = a.createLinearGradient(x, y, x + cellW, y + cellH)
        grad.addColorStop(0, "rgba(40,50,90,0.08)"); grad.addColorStop(1, "rgba(20,25,50,0.08)")
        a.fillStyle = grad; a.fillRect(x, y, cellW, cellH)
        for (let b = 0; b < busBarCount; b++) {
          const barY = y + cellH * (b + 1) / (busBarCount + 1)
          a.strokeStyle = "rgba(50,50,58,0.95)"; a.lineWidth = 1.5
          a.beginPath(); a.moveTo(x, barY); a.lineTo(x + cellW, barY); a.stroke()
        }
        a.strokeStyle = "rgba(45,45,55,0.50)"; a.lineWidth = 0.5
        for (let fx = x + fingerSpacing; fx < x + cellW; fx += fingerSpacing) {
          a.beginPath(); a.moveTo(fx, y); a.lineTo(fx, y + cellH); a.stroke()
        }
        for (let b = 0; b < busBarCount; b++) {
          const barY = y + cellH * (b + 1) / (busBarCount + 1)
          for (let fx = x + fingerSpacing * 3; fx < x + cellW; fx += fingerSpacing * 4) {
            a.save(); a.translate(fx, barY); a.rotate(Math.PI / 4)
            a.fillStyle = "rgba(55,55,65,0.7)"; a.fillRect(-1.5, -1.5, 3, 3); a.restore()
          }
        }
      }
    }
    const { c: roughC, ctx: r } = makeCanvas()
    r.fillStyle = "rgb(90,90,90)"; r.fillRect(0, 0, size, size)
    for (let row = 0; row < cellRows; row++) {
      for (let col = 0; col < cellCols; col++) {
        const x = cX(col), y = cY(row)
        const cv = 50 + Math.random() * 5
        r.fillStyle = `rgb(${cv},${cv},${cv})`; r.fillRect(x, y, cellW, cellH)
        r.strokeStyle = "rgb(60,60,60)"; r.lineWidth = 2; r.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2)
        for (let b = 0; b < busBarCount; b++) {
          const barY = y + cellH * (b + 1) / (busBarCount + 1)
          r.strokeStyle = "rgb(30,30,30)"; r.lineWidth = 1.5
          r.beginPath(); r.moveTo(x, barY); r.lineTo(x + cellW, barY); r.stroke()
        }
      }
    }
    const { c: normalC, ctx: n } = makeCanvas()
    n.fillStyle = "rgb(128,128,255)"; n.fillRect(0, 0, size, size)
    for (let row = 0; row < cellRows; row++) {
      for (let col = 0; col < cellCols; col++) {
        const x = cX(col), y = cY(row)
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
    for (let row = 0; row < cellRows; row++) {
      for (let col = 0; col < cellCols; col++) {
        const x = cX(col), y = cY(row)
        n.fillStyle = "rgba(128,108,240,0.5)"; n.fillRect(x - cellGap, y - cellGap, cellW + cellGap * 2, cellGap)
        n.fillStyle = "rgba(108,128,240,0.5)"; n.fillRect(x - cellGap, y, cellGap, cellH)
      }
    }
    const maxAniso = 16
    const buildTex = (canvas, isSRGB) => {
      const t = new CanvasTexture(canvas)
      if (isSRGB) t.colorSpace = SRGBColorSpace
      else        t.colorSpace = NoColorSpace
      t.wrapS = t.wrapT = RepeatWrapping
      t.generateMipmaps = true; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter; t.anisotropy = maxAniso
      return t
    }
    return { albedo: buildTex(albedoC, true), rough: buildTex(roughC, false), normal: buildTex(normalC, false) }
  }

  const cfMatte  = makeCarbonFiberTextures({ glossy: false, towCount: 24 })
  const solarTex = makeSolarPanelTextures()

  const droneMats = {
    solarPanel: new MeshPhysicalMaterial({
      color: 0xffffff, map: solarTex.albedo,
      metalness: 0.08, roughness: 0.45, roughnessMap: solarTex.rough,
      clearcoat: 0.9, clearcoatRoughness: 0.05,
      normalMap: solarTex.normal, normalScale: new Vector2(0.4, 0.4),
      envMapIntensity: 0.5, side: DoubleSide, shadowSide: DoubleSide,
    }),
    carbonMatte: new MeshPhysicalMaterial({
      color: 0x6d6d6d, map: cfMatte.albedo,
      metalness: 0.0, roughness: 0.92, roughnessMap: cfMatte.rough,
      clearcoat: 0.0,
      normalMap: cfMatte.normal, normalScale: new Vector2(0.2, 0.2),
      envMapIntensity: 0.25, side: DoubleSide, shadowSide: DoubleSide,
    }),
    tailMatte: new MeshPhysicalMaterial({
      color: 0xc9c9c9, map: cfMatte.albedo,
      metalness: 0.0, roughness: 0.92, roughnessMap: cfMatte.rough,
      clearcoat: 0.0,
      normalMap: cfMatte.normal, normalScale: new Vector2(0.2, 0.2),
      envMapIntensity: 0.25, side: DoubleSide, shadowSide: DoubleSide,
    }),
  }

  const CF_DENSITY   = { matte: 40.0 }
  const SOLAR_DENSITY = 3.0

  const hemi = new HemisphereLight(0x8eafc2, 0x584838, 0.8)
  scene.add(hemi)

  // ---------- Environment map ----------
  const pmrem = new PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()

  new RGBELoader().load(SKY_URL, (texture) => {
    texture.mapping = EquirectangularReflectionMapping
    const envMap = pmrem.fromEquirectangular(texture).texture
    scene.environment = envMap
    scene.environmentRotation = new Euler(-840 * Math.PI / 180, 2070 * Math.PI / 180, 0)
    texture.dispose()
  })

  // ---------- Drone model ----------
  const MODEL_TUNING = { extraScale: 16.0, rotation: new Euler(-Math.PI / 2, 0, 0) }
  let droneObject = null

  const dracoLoader = new DRACOLoader()
  dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/")
  const gltfLoader = new GLTFLoader()
  gltfLoader.setDRACOLoader(dracoLoader)

  gltfLoader.load(MODEL_URL, (gltf) => {
    const object = gltf.scene
    object.position.set(0, 0, 0)
    object.rotation.set(0, 0, 0)

    const box    = new Box3().setFromObject(object)
    const size   = new Vector3()
    const center = new Vector3()
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

    const meshes = []
    object.traverse((child) => { if (child.isMesh) meshes.push(child) })

    for (const m of meshes) {
      if (m.geometry && !m.geometry.attributes.normal) m.geometry.computeVertexNormals()
      m.material = droneMats.carbonMatte
      m.castShadow = true
      m.receiveShadow = true
    }

    const wingMeshNames = new Set(["mesh73", "mesh100", "mesh76", "mesh103"])
    let namedAssigned = 0
    for (const m of meshes) {
      if (wingMeshNames.has(m.name)) { m.material = droneMats.solarPanel; namedAssigned++ }
    }
    if (namedAssigned === 0) {
      const scored = meshes.map((m) => {
        const bb = new Box3().setFromObject(m)
        const sz = new Vector3(); const ct = new Vector3()
        bb.getSize(sz); bb.getCenter(ct)
        const flatness  = sz.y / Math.max(sz.x, sz.z, 1e-6)
        const areaScore = sz.x * sz.z
        const outboard  = Math.abs(ct.x)
        return { m, score: areaScore * (1 / (flatness + 0.02)) * (0.6 + outboard) }
      }).sort((a, b) => b.score - a.score)
      for (let i = 0; i < Math.min(4, scored.length); i++) scored[i].m.material = droneMats.solarPanel
    }

    scene.add(object)
    object.updateMatrixWorld(true)
    for (const m of meshes) {
      const density = m.material === droneMats.solarPanel ? SOLAR_DENSITY : CF_DENSITY.matte
      generateWorldScaleUVs(m, density)
    }

    const tailMeshNames = new Set([
      "mesh159","mesh160","mesh161","mesh162","mesh163","mesh164",
      "mesh165","mesh166","mesh167","mesh168","mesh169","mesh170",
      "mesh171","mesh172","mesh173","mesh174","mesh175","mesh176",
      "mesh177","mesh178","mesh179","mesh180","mesh181","mesh182",
      "mesh183","mesh184",
    ])
    for (const m of meshes) {
      if (tailMeshNames.has(m.name)) m.material = droneMats.tailMatte
    }

    object.position.set(-12.5, -93.5, 10.5)
    object.rotation.set(-1.81, 0.25, 0.00)

    droneObject = object
  })

  // ---------- Resize ----------
  window.addEventListener("resize", () => {
    const aspect = innerWidth / innerHeight
    const fov = getCoverFov(aspect)
    fixedCamera.aspect = aspect; fixedCamera.fov = fov; fixedCamera.updateProjectionMatrix()
    camera.aspect = aspect;      camera.fov = fov;      camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
    const pr = Math.min(devicePixelRatio, 2)
    rtW = Math.floor(innerWidth * pr)
    rtH = Math.floor(innerHeight * pr)
    renderTarget.setSize(rtW, rtH)
    blurTarget.setSize(rtW, rtH)
    blurMat.uniforms.uResolution.value.set(rtW, rtH)
  })

  // ---------- Hover bob + stall ----------
  const bobCfg = {
    bobAmp:      0.0144,
    bobPeriod:   5.0,
    stallPeriod: 3.0,
    stallDepth:  0.0315,
    pitchAmp:    0.0027,
  }
  let bobTime  = 0
  let lastTime = performance.now()
  let smoothScrollT = 0

  // ---------- Render loop state ----------
  let rafId     = null
  let isVisible = true

  // Pause rendering when the hero is off-screen; reset the slide drift so it
  // plays from the start the next time the section enters the viewport.
  new IntersectionObserver(([entry]) => {
    isVisible = entry.isIntersecting
    if (!isVisible) {
      cancelAnimationFrame(rafId); rafId = null
      resetSlideDrift()
    } else if (rafId === null) {
      lastTime = performance.now()
      rafId = requestAnimationFrame(animate)
    }
  }, { threshold: 0.01 }).observe(container)

  // Pause when the tab is hidden
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId); rafId = null
    } else if (isVisible && rafId === null) {
      lastTime = performance.now()
      rafId = requestAnimationFrame(animate)
    }
  })

  // ---------- Animate ----------
  function animate() {
    rafId = requestAnimationFrame(animate)

    smoothScrollT += (heroScrollProgress - smoothScrollT) * 0.06
    const scrollT = smoothScrollT

    applyScrollBlend(scrollT)

    // Update orbit uniforms
    cubeMat.uniforms.uOrbitAngle.value = imageOrbitAngle

    // Rotate cube for horizon orbit
    const orbitQuat = new Quaternion().setFromAxisAngle(viewAxis, -horizonOrbitAngle)
    cubeMesh.quaternion.copy(orbitQuat).multiply(cubeBaseQuat)

    const now = performance.now()
    const dt  = (now - lastTime) / 1000
    lastTime  = now
    bobTime  += dt

    // Floor texture slide drift — one-shot: plays once over 20 s then holds at
    // the final offset. Resets to zero when the section leaves the viewport.
    if (slideSpeed > 0 && !animDone) {
      slideElapsed += dt
      if (slideElapsed >= 20) {
        animDone = true  // freeze; do not reset — hold the accumulated offset
      } else {
        slideDriftX += Math.cos(slideDirection) * slideSpeed * 0.01
        slideDriftY += Math.sin(slideDirection) * slideSpeed * 0.01
        cumulativeDriftX += slideDriftX
        cumulativeDriftY += slideDriftY
      }
    }
    // Always re-apply the frozen (or still-growing) cumulative drift on top of
    // the scroll-blend base that applyScrollBlend() just wrote this frame.
    cubeMat.uniforms.uFloorOffsetX.value += cumulativeDriftX
    cubeMat.uniforms.uFloorOffsetY.value += cumulativeDriftY

    // Drone hover bob
    if (droneObject) {
      const s = bobCfg
      const bobFreq   = (2 * Math.PI) / s.bobPeriod
      const bob       = Math.sin(bobTime * bobFreq)
      const stallFreq = (2 * Math.PI) / s.stallPeriod
      const stallWave = Math.cos(bobTime * stallFreq)
      const stall     = 1.0 - s.stallDepth * stallWave * stallWave
      const dy        = bob * s.bobAmp * stall * droneObject.scale.x
      const bobVelocity = Math.cos(bobTime * bobFreq) * stall

      droneObject.position.set(droneBasePos.x, droneBasePos.y + dy, droneBasePos.z)
      droneObject.rotation.set(droneBaseRotX + bobVelocity * s.pitchAmp, droneBaseRotY, droneBaseRotZ)

      const camFwd   = new Vector3().subVectors(droneBasePos, camera.position).normalize()
      const camRight = new Vector3().crossVectors(new Vector3(0, 1, 0), camFwd).normalize()
      const camUp    = new Vector3().crossVectors(camFwd, camRight).normalize()
      const dist     = camera.position.distanceTo(droneBasePos)
      const vFov     = camera.fov * Math.PI / 180
      const pxToWorld = (2 * dist * Math.tan(vFov / 2)) / innerHeight
      const blendedOffX = droneOffsetPx1.x + (droneOffsetPx2.x - droneOffsetPx1.x) * smoothScrollT
      const blendedOffY = droneOffsetPx1.y + (droneOffsetPx2.y - droneOffsetPx1.y) * smoothScrollT
      const ox = blendedOffX * pxToWorld
      const oy = blendedOffY * pxToWorld
      camera.lookAt(
        droneBasePos.x + camRight.x * ox + camUp.x * oy,
        droneBasePos.y + camRight.y * ox + camUp.y * oy,
        droneBasePos.z + camRight.z * ox + camUp.z * oy,
      )
    }

    // Update blur uniforms
    blurMat.uniforms.uCubeCenter.value.copy(cubeMesh.position)
    blurMat.uniforms.uCameraPos.value.copy(fixedCamera.position)
    blurMat.uniforms.uInvViewMatrix.value.copy(fixedCamera.matrixWorld)
    blurMat.uniforms.uInvProjMatrix.value.copy(fixedCamera.projectionMatrixInverse)
    const cubeInvRot = new Matrix4().makeRotationFromQuaternion(cubeMesh.quaternion).invert()
    blurMat.uniforms.uCubeRotation.value.copy(cubeInvRot)

    // 1) Render cube to texture (fixed camera)
    if (droneObject) droneObject.visible = false
    renderer.setRenderTarget(renderTarget)
    renderer.render(scene, fixedCamera)
    // 2) Apply horizon blur
    renderer.setRenderTarget(blurTarget)
    renderer.render(blurScene, blurQuadCam)
    // 3) Color correction to screen
    renderer.setRenderTarget(null)
    renderer.render(ccScene, blurQuadCam)
    // 4) Render drone on top (no blur)
    if (droneObject) {
      droneObject.visible = true
      cubeMesh.visible = false
      const savedBg = scene.background
      scene.background = null
      renderer.autoClear = false
      renderer.clearDepth()
      renderer.render(scene, camera)
      renderer.autoClear = true
      scene.background = savedBg
      cubeMesh.visible = true
    }
  }
  rafId = requestAnimationFrame(animate)

})()
