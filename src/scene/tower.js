import * as THREE from 'three';

/* ============================================================
   广州塔 · 几何构建
   双曲面轮廓 + 24 根扭转钢柱 + 环梁 + 斜撑 + 玻璃幕墙
   ============================================================ */

export const TOWER = {
  height: 454,       // 主体高度
  total: 600,        // 含天线总高
  waist: 280,        // 最细处
  columns: 24,
  twist: Math.PI / 4,
};

const H = TOWER.height;
const TWIST = TOWER.twist;
const N_COL = TOWER.columns;
const TAU = Math.PI * 2;

/* ---------- 单调三次插值（PCHIP），保证轮廓不越界 ---------- */

function pchip(xs, ys) {
  const n = xs.length;
  const h = new Array(n - 1);
  const d = new Array(n - 1);
  const m = new Array(n);

  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = (ys[i + 1] - ys[i]) / h[i];
  }

  m[0] = d[0];
  m[n - 1] = d[n - 2];

  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }

  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];

    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }

    const t = (x - xs[lo]) / h[lo];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[lo] +
      (t3 - 2 * t2 + t) * h[lo] * m[lo] +
      (-2 * t3 + 3 * t2) * ys[lo + 1] +
      (t3 - t2) * h[lo] * m[lo + 1]
    );
  };
}

/* ---------- 塔身轮廓控制点：高度, X 半径, Z 半径 ---------- */

const PROFILE = [
  [0, 42.0, 31.5],
  [60, 38.2, 28.6],
  [120, 33.0, 24.7],
  [180, 26.4, 19.7],
  [230, 20.4, 15.3],
  [280, 15.4, 11.5],
  [320, 17.4, 13.1],
  [360, 21.2, 15.9],
  [400, 25.6, 19.2],
  [430, 28.6, 21.5],
  [454, 30.2, 22.7],
];

const ys = PROFILE.map((p) => p[0]);
const rxAt = pchip(ys, PROFILE.map((p) => p[1]));
const rzAt = pchip(ys, PROFILE.map((p) => p[2]));

const angleAt = (i, y) => (i / N_COL) * TAU + TWIST * (y / H);

function surfacePoint(i, y, extra = 0) {
  const a = angleAt(i, y);
  return new THREE.Vector3(
    (rxAt(y) + extra) * Math.cos(a),
    y,
    (rzAt(y) + extra) * Math.sin(a)
  );
}

/* ============================================================
   材质
   ============================================================ */

const steelMat = new THREE.MeshStandardMaterial({
  color: 0x16222c,
  metalness: 0.86,
  roughness: 0.38,
  emissive: new THREE.Color(0x3fd6ff),
  emissiveIntensity: 0.25,
});

const ringMat = new THREE.MeshStandardMaterial({
  color: 0x1b2b36,
  metalness: 0.8,
  roughness: 0.42,
  emissive: new THREE.Color(0x2fb6dd),
  emissiveIntensity: 0.32,
});

const lineMat = new THREE.LineBasicMaterial({
  color: 0x5fd8f2,
  transparent: true,
  opacity: 0.38,
  depthWrite: false,
});
// 斜撑线宽固定为 1px，远距离会形成高频摩尔纹；主循环按相机距离衰减它的不透明度。
lineMat.userData.baseOpacity = 0.38;

const glassMat = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(0x69dcff) },
    uAccent: { value: new THREE.Color(0xb8f6ff) },
    uOpacity: { value: 0.34 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform vec3 uAccent;
    uniform float uOpacity;
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vWorldNormal;

    void main() {
      vec3 V = normalize(cameraPosition - vWorldPos);
      float fres = pow(1.0 - abs(dot(normalize(vWorldNormal), V)), 3.0);

      // 幕墙分格：按屏幕空间导数做抗锯齿，并在分格小于 1 像素时淡出，
      // 避免旋转 / 缩放时网格线出现闪烁和摩尔纹。
      vec2 g = vUv * vec2(60.0, 130.0);
      vec2 f = abs(fract(g) - 0.5);
      vec2 gw = fwidth(g);
      float lineAA = max(gw.x, gw.y);
      float line = smoothstep(0.455 - lineAA, 0.5 + lineAA, max(f.x, f.y));
      line *= 1.0 - smoothstep(0.18, 0.55, lineAA);

      float scan = smoothstep(0.9, 1.0, sin((vUv.y * 2.0 - uTime * 0.05) * 6.2831853)) * 0.5;

      vec3 col = uColor * (0.18 + fres * 1.5);
      col += uAccent * (line * 0.22 + scan * 0.7);

      float alpha = uOpacity * (0.03 + fres * 0.5 + line * 0.1 + scan * 0.16);
      gl_FragColor = vec4(col, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  extensions: { derivatives: true },
});

const coreMat = new THREE.ShaderMaterial({
  uniforms: {
    uColor: { value: new THREE.Color(0x0a1a26) },
    uGlow: { value: new THREE.Color(0x8fe9ff) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform vec3 uGlow;
    varying vec2 vUv;
    varying vec3 vWorldPos;
    void main() {
      // 楼层线在远处会小于一个像素，按导数收敛为平均亮度，避免频闪。
      float detail = 1.0 - smoothstep(0.2, 0.7, fwidth(vUv.y * 108.0));
      float floorLine = smoothstep(0.46, 0.5, abs(fract(vUv.y * 108.0) - 0.5)) * detail;
      float bands = smoothstep(0.72, 1.0, sin(vUv.y * 180.0) * 0.5 + 0.5) * detail;
      float grad = smoothstep(0.0, 0.25, vUv.y);
      vec3 col = uColor + uGlow * (floorLine * 0.35 + bands * 0.06) * grad;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
  side: THREE.DoubleSide,
  extensions: { derivatives: true },
});

const deckMat = new THREE.MeshStandardMaterial({
  color: 0x0b1822,
  metalness: 0.7,
  roughness: 0.35,
  emissive: new THREE.Color(0x0d3a4d),
  emissiveIntensity: 0.8,
});

const deckEdgeMat = new THREE.MeshBasicMaterial({
  color: 0xaef4ff,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const capsuleMat = new THREE.MeshStandardMaterial({
  color: 0xfff2d4,
  emissive: new THREE.Color(0xffd59a),
  emissiveIntensity: 1.6,
  metalness: 0.2,
  roughness: 0.25,
});

const beaconMat = new THREE.MeshBasicMaterial({
  color: 0xff4d5e,
  transparent: true,
  opacity: 1,
});

const scanMat = new THREE.MeshBasicMaterial({
  color: 0x9defff,
  transparent: true,
  opacity: 0.16,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/* ============================================================
   构建
   ============================================================ */

export function createTower() {
  const group = new THREE.Group();
  group.name = 'CantonTower';

  /* ---------- 1. 24 根扭转钢柱 ---------- */

  const columnGroup = new THREE.Group();
  for (let i = 0; i < N_COL; i++) {
    const pts = [];
    for (let s = 0; s <= 160; s++) {
      pts.push(surfacePoint(i, (s / 160) * H));
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const geo = new THREE.TubeGeometry(curve, 170, 0.78, 6, false);
    columnGroup.add(new THREE.Mesh(geo, steelMat));
  }
  group.add(columnGroup);

  /* ---------- 2. 水平环梁 ---------- */

  const levels = [];
  for (let y = 0; y <= H; y += 13.4) levels.push(y);
  if (levels[levels.length - 1] < H) levels.push(H);

  const ringGroup = new THREE.Group();
  const ringGeos = [];
  for (const y of levels) {
    const pts = [];
    const seg = 96;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * TAU;
      pts.push(new THREE.Vector3(rxAt(y) * Math.cos(a), y, rzAt(y) * Math.sin(a)));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const geo = new THREE.TubeGeometry(curve, seg, 0.26, 4, true);
    ringGeos.push(geo);
    ringGroup.add(new THREE.Mesh(geo, ringMat));
  }
  group.add(ringGroup);

  /* ---------- 3. 交叉斜撑 ---------- */

  const diagPositions = [];
  const pushPt = (i, y) => {
    const p = surfacePoint(i % N_COL, y);
    diagPositions.push(p.x, p.y, p.z);
  };

  for (let l = 0; l < levels.length - 1; l++) {
    const y0 = levels[l];
    const y1 = levels[l + 1];
    for (let i = 0; i < N_COL; i++) {
      pushPt(i, y0);
      pushPt(i + 1, y1);
      pushPt(i + 1, y0);
      pushPt(i, y1);
    }
  }

  const diagGeo = new THREE.BufferGeometry();
  diagGeo.setAttribute('position', new THREE.Float32BufferAttribute(diagPositions, 3));
  const diagLines = new THREE.LineSegments(diagGeo, lineMat);
  group.add(diagLines);

  /* ---------- 4. 玻璃幕墙（扭转双曲面） ---------- */

  const SU = 112;
  const SV = 190;
  const shellPos = [];
  const shellUv = [];
  const shellIdx = [];

  for (let v = 0; v <= SV; v++) {
    const t = v / SV;
    const y = t * H;
    for (let u = 0; u <= SU; u++) {
      const a = (u / SU) * TAU + TWIST * t;
      shellPos.push(
        rxAt(y) * Math.cos(a),
        y,
        rzAt(y) * Math.sin(a)
      );
      shellUv.push(u / SU, t);
    }
  }

  for (let v = 0; v < SV; v++) {
    for (let u = 0; u < SU; u++) {
      const a = v * (SU + 1) + u;
      const b = a + 1;
      const c = a + SU + 1;
      const d = c + 1;
      shellIdx.push(a, c, b, b, c, d);
    }
  }

  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(shellPos, 3));
  shellGeo.setAttribute('uv', new THREE.Float32BufferAttribute(shellUv, 2));
  shellGeo.setIndex(shellIdx);
  shellGeo.computeVertexNormals();

  const shell = new THREE.Mesh(shellGeo, glassMat);
  shell.renderOrder = 2;
  group.add(shell);

  /* ---------- 5. 核心筒 ---------- */

  const corePts = [];
  for (let y = 0; y <= H; y += 8) {
    const r = Math.max(4.2, Math.min(rxAt(y), rzAt(y)) * 0.44);
    corePts.push(new THREE.Vector2(r, y));
  }
  const coreGeo = new THREE.LatheGeometry(corePts, 40);
  const core = new THREE.Mesh(coreGeo, coreMat);
  group.add(core);

  /* ---------- 6. 观景平台 ---------- */

  const decks = [];
  function addDeck(y, extra, thickness = 3.2, edge = true) {
    const rx = rxAt(y) + extra;
    const rz = rzAt(y) + extra;

    const slab = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 72, 1, false),
      deckMat
    );
    slab.scale.set(rx, thickness, rz);
    slab.position.y = y;
    group.add(slab);
    decks.push(slab);

    if (edge) {
      const rimGeo = new THREE.RingGeometry(0.962, 1, 128, 1);
      rimGeo.rotateX(-Math.PI / 2);
      const rim = new THREE.Mesh(rimGeo, deckEdgeMat);
      rim.scale.set(rx, 1, rz);
      rim.position.y = y + thickness * 0.5 + 0.2;
      rim.renderOrder = 3;
      group.add(rim);
      decks.push(rim);
    }
    return { rx, rz };
  }

  addDeck(162, 3.4, 2.8);
  addDeck(339, 5.2, 3.4);
  addDeck(428, 6.4, 3.8);
  const roof = addDeck(454, 4.6, 4.2);

  /* ---------- 7. 顶部摩天轮（泡泡缆车） ---------- */

  const wheel = new THREE.Group();
  wheel.position.y = 452.5;

  const wheelRing = new THREE.Mesh(
    new THREE.TorusGeometry(30, 0.42, 8, 128),
    ringMat
  );
  wheelRing.rotation.x = Math.PI / 2;
  wheel.add(wheelRing);

  const wheelRing2 = new THREE.Mesh(
    new THREE.TorusGeometry(30, 0.16, 6, 128),
    deckEdgeMat
  );
  wheelRing2.rotation.x = Math.PI / 2;
  wheelRing2.position.y = 0.5;
  wheel.add(wheelRing2);

  const capsuleGeo = new THREE.SphereGeometry(1.75, 14, 12);
  const capsules = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const cap = new THREE.Mesh(capsuleGeo, capsuleMat);
    cap.position.set(Math.cos(a) * 30, 0, Math.sin(a) * 30);
    cap.scale.set(1, 0.82, 1);
    wheel.add(cap);
    capsules.push(cap);
  }

  // 悬挂支杆
  const spokeMat = new THREE.LineBasicMaterial({
    color: 0x5fd8f2,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const spokePts = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    spokePts.push(0, 0, 0, Math.cos(a) * 30, 0, Math.sin(a) * 30);
  }
  const spokeGeo = new THREE.BufferGeometry();
  spokeGeo.setAttribute('position', new THREE.Float32BufferAttribute(spokePts, 3));
  wheel.add(new THREE.LineSegments(spokeGeo, spokeMat));

  group.add(wheel);

  /* ---------- 8. 顶部冠部 + 天线桅杆 ---------- */

  const crownGeo = new THREE.CylinderGeometry(10.5, 26.8, 15, 56, 1, true);
  crownGeo.scale(1, 1, 20.2 / 26.8);
  const crown = new THREE.Mesh(crownGeo, steelMat);
  crown.position.y = 454 + 7.5;
  group.add(crown);

  const mastPts = [
    new THREE.Vector2(10.0, 468),
    new THREE.Vector2(7.4, 492),
    new THREE.Vector2(5.6, 518),
    new THREE.Vector2(4.0, 546),
    new THREE.Vector2(2.4, 572),
    new THREE.Vector2(1.2, 588),
    new THREE.Vector2(0.5, 600),
  ];
  const mast = new THREE.Mesh(new THREE.LatheGeometry(mastPts, 24), steelMat);
  group.add(mast);

  // 天线环箍
  const collarHeights = [480, 500, 522, 548, 570, 586];
  for (const y of collarHeights) {
    let r = 0.6;
    for (let i = 0; i < mastPts.length - 1; i++) {
      const a = mastPts[i];
      const b = mastPts[i + 1];
      if (y >= a.y && y <= b.y) {
        r = a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
        break;
      }
    }
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(r + 0.55, 0.18, 5, 28),
      ringMat
    );
    collar.rotation.x = Math.PI / 2;
    collar.position.y = y;
    group.add(collar);
  }

  /* ---------- 9. 航空障碍灯 ---------- */

  const beacons = [];
  const beaconYs = [498, 552, 598];
  for (const y of beaconYs) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), beaconMat);
    b.position.y = y;
    b.position.x = y > 590 ? 0 : 0;
    group.add(b);
    beacons.push(b);
  }

  /* ---------- 10. 基座光环 ---------- */

  const baseRing = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.0, 160, 1),
    new THREE.MeshBasicMaterial({
      color: 0x7fe9ff,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  baseRing.rotation.x = -Math.PI / 2;
  baseRing.scale.set(52, 40, 1);
  baseRing.position.y = 0.35;
  group.add(baseRing);

  /* ---------- 11. 扫描光环 ---------- */

  const scan = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 9, 96, 1, true),
    scanMat
  );
  group.add(scan);

  /* ---------- 12. 塔基玻璃裙房 ---------- */

  const skirt = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1.06, 13, 72, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x2a6d84,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  skirt.scale.set(47, 1, 36);
  skirt.position.y = 6.5;
  group.add(skirt);

  /* ============================================================
     动画
     ============================================================ */

  let scanY = 0;
  const towerCenter = new THREE.Vector3(0, 300, 0);

  function update(time, dt, camera) {
    glassMat.uniforms.uTime.value = time;

    wheel.rotation.y += dt * 0.075;

    // 密集的 1px 斜撑线在远景中容易产生摩尔纹，按相机距离柔和衰减。
    if (camera) {
      const dist = camera.position.distanceTo(towerCenter);
      const fade = 1 - THREE.MathUtils.smoothstep(dist, 900, 3200) * 0.72;
      const base = lineMat.userData.baseOpacity ?? 0.38;
      lineMat.opacity = base * fade;
    }

    // 航空灯闪烁
    const blink = Math.pow(Math.max(0, Math.sin(time * 2.2)), 6);
    beaconMat.opacity = 0.25 + blink * 0.75;
    const s = 1 + blink * 0.35;
    for (const b of beacons) b.scale.setScalar(s);

    // 扫描光环上下移动
    scanY = ((time * 26) % (H + 60)) - 10;
    const sy = Math.max(6, Math.min(H - 6, scanY));
    scan.position.y = sy;
    scan.scale.set(rxAt(sy) + 1.4, 1, rzAt(sy) + 1.4);
    const edge = Math.min(sy, H - sy) / 60;
    scanMat.opacity = 0.03 + 0.16 * Math.min(1, edge);
  }

  return {
    group,
    shell,
    wheel,
    update,
    materials: {
      steel: steelMat,
      ring: ringMat,
      line: lineMat,
      glass: glassMat,
      core: coreMat,
      deck: deckMat,
      deckEdge: deckEdgeMat,
      capsule: capsuleMat,
      beacon: beaconMat,
      scan: scanMat,
    },
    profile: { rxAt, rzAt },
    decks: { roof, wheelY: 452.5 },
  };
}
