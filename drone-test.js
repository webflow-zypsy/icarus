import "./modulepreload-polyfill-B5Qt9EMX.js";
import { S as je, c as z, M as Ae, D as se, V as Oe, P as qe, W as ct, a as xe, A as dt, m as pt, n as Ye, o as ft, l as Ke, H as mt, b as ht, v as ut, h as gt, g as yt, E as be, T as Le, f as D, q as te, w as vt, G as wt, B as xt, d as J, e as Q, L as ee, N as ye, p as bt, i as Mt, j as St, C as Ct } from "./three-qkzU8FvL.js";
import { D as Et, G as Ft } from "./DRACOLoader-vjdbR7_p.js";
import { R as kt } from "./RGBELoader-5qm8pwqm.js";
import { O as Rt } from "./OrbitControls-BuFslVWb.js";
import { g as F } from "./index-DDlvirwQ.js";
import "./BufferGeometryUtils-BZ-SHm62.js";

const _e = new Ct(), S = new je();
let A = null, he = new z(0, 0, 0), ue = new be(0, 0, 0);
const Pt = { bobAmp: 0.04, bobPeriod: 5, stallPeriod: 3, stallDepth: 0.35, pitchAmp: 0.0075 };

const It = (t, i) => {
const n = t.geometry;
if (!n) return;
const o = n.attributes.position, e = n.attributes.normal;
if (!o || !e) return;
const r = new Float32Array(o.count * 2);
t.updateMatrixWorld(true);
const s = new z(), a = new z(), c = new Mt().getNormalMatrix(t.matrixWorld);

for (let l = 0; l < o.count; l++) {
s.set(o.getX(l), o.getY(l), o.getZ(l)); s.applyMatrix4(t.matrixWorld);
a.set(e.getX(l), e.getY(l), e.getZ(l)); a.applyMatrix3(c).normalize();
const v = Math.abs(a.x), k = Math.abs(a.y), y = Math.abs(a.z);
let f, R;
if (v >= k && v >= y) { f = s.y; R = s.z; }
else if (k >= v && k >= y) { f = s.x; R = s.z; }
else { f = s.x; R = s.y; }
r[l * 2 + 0] = f * i; r[l * 2 + 1] = R * i;
}
n.setAttribute("uv", new St(r, 2));
n.attributes.uv.needsUpdate = true;
};

const Tt = (t = {}) => {
const n = t.towCount || 32, o = 256 / n, e = t.gap || 1;
const r = () => { const d = document.createElement("canvas"); d.width = 256; d.height = 256; return { c: d, ctx: d.getContext("2d") }; };
const { c: s, ctx: a } = r();
a.fillStyle = "#1a1a1e"; a.fillRect(0, 0, 256, 256);
for (let d = 0; d < n; d++) {
for (let w = 0; w < n; w++) {
const u = w * o, g = d * o, E = (w + d) % 4 < 2;
if (E) { const h = 120 + Math.random() * 20; a.fillStyle = `rgb(${h},${h},${h + 3})`; }
else { const h = 85 + Math.random() * 20; a.fillStyle = `rgb(${h + 2},${h},${h})`; }
a.fillRect(u + e, g + e, o - e * 2, o - e * 2);
const p = 5;
if (E) {
for (let h = 0; h < p; h++) {
const m = u + e + (o - e * 2) * (h + 0.5) / p;
a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`;
a.lineWidth = 0.8; a.beginPath(); a.moveTo(m, g + e); a.lineTo(m, g + o - e); a.stroke();
}
} else {
for (let h = 0; h < p; h++) {
const m = g + e + (o - e * 2) * (h + 0.5) / p;
a.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`;
a.lineWidth = 0.8; a.beginPath(); a.moveTo(u + e, m); a.lineTo(u + o - e, m); a.stroke();
}
}
}
}
const { c, ctx: l } = r(), v = 90;
l.fillStyle = `rgb(${v},${v},${v})`; l.fillRect(0, 0, 256, 256);
for (let d = 0; d < n; d++) {
for (let w = 0; w < n; w++) {
const u = w * o, g = d * o, p = (w + d) % 4 < 2 ? v - 6 + Math.random() * 4 : v + 2 + Math.random() * 6;
l.fillStyle = `rgb(${p},${p},${p})`; l.fillRect(u + e, g + e, o - e * 2, o - e * 2);
}
}
for (let d = 0; d < n; d++) {
for (let w = 0; w < n; w++) {
const u = w * o, g = d * o, E = v + 30;
l.fillStyle = `rgb(${E},${E},${E})`; l.fillRect(u, g, o, e); l.fillRect(u, g, e, o);
}
}
const { c: k, ctx: y } = r();
y.fillStyle = "rgb(128,128,255)"; y.fillRect(0, 0, 256, 256);
for (let d = 0; d < n; d++) {
for (let w = 0; w < n; w++) {
const u = w * o, g = d * o;
if ((w + d) % 4 < 2) {
const p = (o - e * 2) / 2;
y.fillStyle = "rgba(110,128,255,0.45)"; y.fillRect(u + e, g + e, p, o - e * 2);
y.fillStyle = "rgba(146,128,255,0.45)"; y.fillRect(u + e + p, g + e, p, o - e * 2);
y.fillStyle = "rgba(128,115,255,0.3)"; y.fillRect(u + e, g + e, o - e * 2, 2);
y.fillStyle = "rgba(128,141,255,0.3)"; y.fillRect(u + e, g + o - e - 2, o - e * 2, 2);
} else {
const p = (o - e * 2) / 2;
y.fillStyle = "rgba(128,110,255,0.45)"; y.fillRect(u + e, g + e, o - e * 2, p);
y.fillStyle = "rgba(128,146,255,0.45)"; y.fillRect(u + e, g + e + p, o - e * 2, p);
y.fillStyle = "rgba(115,128,255,0.3)"; y.fillRect(u + e, g + e, 2, o - e * 2);
y.fillStyle = "rgba(141,128,255,0.3)"; y.fillRect(u + o - e - 2, g + e, 2, o - e * 2);
}
}
}
for (let d = 0; d < n; d++) {
for (let w = 0; w < n; w++) {
const u = w * o, g = d * o;
y.fillStyle = "rgba(128,108,240,0.5)"; y.fillRect(u, g, o, e + 1);
y.fillStyle = "rgba(108,128,240,0.5)"; y.fillRect(u, g, e + 1, o);
}
}
const f = 16, R = new J(s);
R.colorSpace = xe; R.wrapS = R.wrapT = Q; R.generateMipmaps = true; R.minFilter = ee; R.magFilter = D; R.anisotropy = f;
const b = new J(c);
b.colorSpace = ye; b.wrapS = b.wrapT = Q; b.generateMipmaps = true; b.minFilter = ee; b.magFilter = D; b.anisotropy = f;
const O = new J(k);
O.colorSpace = ye; O.wrapS = O.wrapT = Q; O.generateMipmaps = true; O.minFilter = ee; O.magFilter = D; O.anisotropy = f;
return { albedo: R, rough: b, normal: O };
};

const zt = (t = {}) => {
const n = t.cellCols || 4, o = t.cellRows || 6, e = t.cellGap || 10, r = t.busBarCount || 5, s = t.fingerSpacing || 4, a = (256 - (n + 1) * e) / n, c = (256 - (o + 1) * e) / o;
const l = () => { const p = document.createElement("canvas"); p.width = 256; p.height = 256; return { c: p, ctx: p.getContext("2d") }; };
const v = p => e + p * (a + e), k = p => e + p * (c + e);
const { c: y, ctx: f } = l();
f.fillStyle = "#474751"; f.fillRect(0, 0, 256, 256);
for (let p = 0; p < o; p++) {
for (let h = 0; h < n; h++) {
const m = v(h), M = k(p), L = Math.random() * 4 - 2;
f.fillStyle = `rgb(${6 + L}, ${8 + L}, ${18 + L})`; f.fillRect(m, M, a, c);
f.strokeStyle = "rgba(30, 50, 100, 0.5)"; f.lineWidth = 2; f.strokeRect(m + 1, M + 1, a - 2, c - 2);
const _ = f.createLinearGradient(m, M, m + a, M + c);
_.addColorStop(0, "rgba(40, 50, 90, 0.08)"); _.addColorStop(1, "rgba(20, 25, 50, 0.08)");
f.fillStyle = _; f.fillRect(m, M, a, c);
for (let P = 0; P < r; P++) {
const fe = M + c * (P + 1) / (r + 1);
f.strokeStyle = "rgba(50, 50, 58, 0.95)"; f.lineWidth = 1.5; f.beginPath(); f.moveTo(m, fe); f.lineTo(m + a, fe); f.stroke();
}
f.strokeStyle = "rgba(45, 45, 55, 0.50)"; f.lineWidth = 0.5;
for (let P = m + s; P < m + a; P += s) { f.beginPath(); f.moveTo(P, M); f.lineTo(P, M + c); f.stroke(); }
for (let P = 0; P < r; P++) {
const fe = M + c * (P + 1) / (r + 1);
for (let Ce = m + s * 3; Ce < m + a; Ce += s * 4) {
f.save(); f.translate(Ce, fe); f.rotate(Math.PI / 4);
f.fillStyle = "rgba(55, 55, 65, 0.7)"; f.fillRect(-1.5, -1.5, 3, 3); f.restore();
}
}
}
}
const { c: R, ctx: b } = l();
b.fillStyle = "rgb(90, 90, 90)"; b.fillRect(0, 0, 256, 256);
for (let p = 0; p < o; p++) {
for (let h = 0; h < n; h++) {
const m = v(h), M = k(p), L = 50 + Math.random() * 5;
b.fillStyle = `rgb(${L}, ${L}, ${L})`; b.fillRect(m, M, a, c);
b.strokeStyle = "rgb(60, 60, 60)"; b.lineWidth = 2; b.strokeRect(m + 1, M + 1, a - 2, c - 2);
for (let _ = 0; _ < r; _++) {
const P = M + c * (_ + 1) / (r + 1);
b.strokeStyle = "rgb(30, 30, 30)"; b.lineWidth = 1.5; b.beginPath(); b.moveTo(m, P); b.lineTo(m + a, P); b.stroke();
}
}
}
const { c: O, ctx: d } = l();
d.fillStyle = "rgb(128, 128, 255)"; d.fillRect(0, 0, 256, 256);
for (let p = 0; p < o; p++) {
for (let h = 0; h < n; h++) {
const m = v(h), M = k(p);
d.fillStyle = "rgba(118, 128, 255, 0.6)"; d.fillRect(m, M, 2, c);
d.fillStyle = "rgba(138, 128, 255, 0.6)"; d.fillRect(m + a - 2, M, 2, c);
d.fillStyle = "rgba(128, 118, 255, 0.6)"; d.fillRect(m, M, a, 2);
d.fillStyle = "rgba(128, 138, 255, 0.6)"; d.fillRect(m, M + c - 2, a, 2);
for (let L = 0; L < r; L++) {
const _ = M + c * (L + 1) / (r + 1);
d.fillStyle = "rgba(128, 118, 255, 0.4)"; d.fillRect(m, _ - 1, a, 1);
d.fillStyle = "rgba(128, 138, 255, 0.4)"; d.fillRect(m, _ + 1, a, 1);
}
}
}
for (let p = 0; p < o; p++) {
for (let h = 0; h < n; h++) {
const m = v(h), M = k(p);
d.fillStyle = "rgba(128, 108, 240, 0.5)"; d.fillRect(m - e, M - e, a + e * 2, e);
d.fillStyle = "rgba(108, 128, 240, 0.5)"; d.fillRect(m - e, M, e, c);
}
}
const w = 16, u = new J(y);
u.colorSpace = xe; u.wrapS = u.wrapT = Q; u.generateMipmaps = true; u.minFilter = ee; u.magFilter = D; u.anisotropy = w;
const g = new J(R);
g.colorSpace = ye; g.wrapS = g.wrapT = Q; g.generateMipmaps = true; g.minFilter = ee; g.magFilter = D; g.anisotropy = w;
const E = new J(O);
E.colorSpace = ye; E.wrapS = E.wrapT = Q; E.generateMipmaps = true; E.minFilter = ee; E.magFilter = D; E.anisotropy = w;
return { albedo: u, rough: g, normal: E };
};

const Ee = Tt({ glossy: false, towCount: 24 });
const Fe = zt();
const me = {
solarPanel: new Ae({ color: 16777215, map: Fe.albedo, metalness: 0.08, roughness: 0.45, roughnessMap: Fe.rough, clearcoat: 0.9, clearcoatRoughness: 0.05, normalMap: Fe.normal, normalScale: new Oe(0.4, 0.4), envMapIntensity: 0.5, side: se, shadowSide: se }),
carbonMatte: new Ae({ color: 7171437, map: Ee.albedo, metalness: 0, roughness: 0.92, roughnessMap: Ee.rough, clearcoat: 0, normalMap: Ee.normal, normalScale: new Oe(0.2, 0.2), envMapIntensity: 0.25, side: se, shadowSide: se })
};

const Dt = { matte: 40 };
const Lt = 3;
const C = new qe(15, window.innerWidth / window.innerHeight, 0.1, 1e3);
C.position.set(19.28, 16.29, 25.2);

const x = new ct({ antialias: true, alpha: true });
x.setSize(window.innerWidth, window.innerHeight);
x.setPixelRatio(Math.min(window.devicePixelRatio, 2));
x.outputColorSpace = xe;
x.toneMapping = dt;
x.toneMappingExposure = 3.2;
x.setClearColor(0, 0);

const $t = 500, At = new pt($t, 32, 16), Xe = 42 * Math.PI / 180;
const N = new Ye({
uniforms: {
tImage: { value: null }, tNightImage: { value: null }, uNightMix: { value: 0 },
uOpacity: { value: 1 }, uCenterDir: { value: new z(-0.621, -0.343, -0.705) },
uHFov: { value: Xe }, uImageAspect: { value: 16 / 9 }, uHOffset: { value: 0 }, uVOffset: { value: 0 }
},
vertexShader: "varying vec3 vLocalPos;\nvoid main() {\n  vLocalPos = position;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}",
fragmentShader: "uniform sampler2D tImage;\nuniform sampler2D tNightImage;\nuniform float uNightMix;\nuniform float uOpacity;\nuniform vec3 uCenterDir;\nuniform float uHFov;\nuniform float uImageAspect;\nuniform float uHOffset;\nuniform float uVOffset;\nvarying vec3 vLocalPos;\nvoid main() {\n  vec3 dir = normalize(vLocalPos);\n  vec3 forward = normalize(uCenterDir);\n  vec3 worldUp = abs(forward.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);\n  vec3 right = normalize(cross(worldUp, forward));\n  vec3 up = cross(forward, right);\n  float dForward = dot(dir, forward);\n  float dRight = dot(dir, right);\n  float dUp = dot(dir, up);\n  float azimuth = atan(dRight, dForward);\n  float elevation = asin(clamp(dUp, -1.0, 1.0));\n  float halfH = uHFov * 0.5;\n  float vFov = uHFov / uImageAspect;\n  float halfV = vFov * 0.5;\n  float u = azimuth / (2.0 * halfH) + 0.5;\n  u += uHOffset;\n  float v = 0.5 + elevation / (2.0 * halfV);\n  v += uVOffset;\n  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {\n    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);\n    return;\n  }\n  float ew = 0.03;\n  float edgeFade = smoothstep(0.0, ew, u) * smoothstep(0.0, ew, 1.0 - u) * smoothstep(0.0, ew, v) * smoothstep(0.0, ew, 1.0 - v);\n  vec2 uv = vec2(u, v);\n  vec3 dayColor = texture2D(tImage, uv).rgb;\n  vec3 nightColor = texture2D(tNightImage, vec2(1.0 - u, v)).rgb;\n  vec3 blended = mix(dayColor, nightColor, uNightMix);\n  gl_FragColor = vec4(blended, uOpacity * edgeFade);\n}",
side: ft, transparent: true, depthWrite: false
});

const Ze = new Ke(At, N);
Ze.renderOrder = -1e3;
const Je = new je();
Je.add(Ze);

const oe = new qe(15, window.innerWidth / window.innerHeight, 0.1, 1e3);
oe.position.set(-23.705, 16.498, -19.656);
oe.lookAt(0.6, 0.98, 0);

let Y = document.getElementById("connect-drone");
if (Y) {
Y.innerHTML = "";
Y.appendChild(x.domElement);
}

F.set(document.querySelectorAll("#hero-section .clip-char"), { yPercent: 110 });
F.set(document.querySelectorAll(".benefit-card .clip-char"), { yPercent: 110 });

const j = new Rt(C, x.domElement);
j.target.set(0.6, 0.98, 0); j.enableDamping = true; j.dampingFactor = 0.05; j.enableZoom = false; j.update();
let $e = false;
x.domElement.addEventListener("pointerdown", () => { $e = true; });

const de = new mt(9351106, 5785656, 0.8);
S.add(de);
const I = new ht(6061741, 0);
let pe = 219.2 * Math.PI / 180, U = 79.9 * Math.PI / 180;
const ke = 5.4;

function Qe() { I.position.set(ke * Math.sin(U) * Math.cos(pe), ke * Math.cos(U), ke * Math.sin(U) * Math.sin(pe)); }
Qe(); S.add(I);

const $ = new ut(16777215, 0, 50);
$.position.set(0, 3, 5); S.add($);

const Ot = "https://cdn.jsdelivr.net/gh/augustondreis/icarus@main/green-512.hdr";
const _t = "https://cdn.jsdelivr.net/gh/augustondreis/icarus@main/apollo-draco.glb";
const Wt = "https://cdn.jsdelivr.net/gh/augustondreis/icarus-connect@main/vienna-mountains.webp";
const Ht = "https://cdn.jsdelivr.net/gh/augustondreis/icarus-connect@main/night.webp";
const cloudUrl = "https://cdn.jsdelivr.net/gh/augustondreis/icarus-connect@main/cloud03-7.webp";

const Te = { extraScale: 16, rotation: new be(-Math.PI / 2, 0, 0) };

const et = new gt(x);
et.compileEquirectangularShader();
const Nt = new kt();
Nt.load(Ot, t => {
t.mapping = yt;
const i = et.fromEquirectangular(t).texture;
S.environment = i;
S.environmentRotation = new be(-1070 * Math.PI / 180, 1960 * Math.PI / 180, 0);
t.dispose();
});

new Le().load(Wt, t => {
t.minFilter = D; t.magFilter = D; t.generateMipmaps = false; t.wrapS = te; t.wrapT = te;
N.uniforms.tImage.value = t;
N.uniforms.uImageAspect.value = t.image.width / t.image.height;
});

new Le().load(Ht, t => {
t.minFilter = D; t.magFilter = D; t.generateMipmaps = false; t.wrapS = te; t.wrapT = te;
N.uniforms.tNightImage.value = t;
});

const Ut = 0.7, Bt = 0.25, ve = new wt();
S.add(ve);
const ze = [], Gt = new Le();
const Vt = "varying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}";
const jt = "uniform sampler2D tCloud;\nuniform float uOpacity;\nuniform float uEdgeFade;\nvarying vec2 vUv;\nvoid main() {\n  vec4 tex = texture2D(tCloud, vUv);\n  float fadeL = smoothstep(0.0, uEdgeFade, vUv.x);\n  float fadeR = smoothstep(0.0, uEdgeFade, 1.0 - vUv.x);\n  float fadeB = smoothstep(0.0, uEdgeFade, vUv.y);\n  float fadeT = smoothstep(0.0, uEdgeFade, 1.0 - vUv.y);\n  float edge = fadeL * fadeR * fadeB * fadeT;\n  gl_FragColor = vec4(tex.rgb, tex.a * uOpacity * edge);\n}";

function qt(t, i, n, o, e, r) {
Gt.load(t, s => {
s.colorSpace = xe;
const a = new Ye({ uniforms: { tCloud: { value: s }, uOpacity: { value: 0.85 }, uEdgeFade: { value: Bt } }, vertexShader: Vt, fragmentShader: jt, transparent: true, depthWrite: false, side: se });
const c = new bt(e, r), l = new Ke(c, a);
l.position.set(i, n, o); ve.add(l); ze.push(l);
});
}
qt(cloudUrl, -12, -4, -8, 28, 14);

const Yt = new z(19.28, 16.29, 25.2);
const tt = new Et();
tt.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
const ot = new Ft();
ot.setDRACOLoader(tt);

const ae = [{ cam: new z(19.28, 16.29, 25.2), tgt: new z(0.6, 0.98, 0) }, { cam: new z(24.92, 12.85, 22.04), tgt: new z(0.6, 0.98, 0) }];
let ce = 0, W = 0;
const We = new z(), Ne = new z(), He = new z();

function Kt(t) {
const i = Math.max(0, Math.min(1, t)), n = ae.length - 1, o = i * n, e = Math.min(Math.floor(o), n - 1), r = o - e;
return We.copy(ae[e].cam).lerp(ae[e + 1].cam, r), Ne.copy(ae[e].tgt).lerp(ae[e + 1].tgt, r), { pos: We, tgt: Ne };
}

ot.load(_t, t => {
const i = t.scene; i.position.set(0, 0, 0); i.rotation.set(0, 0, 0);
const n = new xt().setFromObject(i), o = new z(), e = new z();
n.getSize(o); n.getCenter(e);
const r = Math.max(o.x, o.y, o.z);
if (isFinite(r) && r > 0) { const v = 1.4 / r; i.scale.setScalar(v); i.position.sub(e.multiplyScalar(v)); } 
else i.scale.setScalar(1);

i.rotation.copy(Te.rotation); i.scale.multiplyScalar(Te.extraScale);
he.copy(i.position); ue.copy(i.rotation); V._baseScalar = i.scale.x; i.updateMatrixWorld(true);

const s = [];
i.traverse(l => { if (l.isMesh) s.push(l); });
for (const l of s) {
if (l.geometry && !l.geometry.attributes.normal) l.geometry.computeVertexNormals();
l.material = me.carbonMatte; l.castShadow = true; l.receiveShadow = true;
}
const a = new Set(["mesh73", "mesh100", "mesh76", "mesh103"]);
for (const l of s) { if (a.has(l.name)) l.material = me.solarPanel; }

S.add(i); i.updateMatrixWorld(true);
for (const l of s) { let v = Dt.matte; if (l.material === me.solarPanel) v = Lt; It(l, v); }

const c = new Set(["mesh159", "mesh160", "mesh161", "mesh162", "mesh163", "mesh164", "mesh165", "mesh166", "mesh167", "mesh168", "mesh169", "mesh170", "mesh171", "mesh172", "mesh173", "mesh174", "mesh175", "mesh176", "mesh177", "mesh178", "mesh179", "mesh180", "mesh181", "mesh182", "mesh183", "mesh184"]);
for (const l of s) { if (c.has(l.name)) l.material = me.carbonMatte; }
A = i;
});

const nt = 0, it = 0.08, at = (1 + nt) / 2 - it, rt = at + it, Xt = rt;
const re = { val: false, cardRevealed: [false, false, false] };
const Zt = { val: false, cardRevealed: [false, false, false] };

function ge(t) {
t.style.opacity = 1;
const i = t.querySelectorAll(".clip-char");
F.to(i, { yPercent: 0, duration: 0.7, stagger: 0.03, ease: "power3.out" });
const n = t.querySelector(".benefit-desc");
if (n) F.to(n, { opacity: 1, duration: 1, ease: "power2.out", delay: 0.2 });
}

function st(t) {
t.style.opacity = 0;
const i = t.querySelectorAll(".clip-char");
i.forEach(o => { F.killTweensOf(o); });
F.set(i, { yPercent: 110 });
const n = t.querySelector(".benefit-desc");
if (n) { F.killTweensOf(n); n.style.opacity = 0; }
}

function Ue(t, i, n, o, e, r, s, a) {
const c = t.querySelectorAll(".benefit-card");
if (n < o) {
if (s.val) {
s.val = false; s.cardRevealed = [false, false, false];
F.to(t, { opacity: 0, duration: 0.5, ease: "power2.out", onComplete: () => { c.forEach(l => st(l)); } });
}
} else if (!a && n >= e && n < r) {
F.killTweensOf(t); t.style.opacity = 1 - (n - e) / (r - e);
} else if (!a && n >= r) {
t.style.opacity = 0;
} else if (parseFloat(t.style.opacity) < 1 && s.val) {
F.killTweensOf(t); t.style.opacity = 1;
}

if (n >= o && !s.val) {
s.val = true; F.killTweensOf(t);
c.forEach(l => { l.style.opacity = 0; });
t.style.opacity = 1; s.cardRevealed[0] = true; ge(c[0]);
}

if (s.val) {
const v = (a ? 1 : e) - o, k = v > 0 ? Math.max(0, Math.min(1, (n - o) / v)) : 0;
if (k >= 0.33 && !s.cardRevealed[1]) { s.cardRevealed[1] = true; ge(c[1]); }
if (k >= 0.66 && !s.cardRevealed[2]) { s.cardRevealed[2] = true; ge(c[2]); }
}
}

const Jt = 0.08, Pe = 0.05;
let K = false;
let De = false, Be = null;

window.addEventListener("scroll", () => {
De = true;
clearTimeout(Be);
Be = setTimeout(() => { De = false; }, 150);
$e = false;

const tr = document.getElementById("connect-track");
if (tr) {
const rect = tr.getBoundingClientRect();
const dist = tr.offsetHeight - window.innerHeight;
const earlyEnd = 1.5 * window.innerHeight;
ce = dist > 0 ? Math.max(0, Math.min(1, -rect.top / (dist - earlyEnd))) : 0;
} else {
const t = document.documentElement.scrollHeight - window.innerHeight;
ce = t > 0 ? Math.min(1, window.scrollY / t) : 0;
}

const i = Math.min(1, ce / Pe);

const X = document.getElementById("benefits-row");
const Z = document.getElementById("benefits-row-2");
const q = document.getElementById("scroll-divider");

if (i >= 1 && !K) {
K = true;
F.to(document.querySelectorAll("#hero-section .clip-char"), { yPercent: 0, duration: 0.7, stagger: 0.03, ease: "power3.out" });
if(q) F.to(q, { opacity: 1, duration: 0.6, ease: "power2.out" });
if (X) { 
X.style.opacity = 1; re.val = true; re.cardRevealed[0] = true; 
const o = X.querySelector(".benefit-card"); 
if (o) ge(o); 
}
}
if (i < 1 && K) {
K = false;
F.killTweensOf(document.querySelectorAll("#hero-section .clip-char"));
F.to(document.querySelectorAll("#hero-section .clip-char"), { yPercent: 110, duration: 0.4, ease: "power2.in" });
if(q) F.to(q, { opacity: 0, duration: 0.4, ease: "power2.in" });
re.val = false; re.cardRevealed = [false, false, false];
if (X) F.to(X, { opacity: 0, duration: 0.4, ease: "power2.in", onComplete: () => { X.querySelectorAll(".benefit-card").forEach(o => st(o)); } });
}
if (K) {
const n = Math.max(0, Math.min(1, (ce - Pe) / (1 - Pe)));
if (X) Ue(X, "#benefits-row", n, nt, at, rt, re, false);
if (Z) Ue(Z, "#benefits-row-2", n, Xt, 0, 0, Zt, true);
}
if (K && q) {
q.style.opacity = 1;
const n_progress = document.getElementById("scroll-progress");
if(n_progress) n_progress.style.width = `${Math.min(1, ce) * 100}%`;
}
});

window.addEventListener("resize", () => {
C.aspect = window.innerWidth / window.innerHeight; C.updateProjectionMatrix();
oe.aspect = window.innerWidth / window.innerHeight; oe.updateProjectionMatrix();
x.setSize(window.innerWidth, window.innerHeight); x.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

{
let t = function () {
const s = Math.sin(o) * Math.cos(e), a = Math.sin(e), c = Math.cos(o) * Math.cos(e);
N.uniforms.uCenterDir.value.set(s, a, c);
};
let i = function () {
const s = N.uniforms.uCenterDir.value, a = (r * 180 / Math.PI).toFixed(0);
};
var o = -2.42, e = -0.35, r = Xe;
t();
window.addEventListener("keydown", s => {
const a = s.key.toLowerCase(); let c = false;
if (a === "r") { r = Math.max(0.3, r - 0.05); c = true; }
if (a === "e") { r = Math.min(Math.PI * 2, r + 0.05); c = true; }
if (c) { e = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, e)); t(); N.uniforms.uHFov.value = r; i(); }
});
}

const H = { x: 0.5, y: 0, z: -3.5 }, Ie = { x: -2.5, y: 0, z: -4.5 }, T = { x: H.x, y: H.y, z: H.z }, we = { value: 0 }, V = { value: 0.5 };

window.addEventListener("keydown", t => {
const i = t.shiftKey ? 0.1 : 0.5, o = (t.shiftKey ? 1 : 10) * Math.PI / 180;
let e = false;
if (t.key === "a" || t.key === "A") { T.x -= i; e = true; }
if (t.key === "d" || t.key === "D") { T.x += i; e = true; }
if (t.key === "w" || t.key === "W") { T.z -= i; e = true; }
if (t.key === "s" || t.key === "S") { T.z += i; e = true; }
if (t.key === "q" || t.key === "Q") { T.y += i; e = true; }
if (t.key === "z" || t.key === "Z") { T.y -= i; e = true; }
if (t.key === "ArrowLeft") { S.environmentRotation.y -= o; e = true; }
if (t.key === "ArrowRight") { S.environmentRotation.y += o; e = true; }
if (t.key === "ArrowUp") { S.environmentRotation.x -= o; e = true; }
if (t.key === "ArrowDown") { S.environmentRotation.x += o; e = true; }
if (t.key === "[") { we.value -= 0.05; e = true; }
if (t.key === "]") { we.value += 0.05; e = true; }
if (t.key === "-") { V.value = Math.max(0.1, V.value - 0.1); e = true; }
if (t.key === "=" || t.key === "+") { V.value += 0.1; e = true; }
if (t.key === "c") { C.fov += t.shiftKey ? 0.5 : 1; C.updateProjectionMatrix(); e = true; }
if (t.key === "v") { C.fov -= t.shiftKey ? 0.5 : 1; C.updateProjectionMatrix(); e = true; }

let r = false; const s = t.shiftKey ? 0.005 : 0.03;
if (t.key === "j" || t.key === "J") { pe -= s; r = true; }
if (t.key === "l" || t.key === "L") { pe += s; r = true; }
if (t.key === "i" || t.key === "I") { U = Math.max(0.1, U - s); r = true; }
if (t.key === "k" || t.key === "K") { U = Math.min(Math.PI - 0.1, U + s); r = true; }

if (r) { Qe(); e = true; }
});


function lt() {
_e.getDelta(); const t = _e.elapsedTime;

W += (ce - W) * Jt;

if (!$e) {
const e = Kt(W);
C.position.lerp(e.pos, 0.1); j.target.lerp(e.tgt, 0.1);
const r = 15 * (1 - 0.15 * W);
C.fov += (r - C.fov) * 0.1; C.updateProjectionMatrix();
}

He.copy(C.position).sub(Yt).multiplyScalar(Ut); ve.position.copy(He);
const i = C.fov / 15; ve.scale.setScalar(i);

for (const e of ze) e.lookAt(C.position);

oe.quaternion.copy(C.quaternion);
T.x = H.x + (Ie.x - H.x) * W; T.y = H.y + (Ie.y - H.y) * W; T.z = H.z + (Ie.z - H.z) * W;

if (A) {
const e = Pt, r = 2 * Math.PI / e.bobPeriod, s = Math.sin(t * r), a = 2 * Math.PI / e.stallPeriod, c = Math.cos(t * a), l = 1 - e.stallDepth * c * c, v = s * e.bobAmp * l;
A.position.set(he.x + T.x, he.y + T.y + v, he.z + T.z);
const k = Math.cos(t * r) * l;
A.rotation.set(ue.x + k * e.pitchAmp, ue.y + we.value, ue.z);
if (V._baseScalar) A.scale.setScalar(V._baseScalar * V.value);
}

x.domElement.style.filter = ""; j.update();
const n = W * W * W;
N.uniforms.uNightMix.value = n * 0.7;
const o = 0.85 - 0.75 * n;

for (const e of ze) e.material.uniforms.uOpacity.value = o;

x.toneMappingExposure = 3.2 + (2.4 - 3.2) * n;
S.environmentIntensity = 1 - 0.95 * n;
I.intensity = 0.15 * n;
x.domElement.style.filter = `grayscale(${n * 0.4})`;

let Me = document.getElementById("night-tint");
if (Me) Me.style.opacity = n * 0.15;

x.autoClear = true; x.render(Je, oe);
x.autoClear = false; x.render(S, C);
x.autoClear = true; requestAnimationFrame(lt);
}

lt();
