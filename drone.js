// drone.js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// ============================
// CONFIG
// ============================

const container = document.querySelector("#scene-drone");
if (!container) {
  console.warn("No #scene-drone found.");
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

scene.add(new THREE.AmbientLight(0xffffff, 1));

// ============================
// HDR
// ============================

new RGBELoader()
  .setPath("/assets/")
  .load("studio.hdr", (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
  });

// ============================
// DRONE MODEL
// ============================

let drone;

const loader = new GLTFLoader();
loader.load("/assets/drone.glb", (gltf) => {
  drone = gltf.scene;
  drone.scale.set(1, 1, 1);
  drone.position.set(0, 0, 0);
  scene.add(drone);
});

// ============================
// SCROLL CAMERA
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

const poses = [
  { pos: new THREE.Vector3(0, 2, 12), look: new THREE.Vector3(0, 0, 0) },
  { pos: new THREE.Vector3(2, 3, 8), look: new THREE.Vector3(0, 0, 0) },
  { pos: new THREE.Vector3(-2, 4, 6), look: new THREE.Vector3(0, 0, 0) }
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

  if (drone) {
    drone.rotation.y += 0.003;
  }

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
