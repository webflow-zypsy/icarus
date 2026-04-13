import "./modulepreload-polyfill-B5Qt9EMX.js";
import { S as he, c as E, M as Z, D as F, V as J, P as ge, W as we, a as ne, A as ue, H as ye, h as be, g as Se, E as re, B as Q, C as ve, d as I, e as U, L as O, f as B, N as X, i as Me, j as xe, k as Re, l as Ce } from "./three-qkzU8FvL.js";
import { D as Pe, G as ze } from "./DRACOLoader-vjdbR7_p.js";
import { R as Te } from "./RGBELoader-5qm8pwqm.js";
import "./BufferGeometryUtils-BZ-SHm62.js";

const ae = new ve();
const P = new he();
let N = null;
let j = new E(0, 0, 0);
let q = new re(0, 0, 0);

const Ee = { bobAmp: 0.04, bobPeriod: 5, stallPeriod: 3, stallDepth: 0.35, pitchAmp: 0.0075 };

function ee(r) { return 1 - Math.pow(1 - r, 3); }

const $e = (r, n) => {
    const o = r.geometry;
    if (!o) return;
    const t = o.attributes.position, e = o.attributes.normal;
    if (!t || !e) return;
    const b = new Float32Array(t.count * 2);
    r.updateMatrixWorld(true);
    const u = new E(), y = new E(), c = new Me().getNormalMatrix(r.matrixWorld);
    for (let R = 0; R < t.count; R++) {
        u.set(t.getX(R), t.getY(R), t.getZ(R)); u.applyMatrix4(r.matrixWorld);
        y.set(e.getX(R), e.getY(R), e.getZ(R)); y.applyMatrix3(c).normalize();
        const M = Math.abs(y.x), x = Math.abs(y.y), k = Math.abs(y.z);
        let a, s;
        if (M >= x && M >= k) { a = u.y; s = u.z; }
        else if (x >= M && x >= k) { a = u.x; s = u.z; }
        else { a = u.x; s = u.y; }
        b[R * 2 + 0] = a * n; b[R * 2 + 1] = s * n;
    }
    o.setAttribute("uv", new xe(b, 2));
    o.attributes.uv.needsUpdate = true;
};

const ke = (r = {}) => {
    const o = r.towCount || 32, t = 512 / o, e = r.gap || 1, b = r.glossy !== false;
    const u = () => { const m = document.createElement("canvas"); m.width = 512; m.height = 512; return { c: m, ctx: m.getContext("2d") }; };
    const { c: y, ctx: c } = u();
    c.fillStyle = "#1a1a1e"; c.fillRect(0, 0, 512, 512);
    for (let m = 0; m < o; m++) for (let d = 0; d < o; d++) {
        const p = d * t, h = m * t, g = (d + m) % 4 < 2;
        if (g) { const i = 120 + Math.random() * 20; c.fillStyle = `rgb(${i},${i},${i + 3})`; }
        else { const i = 85 + Math.random() * 20; c.fillStyle = `rgb(${i + 2},${i},${i})`; }
        c.fillRect(p + e, h + e, t - e * 2, t - e * 2);
        const w = 5;
        if (g) for (let i = 0; i < w; i++) {
            const v = p + e + (t - e * 2) * (i + 0.5) / w;
            c.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`;
            c.lineWidth = 0.8; c.beginPath(); c.moveTo(v, h + e); c.lineTo(v, h + t - e); c.stroke();
        } else for (let i = 0; i < w; i++) {
            const v = h + e + (t - e * 2) * (i + 0.5) / w;
            c.strokeStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.04})`;
            c.lineWidth = 0.8; c.beginPath(); c.moveTo(p + e, v); c.lineTo(p + t - e, v); c.stroke();
        }
    }
    const { c: R, ctx: M } = u(), x = 90;
    M.fillStyle = `rgb(${x},${x},${x})`; M.fillRect(0, 0, 512, 512);
    for (let m = 0; m < o; m++) for (let d = 0; d < o; d++) {
        const p = d * t, h = m * t, w = (d + m) % 4 < 2 ? x - 6 + Math.random() * 4 : x + 2 + Math.random() * 6;
        M.fillStyle = `rgb(${w},${w},${w})`; M.fillRect(p + e, h + e, t - e * 2, t - e * 2);
    }
    for (let m = 0; m < o; m++) for (let d = 0; d < o; d++) {
        const p = d * t, h = m * t, g = x + 30;
        M.fillStyle = `rgb(${g},${g},${g})`; M.fillRect(p, h, t, e); M.fillRect(p, h, e, t);
    }
    const { c: k, ctx: a } = u();
    a.fillStyle = "rgb(128,128,255)"; a.fillRect(0, 0, 512, 512);
    for (let m = 0; m < o; m++) for (let d = 0; d < o; d++) {
        const p = d * t, h = m * t;
        if ((d + m) % 4 < 2) {
            const w = (t - e * 2) / 2;
            a.fillStyle = "rgba(110,128,255,0.45)"; a.fillRect(p + e, h + e, w, t - e * 2);
            a.fillStyle = "rgba(146,128,255,0.45)"; a.fillRect(p + e + w, h + e, w, t - e * 2);
            a.fillStyle = "rgba(128,115,255,0.3)"; a.fillRect(p + e, h + e, t - e * 2, 2);
            a.fillStyle = "rgba(128,141,255,0.3)"; a.fillRect(p + e, h + t - e - 2, t - e * 2, 2);
        } else {
            const w = (t - e * 2) / 2;
            a.fillStyle = "rgba(128,110,255,0.45)"; a.fillRect(p + e, h + e, t - e * 2, w);
            a.fillStyle = "rgba(128,146,255,0.45)"; a.fillRect(p + e, h + e + w, t - e * 2, w);
            a.fillStyle = "rgba(115,128,255,0.3)"; a.fillRect(p + e, h + e, 2, t - e * 2);
            a.fillStyle = "rgba(141,128,255,0.3)"; a.fillRect(p + t - e - 2, h + e, 2, t - e * 2);
        }
    }
    for (let m = 0; m < o; m++) for (let d = 0; d < o; d++) {
        const p = d * t, h = m * t;
        a.fillStyle = "rgba(128,108,240,0.5)"; a.fillRect(p, h, t, e + 1);
        a.fillStyle = "rgba(108,128,240,0.5)"; a.fillRect(p, h, e + 1, t);
    }
    const s = 16, l = new I(y);
    l.colorSpace = ne; l.wrapS = l.wrapT = U; l.generateMipmaps = true; l.minFilter = O; l.magFilter = B; l.anisotropy = s;
    const C = new I(R);
    C.colorSpace = X; C.wrapS = C.wrapT = U; C.generateMipmaps = true; C.minFilter = O; C.magFilter = B; C.anisotropy = s;
    const f = new I(k);
    f.colorSpace = X; f.wrapS = f.wrapT = U; f.generateMipmaps = true; f.minFilter = O; f.magFilter = B; f.anisotropy = s;
    return { albedo: l, rough: C, normal: f };
};

const Le = (r = {}) => {
    const o = r.cellCols || 4, t = r.cellRows || 6, e = r.cellGap || 10, b = r.busBarCount || 5, u = r.fingerSpacing || 4, y = (512 - (o + 1) * e) / o, c = (512 - (t + 1) * e) / t;
    const R = () => { const g = document.createElement("canvas"); g.width = 512; g.height = 512; return { c: g, ctx: g.getContext("2d") }; };
    const M = g => e + g * (y + e), x = g => e + g * (c + e);
    const { c: k, ctx: a } = R();
    a.fillStyle = "#474751"; a.fillRect(0, 0, 512, 512);
    for (let g = 0; g < t; g++) for (let w = 0; w < o; w++) {
        const i = M(w), v = x(g), W = Math.random() * 4 - 2;
        a.fillStyle = `rgb(${6 + W}, ${8 + W}, ${18 + W})`; a.fillRect(i, v, y, c);
        a.strokeStyle = "rgba(30, 50, 100, 0.5)"; a.lineWidth = 2; a.strokeRect(i + 1, v + 1, y - 2, c - 2);
        const $ = a.createLinearGradient(i, v, i + y, v + c);
        $.addColorStop(0, "rgba(40, 50, 90, 0.08)"); $.addColorStop(1, "rgba(20, 25, 50, 0.08)");
        a.fillStyle = $; a.fillRect(i, v, y, c);
        for (let T = 0; T < b; T++) { const H = v + c * (T + 1) / (b + 1); a.strokeStyle = "rgba(50, 50, 58, 0.95)"; a.lineWidth = 1.5; a.beginPath(); a.moveTo(i, H); a.lineTo(i + y, H); a.stroke(); }
        a.strokeStyle = "rgba(45, 45, 55, 0.50)"; a.lineWidth = 0.5;
        for (let T = i + u; T < i + y; T += u) { a.beginPath(); a.moveTo(T, v); a.lineTo(T, v + c); a.stroke(); }
        for (let T = 0; T < b; T++) {
            const H = v + c * (T + 1) / (b + 1);
            for (let K = i + u * 3; K < i + y; K += u * 4) { a.save(); a.translate(K, H); a.rotate(Math.PI / 4); a.fillStyle = "rgba(55, 55, 65, 0.7)"; a.fillRect(-1.5, -1.5, 3, 3); a.restore(); }
        }
    }
    const { c: s, ctx: l } = R();
    l.fillStyle = "rgb(90, 90, 90)"; l.fillRect(0, 0, 512, 512);
    for (let g = 0; g < t; g++) for (let w = 0; w < o; w++) {
        const i = M(w), v = x(g), W = 50 + Math.random() * 5;
        l.fillStyle = `rgb(${W}, ${W}, ${W})`; l.fillRect(i, v, y, c);
        l.strokeStyle = "rgb(60, 60, 60)"; l.lineWidth = 2; l.strokeRect(i + 1, v + 1, y - 2, c - 2);
        for (let $ = 0; $ < b; $++) { const T = v + c * ($ + 1) / (b + 1); l.strokeStyle = "rgb(30, 30, 30)"; l.lineWidth = 1.5; l.beginPath(); l.moveTo(i, T); l.lineTo(i + y, T); l.stroke(); }
    }
    const { c: C, ctx: f } = R();
    f.fillStyle = "rgb(128, 128, 255)"; f.fillRect(0, 0, 512, 512);
    for (let g = 0; g < t; g++) for (let w = 0; w < o; w++) {
        const i = M(w), v = x(g);
        f.fillStyle = "rgba(118, 128, 255, 0.6)"; f.fillRect(i, v, 2, c);
        f.fillStyle = "rgba(138, 128, 255, 0.6)"; f.fillRect(i + y - 2, v, 2, c);
        f.fillStyle = "rgba(128, 118, 255, 0.6)"; f.fillRect(i, v, y, 2);
        f.fillStyle = "rgba(128, 138, 255, 0.6)"; f.fillRect(i, v + c - 2, y, 2);
        for (let W = 0; W < b; W++) { const $ = v + c * (W + 1) / (b + 1); f.fillStyle = "rgba(128, 118, 255, 0.4)"; f.fillRect(i, $ - 1, y, 1); f.fillStyle = "rgba(128, 138, 255, 0.4)"; f.fillRect(i, $ + 1, y, 1); }
    }
    for (let g = 0; g < t; g++) for (let w = 0; w < o; w++) {
        const i = M(w), v = x(g);
        f.fillStyle = "rgba(128, 108, 240, 0.5)"; f.fillRect(i - e, v - e, y + e * 2, e);
        f.fillStyle = "rgba(108, 128, 240, 0.5)"; f.fillRect(i - e, v, e, c);
    }
    const m = 16, d = new I(k);
    d.colorSpace = ne; d.wrapS = d.wrapT = U; d.generateMipmaps = true; d.minFilter = O; d.magFilter = B; d.anisotropy = m;
    const p = new I(s);
    p.colorSpace = X; p.wrapS = p.wrapT = U; p.generateMipmaps = true; p.minFilter = O; p.magFilter = B; p.anisotropy = m;
    const h = new I(C);
    h.colorSpace = X; h.wrapS = h.wrapT = U; h.generateMipmaps = true; h.minFilter = O; h.magFilter = B; h.anisotropy = m;
    return { albedo: d, rough: p, normal: h };
};

const A = ke({ glossy: false, towCount: 24 });
const te = Le();

const _ = {
    solarPanel: new Z({ color: 16777215, map: te.albedo, metalness: 0.08, roughness: 0.45, roughnessMap: te.rough, clearcoat: 0.9, clearcoatRoughness: 0.05, normalMap: te.normal, normalScale: new J(0.4, 0.4), envMapIntensity: 0.5, side: F, shadowSide: F }),
    carbonMatte: new Z({ color: 7171437, map: A.albedo, metalness: 0, roughness: 0.92, roughnessMap: A.rough, clearcoat: 0, normalMap: A.normal, normalScale: new J(0.2, 0.2), envMapIntensity: 0.25, side: F, shadowSide: F }),
    tailMatte: new Z({ color: 13224393, map: A.albedo, metalness: 0, roughness: 0.92, roughnessMap: A.rough, clearcoat: 0, normalMap: A.normal, normalScale: new J(0.2, 0.2), envMapIntensity: 0.25, side: F, shadowSide: F })
};

const Fe = { matte: 40 };
const Ae = 3;
const Y = new ge(15, window.innerWidth / window.innerHeight, 0.1, 1e3);
Y.position.set(0, 1.2, 5.2);

const z = new we({ antialias: true, alpha: true });
z.setSize(window.innerWidth, window.innerHeight);
z.setPixelRatio(Math.min(window.devicePixelRatio, 2));
z.outputColorSpace = ne;
z.toneMapping = ue;
z.toneMappingExposure = 3.2;
z.setClearColor(0, 0);

let D = document.getElementById("scene-drone");
if (!D) {
    D = document.createElement("div");
    D.id = "scene-drone";
    document.body.appendChild(D);
}
D.innerHTML = "";
D.appendChild(z.domElement);

const ie = window !== window.parent;
const De = new ye(9351106, 5785656, 0.8);
P.add(De);

const se = new E(0, 0.3, 0);
const Ie = "https://cdn.jsdelivr.net/gh/webflow-zypsy/icarus@main/green-512.hdr";
const Ue = "https://cdn.jsdelivr.net/gh/webflow-zypsy/icarus@main/apollo-draco.glb";
const le = { extraScale: 16, rotation: new re(-Math.PI / 2, 0, 0) };
const me = new be(z);
me.compileEquirectangularShader();

const Oe = new Te();
Oe.load(Ie, r => {
    r.mapping = Se;
    const n = me.fromEquirectangular(r).texture;
    P.environment = n;
    P.environmentRotation = new re(-840 * Math.PI / 180, 2070 * Math.PI / 180, 0);
    r.dispose();
});

const de = new Pe();
de.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
const fe = new ze();
fe.setDRACOLoader(de);
fe.load(Ue, r => {
    const n = r.scene;
    n.position.set(0, 0, 0);
    n.rotation.set(0, 0, 0);
    const o = new Q().setFromObject(n), t = new E(), e = new E();
    o.getSize(t); o.getCenter(e);
    const b = Math.max(t.x, t.y, t.z);
    
    if (isFinite(b) && b > 0) {
        const l = 1.4 / b;
        n.scale.setScalar(l);
        n.position.sub(e.multiplyScalar(l));
    } else {
        n.scale.setScalar(1);
    }
    
    n.rotation.copy(le.rotation);
    n.scale.multiplyScalar(le.extraScale);
    j.copy(n.position);
    q.copy(n.rotation);
    n.updateMatrixWorld(true);
    
    const u = [];
    n.traverse(s => { if (s.isMesh) u.push(s); });
    
    for (const s of u) {
        if (s.geometry && !s.geometry.attributes.normal) s.geometry.computeVertexNormals();
        s.material = _.carbonMatte;
        s.castShadow = true;
        s.receiveShadow = true;
    }
    
    const y = new Set(["mesh73", "mesh100", "mesh76", "mesh103"]);
    let c = 0;
    for (const s of u) {
        if (y.has(s.name)) { s.material = _.solarPanel; c++; }
    }
    
    if (c === 0) {
        const s = u.map(l => {
            const C = new Q().setFromObject(l), f = new E(), m = new E();
            C.getSize(f); C.getCenter(m);
            const d = f.y / Math.max(f.x, f.z, 1e-6), p = f.x * f.z, h = Math.abs(m.x), g = p * (1 / (d + 0.02)) * (0.6 + h);
            return { m: l, score: g };
        }).sort((l, C) => C.score - l.score);
        for (let l = 0; l < Math.min(4, s.length); l++) s[l].m.material = _.solarPanel;
    }
    
    P.add(n);
    n.updateMatrixWorld(true);
    
    for (const s of u) {
        let l = Fe.matte;
        if (s.material === _.solarPanel) l = Ae;
        $e(s, l);
    }
    
    const R = new Set(["mesh159", "mesh160", "mesh161", "mesh162", "mesh163", "mesh164", "mesh165", "mesh166", "mesh167", "mesh168", "mesh169", "mesh170", "mesh171", "mesh172", "mesh173", "mesh174", "mesh175", "mesh176", "mesh177", "mesh178", "mesh179", "mesh180", "mesh181", "mesh182", "mesh183", "mesh184"]);
    for (const s of u) {
        if (R.has(s.name)) s.material = _.tailMatte;
    }
    
    N = n;

    const M = [
        { cam: new E(-23.705, 16.498, -19.656), tgt: new E(0.6, 1.60, 0) },
        { cam: new E(-38.986, 29.477, 0),       tgt: new E(0.6, 0.98, 0) },
        { cam: new E(-29.263, 37.163, 0.053),   tgt: new E(0.6, 1.3, 0) },
        { cam: new E(-29.263, 37.163, 0.053),   tgt: new E(0.6, 1.8, 0) },
        { cam: new E(-29.263, 37.163, 0.053),   tgt: new E(0.6, 2.5, 0) },
        { cam: new E(-29.263, 37.163, 0.053),   tgt: new E(0.6, 4.3, 0) },
        { cam: new E(-29.263, 37.163, 0.053),   tgt: new E(0.6, 4.7, 0) },
        { cam: new E(-29.263, 37.163, 0.053),   tgt: new E(0.6, 5.0, 0) },
        { cam: new E(-29.263, 37.163, 0.053),   tgt: new E(0.6, 5.5, 0) }
    ];
    let x = 0, k = 0;

    const a = s => {
        const l = Math.max(0, Math.min(1, s)), C = M.length - 1, f = l * C, m = Math.min(Math.floor(f), C - 1), d = f - m, p = M[m].cam.clone().lerp(M[m + 1].cam, d), h = M[m].tgt.clone().lerp(M[m + 1].tgt, d);
        Y.position.set(p.x, p.y, p.z); se.set(h.x, h.y, h.z); Y.lookAt(se);
    };
    
    a(0);

    if (!ie) {
        window.addEventListener("scroll", () => {
            const tr = document.getElementById("scenes-track");
            if (tr) {
                const rect = tr.getBoundingClientRect();
                const dist = tr.offsetHeight - window.innerHeight - window.innerHeight * 0.3;
                x = dist > 0 ? Math.max(0, Math.min(1, -rect.top / dist)) : 0;
            } else {
                const s = document.documentElement.scrollHeight - window.innerHeight;
                x = s > 0 ? window.scrollY / s : 0;
            }
        }, { passive: true });
    }

    window.addEventListener("message", s => { if (s.data && typeof s.data.scrollProgress == "number") x = s.data.scrollProgress; });
    window.__droneApplyPose = a;
    window.__droneScrollState = { getScrollT: () => x, getSmoothT: () => k, setSmoothT: s => { k = s; } };
});

window.addEventListener("resize", () => {
    Y.aspect = window.innerWidth / window.innerHeight; Y.updateProjectionMatrix();
    z.setSize(window.innerWidth, window.innerHeight); z.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

function pe() {
    ae.getDelta(); const r = ae.elapsedTime;
    
    if (window.__droneScrollState && window.__droneApplyPose) {
        const n = window.__droneScrollState, o = n.getScrollT();
        let t = n.getSmoothT(); t += (o - t) * 0.06; if (Math.abs(o - t) < 1e-4) t = o;
        n.setSmoothT(t); window.__droneApplyPose(t);
    }
    
    if (N) {
        const n = Ee, o = 2 * Math.PI / n.bobPeriod, t = Math.sin(r * o), e = 2 * Math.PI / n.stallPeriod, b = Math.cos(r * e), u = 1 - n.stallDepth * b * b, y = t * n.bobAmp * u;
        N.position.set(j.x, j.y + y, j.z);
        const c = Math.cos(r * o) * u; N.rotation.set(q.x + c * n.pitchAmp, q.y, q.z);
    }
    
    if (window.__droneScrollState) {
        const n = Math.min(window.__droneScrollState.getSmoothT() / 0.5, 1), o = 0.6 + n * 0.2, t = 1 - n * 0.1, e = 1 - n * 0.15;
        z.domElement.style.filter = `grayscale(${o}) contrast(${t}) brightness(${e})`;
        if (P.environmentRotation) { const b = 2070 * Math.PI / 180, u = 2085 * Math.PI / 180; P.environmentRotation.y = b + n * (u - b); }
    }
    
    z.render(P, Y); requestAnimationFrame(pe);
}

pe();
