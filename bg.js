// background.js
import * as THREE from "three";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// ============================
// CONFIG
// ============================

const container = document.querySelector("#scene-background");
if (!container) {
  console.warn("No #scene-background found.");
  return;
}

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  35,
  container.clientWidth / container.clientHeight,
  0.1,
  200
);
camera.position.set(0, 2, 12);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true
});
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

// ============================
// LIGHTING
// ============================

const ambient = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambient);

// ============================
// HDR ENVIRONMENT
// ============================

new RGBELoader()
  .setPath("/assets/")
  .load("background.hdr", (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
  });

// ============================
// CAMERA SCROLL ANIMATION
// ============================

const scrollData = { t: 0 };

gsap.to(scrollData, {
  t: 1,
  ease: "none",
  scrollTrigger: {
    trigger: "#scenes-track",
    start: "top top",
    end: "bottom bottom",
    scrub: true
  }
});

// Camera keyframes
const poses = [
  { pos: new THREE.Vector3(0, 2, 12), look: new THREE.Vector3(0, 0, 0) },
  { pos: new THREE.Vector3(0, 4, 8), look: new THREE.Vector3(0, 1, 0) },
  { pos: new THREE.Vector3(0, 6, 4), look: new THREE.Vector3(0, 2, 0) }
];

function interpolateCamera(t) {
  const segment = t * (poses.length - 1);
  const index = Math.floor(segment);
  const lerpT = segment - index;

  const current = poses[index];
  const next = poses[Math.min(index + 1, poses.length - 1)];

  camera.position.lerpVectors(current.pos, next.pos, lerpT);

  const lookTarget = new THREE.Vector3().lerpVectors(
    current.look,
    next.look,
    lerpT
  );
  camera.lookAt(lookTarget);
}

// ============================
// RENDER LOOP
// ============================

function animate() {
  requestAnimationFrame(animate);

  interpolateCamera(scrollData.t);

  renderer.render(scene, camera);
}

animate();

// ============================
// RESIZE
// ============================

window.addEventListener("resize", () => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});
