import * as THREE from 'three';
import { createLife } from './life.js?v=15';


/* ============================================================
   珠江新城 · 环境还原
   ------------------------------------------------------------
   几何来源：OpenStreetMap（见 js/city-data.js）。
   局部坐标：1 单位 = 1 米，x 向东，z 向南，y 向上；
   原点为广州塔中心。数据由 scripts/build_city_data.py 生成。

   为兼顾真实感与实时性能：
   · 3,400+ 栋建筑合并为单次绘制，窗格由着色器按世界坐标生成；
   · 道路按等级合并为 4 个网格，车道线来自程序纹理；
   · 珠江、岛屿、公园、海心沙均使用真实 OSM 轮廓；
   · 猎德/广州/海心/华南大桥与广州塔、双塔、歌剧院等
     使用独立模型补充细节。
   ============================================================ */

const TAU = Math.PI * 2;

/* ---------- 小工具 ---------- */

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flatPoints(flat) {
  const out = [];
  // 数据可能来自建筑/道路的扁平数组，也可能是水域环的 [x, z] 点对。
  if (flat.length && Array.isArray(flat[0])) {
    for (const p of flat) out.push({ x: p[0], z: p[1] });
    return out;
  }
  for (let i = 0; i < flat.length; i += 2) {
    out.push({ x: flat[i], z: flat[i + 1] });
  }
  return out;
}

function ringArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.z - b.x * a.z;
  }
  return s * 0.5;
}

function pointInRing(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const zi = pts[i].z;
    const xj = pts[j].x;
    const zj = pts[j].z;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function centroidOf(pts) {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    z += p.z;
  }
  return { x: x / pts.length, z: z / pts.length };
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/* ============================================================
   天空
   ============================================================ */

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFrag = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uBottom;
  uniform vec3 uGlow;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunIntensity;
  uniform float uTime;
  varying vec3 vDir;

  void main() {
    float h = vDir.y * 0.5 + 0.5;
    vec3 col = mix(uBottom, uMid, smoothstep(0.46, 0.58, h));
    col = mix(col, uTop, smoothstep(0.58, 0.98, h));

    // 地平线城市光晕
    float horizon = pow(1.0 - abs(vDir.y), 15.0);
    float glowMask = smoothstep(-0.02, 0.12, vDir.y);
    col += uGlow * horizon * 0.18 * glowMask;

    // 太阳 / 月亮
    float sd = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sd, 320.0) * uSunIntensity * 1.6;
    col += uSunColor * pow(sd, 12.0) * uSunIntensity * 0.1;

    // 极淡的高空云带
    float band = sin(vDir.x * 3.0 + uTime * 0.015) * sin(vDir.z * 2.4 - uTime * 0.012);
    col += vec3(0.015, 0.03, 0.045) * smoothstep(0.25, 1.0, band) * smoothstep(0.08, 0.45, vDir.y);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ============================================================
   星空
   ============================================================ */

function createStars(count = 2200) {
  const rand = mulberry32(20240501);
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const theta = rand() * TAU;
    const phi = Math.acos(1 - rand() * 0.9);
    const r = 7200;
    const y = Math.cos(phi) * r;
    if (y < 160) {
      i--;
      continue;
    }
    pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    size[i] = 1.1 + rand() * 2.4;
    phase[i] = rand() * TAU;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.8 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // 极轻微的亮度呼吸即可，避免整片星空持续闪烁抢走注意力。
        float twinkle = 0.88 + 0.12 * sin(uTime * 0.6 + aPhase);
        vAlpha = twinkle;
        gl_PointSize = aSize * uPixelRatio * 0.95;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(c));
        gl_FragColor = vec4(vec3(0.82, 0.93, 1.0), pow(a, 2.0) * vAlpha * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return { points, mat };
}

/* ============================================================
   共享材质
   ============================================================ */

const accentMat = new THREE.MeshBasicMaterial({
  color: 0xa9efff,
  transparent: true,
  opacity: 0.7,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const warmAccentMat = new THREE.MeshBasicMaterial({
  color: 0xffc27a,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const redBeaconMat = new THREE.MeshBasicMaterial({
  color: 0xff4b5c,
  transparent: true,
  opacity: 0.85,
});

const concreteMat = new THREE.MeshStandardMaterial({
  color: 0x5a6267,
  metalness: 0.18,
  roughness: 0.78,
  emissive: 0x0d1a21,
  emissiveIntensity: 0.25,
});

const paleStoneMat = new THREE.MeshStandardMaterial({
  color: 0x8a9499,
  metalness: 0.12,
  roughness: 0.72,
  emissive: 0x16242b,
  emissiveIntensity: 0.22,
  polygonOffset: true,
  polygonOffsetFactor: 0,
  polygonOffsetUnits: -4,
});

const darkMetalMat = new THREE.MeshStandardMaterial({
  color: 0x2b343a,
  metalness: 0.65,
  roughness: 0.42,
  emissive: 0x0b1f27,
  emissiveIntensity: 0.3,
});

const whiteSteelMat = new THREE.MeshStandardMaterial({
  color: 0xdbe8ee,
  metalness: 0.55,
  roughness: 0.3,
  emissive: 0x1d4652,
  emissiveIntensity: 0.45,
});

/* ============================================================
   建筑：合并几何 + 世界坐标窗格着色器
   ============================================================ */

function makeBuildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    metalness: 0.32,
    roughness: 0.52,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.9,
    side: THREE.DoubleSide,
    fog: true,
  });

  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aSeed;
        varying float vSeed;
        varying vec3 vWPos;
        varying vec3 vWNormal;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSeed = aSeed;
        vWPos = position;
        vWNormal = normal;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vSeed;
        varying vec3 vWPos;
        varying vec3 vWNormal;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // 窗格完全由世界坐标决定，所以整座城市的窗格尺度一致。
        totalEmissiveRadiance = vec3(0.0);

        float vert = 1.0 - smoothstep(0.4, 0.62, abs(vWNormal.y));
        float faceCoord = (abs(vWNormal.x) > abs(vWNormal.z)) ? vWPos.z : vWPos.x;
        vec2 grid = vec2(faceCoord / 3.6, vWPos.y / 4.0);
        vec2 cell = floor(grid);
        vec2 f = fract(grid);

        // 屏幕空间导数：窗格小于一个像素时，把随机的亮灯 / 颜色 / 亮度
        // 平滑收敛到平均值。否则相机旋转时远处窗灯会成片闪烁（摩尔纹）。
        vec2 fw = fwidth(grid);
        float cellPx = max(fw.x, fw.y) + 1e-4;
        float detail = 1.0 - smoothstep(0.30, 0.85, cellPx);
        vec2 aa = fw * 0.8 + 1e-4;

        float wx = smoothstep(0.14 - aa.x, 0.14 + aa.x, f.x)
                 * smoothstep(0.14 - aa.x, 0.14 + aa.x, 1.0 - f.x);
        float wy = smoothstep(0.24 - aa.y, 0.24 + aa.y, f.y)
                 * smoothstep(0.14 - aa.y, 0.14 + aa.y, 1.0 - f.y);
        float win = wx * wy * vert;
        // 窗格本身小于像素时也收敛到平均占空比，避免规则网格产生远景摩尔纹
        float winMask = mix(win, 0.16 * vert, 1.0 - detail);

        float floorLit = step(0.80, hash21(vec2(cell.y + 1.0, vSeed * 71.0)));
        float cellLit = step(0.55, hash21(cell + vSeed * 37.0));
        float litDetail = clamp(floorLit * 0.85 + cellLit * 0.35, 0.0, 0.95);
        float lit = mix(0.33, litDetail, detail);

        float warm = hash21(cell.yx + vSeed * 13.0);
        vec3 winColorDetail = mix(
          vec3(0.50, 0.76, 1.0),
          vec3(1.0, 0.79, 0.52),
          step(0.52, warm)
        );
        vec3 winColor = mix(vec3(0.74, 0.79, 0.86), winColorDetail, detail);
        float energyDetail = 0.30 + 1.15 * hash21(cell * 1.7 + vSeed);
        float energy = mix(0.85, energyDetail, detail);
        totalEmissiveRadiance += winColor * winMask * lit * energy * emissive;

        // 日间幕墙的玻璃反光；夜间则让窗洞退到灯光之后
        float glass = winMask * vert * (0.32 + 0.68 * lit);
        diffuseColor.rgb = mix(
          diffuseColor.rgb,
          diffuseColor.rgb * 0.68 + vec3(0.06, 0.075, 0.085),
          glass * 0.5
        );

        // 窗棂与屋顶的暗部，让体块在白天也有层次（远景淡出，避免高频闪烁）
        float mull = clamp((1.0 - wx) + (1.0 - wy), 0.0, 1.0) * detail;
        diffuseColor.rgb *= 1.0 - 0.1 * mull * vert;
        diffuseColor.rgb *= mix(1.0, 0.58, smoothstep(0.45, 0.8, vWNormal.y));

        // 夜间楼体的微弱环境自发光，避免整座城市只剩窗点
        float facadeDetail = 0.08 + 0.22 * hash21(cell * 0.53 + vSeed * 7.0);
        float facade = mix(0.19, facadeDetail, detail);
        totalEmissiveRadiance += diffuseColor.rgb * facade * emissive * vert * 1.8;

        // 远处的窗格逐渐收敛，避免摩尔纹
        float dist = length(cameraPosition - vWPos);
        totalEmissiveRadiance *= 1.0 - smoothstep(3000.0, 6800.0, dist) * 0.35;
        `
      );
  };

  // WebGL1 下启用标准导数扩展（WebGL2 原生支持 fwidth）
  mat.extensions = { derivatives: true };

  return mat;
}

const BUILDING_PALETTE = [
  [0.46, 0.43, 0.39], // 住宅
  [0.34, 0.42, 0.48], // 商业 / 办公
  [0.50, 0.53, 0.55], // 公共建筑
  [0.27, 0.29, 0.29], // 低层 / 工业
];

function createBuildings(data, islandAt) {
  const positions = [];
  const normals = [];
  const colors = [];
  const seeds = [];
  const beacons = [];

  const contour = [];
  const holes = [];

  for (const [hRaw, kind, seed, flat] of data.buildings) {
    const pts = flatPoints(flat);
    if (pts.length < 3) continue;
    const h = Math.max(2.2, hRaw);
    const c = centroidOf(pts);
    const island = islandAt(c.x, c.z);
    const baseY = island ? 1.16 : 0.0;
    const topY = baseY + h;

    const p = BUILDING_PALETTE[kind] || BUILDING_PALETTE[1];
    const v = 0.78 + (seed - 0.5) * 0.42;
    const cr = p[0] * v;
    const cg = p[1] * v;
    const cb = p[2] * v;

    // 墙体
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.4) continue;

      let nx = dz / len;
      let nz = -dx / len;
      const mx = (a.x + b.x) * 0.5 - c.x;
      const mz = (a.z + b.z) * 0.5 - c.z;
      if (nx * mx + nz * mz < 0) {
        nx = -nx;
        nz = -nz;
      }

      const bi = positions.length / 3;
      // 两个三角形
      positions.push(
        a.x, baseY, a.z,
        a.x, topY, a.z,
        b.x, baseY, b.z,

        b.x, baseY, b.z,
        a.x, topY, a.z,
        b.x, topY, b.z
      );
      for (let k = 0; k < 6; k++) {
        normals.push(nx, 0, nz);
        colors.push(cr, cg, cb);
        seeds.push(seed);
      }
      // 轻微的面法线变化由着色器统一处理，这里只需要正确的朝向
      void bi;
    }

    // 屋顶
    try {
      contour.length = 0;
      for (const pnt of pts) contour.push(new THREE.Vector2(pnt.x, pnt.z));
      holes.length = 0;
      const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
      for (const f of faces) {
        const a = contour[f[0]];
        let b = contour[f[1]];
        let d = contour[f[2]];
        const crossY =
          (b.y - a.y) * (d.x - a.x) - (b.x - a.x) * (d.y - a.y);
        if (crossY < 0) {
          const t = b;
          b = d;
          d = t;
        }
        positions.push(
          a.x, topY, a.y,
          b.x, topY, b.y,
          d.x, topY, d.y
        );
        for (let k = 0; k < 3; k++) {
          normals.push(0, 1, 0);
          colors.push(cr, cg, cb);
          seeds.push(seed);
        }
      }
    } catch (err) {
      // 少量自交的 OSM footprint 无法三角化屋顶，墙体仍然保留。
    }

    if (h > 165) {
      beacons.push({ x: c.x, y: topY + 2.2, z: c.z });
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geo.computeBoundingSphere();

  const mat = makeBuildingMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  return { mesh, mat, beacons };
}

/* ============================================================
   道路
   ============================================================ */

function makeRoadTexture(kind) {
  const w = 128;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (kind === 3) {
    // 步行街 / 广场铺装
    ctx.fillStyle = '#6b6d68';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(35, 38, 38, 0.35)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 235, 200, 0.04)';
    for (let i = 0; i < 220; i++) {
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  } else {
    // 沥青
    ctx.fillStyle = '#41474c';
    ctx.fillRect(0, 0, w, h);

    // 人行道边缘
    const edge = kind === 2 ? 12 : kind === 1 ? 13 : 15;
    ctx.fillStyle = '#5d6468';
    ctx.fillRect(0, 0, edge, h);
    ctx.fillRect(w - edge, 0, edge, h);

    // 沥青颗粒
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let i = 0; i < 420; i++) {
      const x = edge + Math.random() * (w - edge * 2);
      const y = Math.random() * h;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    for (let i = 0; i < 260; i++) {
      const x = edge + Math.random() * (w - edge * 2);
      const y = Math.random() * h;
      ctx.fillRect(x, y, 1, 1);
    }

    const line = (x, width, color, dashed = false) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (!dashed) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      } else {
        ctx.setLineDash([18, 22]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    // 道路边缘线
    line(edge + 3, 2, 'rgba(222, 224, 210, 0.72)');
    line(w - edge - 3, 2, 'rgba(222, 224, 210, 0.72)');

    if (kind === 2) {
      // 快速路：6 车道
      line(30, 2, 'rgba(230, 232, 220, 0.55)', true);
      line(53, 2, 'rgba(230, 232, 220, 0.55)', true);
      line(75, 2, 'rgba(230, 232, 220, 0.55)', true);
      line(98, 2, 'rgba(230, 232, 220, 0.55)', true);
    } else if (kind === 1) {
      // 主干道：4 车道，双黄线
      line(45, 2, 'rgba(230, 232, 220, 0.5)', true);
      line(83, 2, 'rgba(230, 232, 220, 0.5)', true);
      line(60, 2, 'rgba(240, 198, 95, 0.9)');
      line(68, 2, 'rgba(240, 198, 95, 0.9)');
    } else {
      // 支路：双向单车道
      line(64, 2, 'rgba(232, 232, 218, 0.78)', true);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function appendRibbon(arrays, pts, width, yAt, closed = false) {
  const n = pts.length;
  if (n < 2) return;

  const segN = [];
  const segLen = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1e-6;
    segLen.push(len);
    segN.push({ x: -dz / len, z: dx / len });
  }

  const left = [];
  const right = [];
  const ys = [];
  let dist = 0;
  const vDist = [];

  for (let i = 0; i < n; i++) {
    let nx;
    let nz;
    let miter = 1;

    if (closed) {
      const prev = segN[(i - 1 + segN.length) % segN.length];
      const next = segN[i % segN.length];
      const mx = prev.x + next.x;
      const mz = prev.z + next.z;
      const ml = Math.hypot(mx, mz) || 1e-6;
      nx = mx / ml;
      nz = mz / ml;
      const dot = nx * next.x + nz * next.z;
      miter = 1 / Math.max(0.35, dot);
    } else if (i === 0) {
      nx = segN[0].x;
      nz = segN[0].z;
    } else if (i === n - 1) {
      nx = segN[n - 2].x;
      nz = segN[n - 2].z;
    } else {
      const prev = segN[i - 1];
      const next = segN[i];
      const mx = prev.x + next.x;
      const mz = prev.z + next.z;
      const ml = Math.hypot(mx, mz) || 1e-6;
      nx = mx / ml;
      nz = mz / ml;
      const dot = nx * next.x + nz * next.z;
      miter = 1 / Math.max(0.35, dot);
    }

    miter = Math.min(miter, 2.6);
    const half = width * 0.5 * miter;
    const p = pts[i];
    const y = yAt(i, p);
    left.push({ x: p.x + nx * half, z: p.z + nz * half, y });
    right.push({ x: p.x - nx * half, z: p.z - nz * half, y });
    ys.push(y);
    vDist.push(dist);
    if (i < n - 1) {
      const a = pts[i];
      const b = pts[i + 1];
      dist += Math.hypot(b.x - a.x, b.z - a.z);
    }
  }
  if (closed) {
    const a = pts[n - 1];
    const b = pts[0];
    vDist.push(dist + Math.hypot(b.x - a.x, b.z - a.z));
  }

  const pos = arrays.position;
  const uvs = arrays.uv;
  const nor = arrays.normal;
  const idx = arrays.index;
  const base = pos.length / 3;

  const uvRepeat = 30;

  for (let i = 0; i < n; i++) {
    pos.push(left[i].x, left[i].y, left[i].z);
    uvs.push(0, vDist[i] / uvRepeat);
    nor.push(0, 1, 0);
    pos.push(right[i].x, right[i].y, right[i].z);
    uvs.push(1, vDist[i] / uvRepeat);
    nor.push(0, 1, 0);
  }

  if (closed) {
    const i0 = n - 1;
    const i1 = 0;
    const aL = base + i0 * 2;
    const aR = aL + 1;
    const bL = base + i1 * 2;
    const bR = bL + 1;
    idx.push(aL, bL, aR, aR, bL, bR);
  }

  for (let i = 0; i < n - 1; i++) {
    const aL = base + i * 2;
    const aR = aL + 1;
    const bL = base + (i + 1) * 2;
    const bR = bL + 1;
    idx.push(aL, bL, aR, aR, bL, bR);
  }
}

function createRoadGeometry(data, islandAt) {
  const classes = [0, 1, 2, 3];
  const arrays = new Map();
  for (const k of classes) {
    arrays.set(k, {
      position: [],
      uv: [],
      normal: [],
      index: [],
    });
  }

  for (const [kind, width, flat] of data.roads) {
    const pts = flatPoints(flat);
    if (pts.length < 2) continue;
    const arr = arrays.get(kind) || arrays.get(0);
    const baseY = kind === 3 ? 0.36 : kind === 2 ? 0.32 : kind === 1 ? 0.3 : 0.28;
    const yAt = (i, p) => (islandAt(p.x, p.z) ? 1.3 : baseY);
    appendRibbon(arr, pts, Math.max(2.4, width), yAt, false);
  }

  const materials = {};
  const meshes = [];
  for (const k of classes) {
    const arr = arrays.get(k);
    if (!arr.position.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr.position, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(arr.uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(arr.normal, 3));
    geo.setIndex(arr.index);
    geo.computeBoundingSphere();

    const tex = makeRoadTexture(k);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.18,
      metalness: 0.06,
      roughness: 0.9,
      side: THREE.DoubleSide,
      // 贴地薄片：固定深度偏移，避免和地面 / 其他道路共面时闪烁。
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    meshes.push(mesh);
    materials[k] = mat;
  }

  return { meshes, materials };
}

/* ============================================================
   地面 / 塔基广场 / 花城广场轴线
   ============================================================ */

function makeGroundTexture() {
  const s = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8a9295';
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(168, 178, 182, 0.16)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= s; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(s, i + 0.5);
    ctx.stroke();
  }
  for (let i = 0; i < 2400; i++) {
    const a = Math.random() * 0.08;
    ctx.fillStyle = `rgba(175, 188, 192, ${a})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(82, 82);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createGround() {
  const group = new THREE.Group();

  const landMat = new THREE.MeshStandardMaterial({
    color: 0xedf0f1,
    map: makeGroundTexture(),
    metalness: 0.14,
    roughness: 0.92,
    emissive: new THREE.Color(0x0a1921),
    emissiveIntensity: 0.16,
  });
  const land = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), landMat);
  land.rotation.x = -Math.PI / 2;
  land.position.y = 0;
  group.add(land);

  // 广州塔圆形广场（半径控制在滨江岸线以内）
  const plazaGeo = new THREE.CircleGeometry(1, 128);
  plazaGeo.rotateX(-Math.PI / 2);
  const plazaMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x101b22) },
      uLine: { value: new THREE.Color(0x6fd8ee) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uLine;
      varying vec3 vWorldPos;
      void main() {
        vec2 p = vWorldPos.xz;
        float r = length(p);
        // 地面环纹 / 射线同样需要抗锯齿与远距离淡出，否则远景会闪。
        float ringCoord = r / 11.0;
        float angCoord = atan(p.y, p.x) / 6.2831853 + 0.5;
        float ringAA = fwidth(ringCoord);
        float angAA = fwidth(angCoord * 56.0);
        float rings = smoothstep(0.47 - ringAA, 0.5 + ringAA, abs(fract(ringCoord) - 0.5));
        float rays = smoothstep(0.48 - angAA, 0.5 + angAA, abs(fract(angCoord * 56.0) - 0.5));
        float detail = (1.0 - smoothstep(0.15, 0.6, ringAA))
                     * (1.0 - smoothstep(0.15, 0.6, angAA));
        vec3 col = uColor + uLine * max(rings * 0.4, rays * 0.22) * 0.26 * detail;
        col += uLine * exp(-r / 52.0) * 0.45;
        float pulse = sin(r * 0.06 - uTime * 0.8) * 0.5 + 0.5;
        col += uLine * pulse * exp(-r / 95.0) * 0.08;
        gl_FragColor = vec4(col, 1.0 - smoothstep(100.0, 120.0, r));
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
  });
  const plaza = new THREE.Mesh(plazaGeo, plazaMat);
  plaza.scale.setScalar(120);
  plaza.position.y = 0.55;
  group.add(plaza);

  // 花城广场中央步行轴
  const axis = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 1540),
    new THREE.MeshStandardMaterial({
      color: 0x899398,
      metalness: 0.1,
      roughness: 0.78,
      emissive: 0x16262e,
      emissiveIntensity: 0.28,
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -4,
    })
  );
  axis.rotation.x = -Math.PI / 2;
  axis.position.set(0, 0.70, -1510);
  group.add(axis);

  // 轴线两侧的暖色灯带
  for (const x of [-11, 11]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1530), warmAccentMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.82, -1510);
    group.add(strip);
  }

  // 双塔北广场、图书馆/博物馆前广场。
  // 两块广场在 z 向有重叠，必须拉开高度差，否则远景会 z-fighting。
  const plazaA = new THREE.Mesh(new THREE.PlaneGeometry(360, 380), paleStoneMat);
  plazaA.rotation.x = -Math.PI / 2;
  plazaA.position.set(0, 0.58, -1280);
  group.add(plazaA);

  const plazaB = new THREE.Mesh(new THREE.PlaneGeometry(300, 360), paleStoneMat);
  plazaB.rotation.x = -Math.PI / 2;
  plazaB.position.set(0, 0.46, -1030);
  group.add(plazaB);

  // 海心沙北侧亲水平台
  const islandDeck = new THREE.Mesh(new THREE.PlaneGeometry(260, 60), paleStoneMat);
  islandDeck.rotation.x = -Math.PI / 2;
  islandDeck.position.set(70, 1.36, -685);
  group.add(islandDeck);

  return { group, plazaMat, landMat };
}

/* ============================================================
   公园 / 珠江 / 岛屿 / 滨江步道
   ============================================================ */

function addFlatPolygon(arrays, pts, y, holes = []) {
  if (pts.length < 3) return;
  const contour = pts.map((p) => new THREE.Vector2(p.x, p.z));
  let holeShapes = [];
  if (holes.length) {
    holeShapes = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.z)));
  }
  let faces;
  try {
    faces = THREE.ShapeUtils.triangulateShape(contour, holeShapes);
  } catch (err) {
    return;
  }
  const all = contour.concat(...holeShapes);
  const pos = arrays.position;
  const nor = arrays.normal;
  for (const f of faces) {
    const a = all[f[0]];
    let b = all[f[1]];
    let c = all[f[2]];
    // 统一为朝上的正面，避免背面法线翻转导致地面发黑
    const crossY =
      (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
    if (crossY < 0) {
      const t = b;
      b = c;
      c = t;
    }
    pos.push(a.x, y, a.y, b.x, y, b.y, c.x, y, c.y);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
}

function createParks(data, islandAt) {
  const green = { position: [], normal: [] };
  const pitch = { position: [], normal: [] };

  for (const [kind, flat] of data.parks) {
    const pts = flatPoints(flat);
    if (pts.length < 3) continue;
    const c = centroidOf(pts);
    const y = islandAt(c.x, c.z) ? 1.27 : 0.16;
    addFlatPolygon(kind === 1 ? pitch : green, pts, y);
  }

  const group = new THREE.Group();

  const greenMat = new THREE.MeshStandardMaterial({
    color: 0x4a7c54,
    roughness: 0.94,
    metalness: 0.01,
    emissive: new THREE.Color(0x0a1b0f),
    emissiveIntensity: 0.4,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: -4,
  });
  const pitchMat = new THREE.MeshStandardMaterial({
    color: 0x47865a,
    roughness: 0.92,
    metalness: 0.01,
    emissive: new THREE.Color(0x0b2114),
    emissiveIntensity: 0.35,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: -4,
  });

  for (const [arr, mat] of [
    [green, greenMat],
    [pitch, pitchMat],
  ]) {
    if (!arr.position.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(arr.normal, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  return { group, greenMat, pitchMat };
}

function createWater(data, islandAt) {
  const group = new THREE.Group();
  const rivers = data.water.rivers;
  const islands = data.water.islands;
  const islandPts = islands.map((flat) => flatPoints(flat));

  const uniforms = {
    uTime: { value: 0 },
    uDeep: { value: new THREE.Color(0x031019) },
    uShallow: { value: new THREE.Color(0x0a2838) },
    uGlow: { value: new THREE.Color(0x3b9dbb) },
    uFog: { value: new THREE.Color(0x0e2838) },
    uSunColor: { value: new THREE.Color(0xcfe9ff) },
    uSunDir: { value: new THREE.Vector3(0.55, 0.34, 0.76).normalize() },
    uSunIntensity: { value: 0.55 },
    uLights: {
      value: Array.from({ length: 10 }, () => new THREE.Vector4(0, 0, 1, 0)),
    },
    uLightColors: {
      value: Array.from({ length: 10 }, () => new THREE.Color(0x9fe8ff)),
    },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uGlow;
      uniform vec3 uFog;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform float uSunIntensity;
      uniform vec4 uLights[10];
      uniform vec3 uLightColors[10];
      varying vec3 vWorldPos;

      void main() {
        vec2 p = vWorldPos.xz;
        float t = uTime * 0.16;

        // 近岸浅、江心深
        float south = exp(-abs(p.y + 138.0) / 170.0);
        float north = exp(-abs(p.y + 731.0) / 170.0);
        float island = exp(-abs(p.y + 555.0) / 130.0)
          * (1.0 - smoothstep(280.0, 560.0, abs(p.x - 70.0)));
        float edge = clamp(south + north + island * 0.5, 0.0, 1.0);

        vec3 col = mix(uDeep, uShallow, 0.26 + 0.38 * edge);

        // 低频水纹：保持安静、避免摩尔纹
        float w1 = sin(p.x * 0.012 + p.y * 0.021 + t * 1.3);
        float w2 = sin(p.x * 0.034 - p.y * 0.011 - t * 0.8);
        float w3 = sin(p.x * 0.006 - p.y * 0.026 + t * 0.45);
        float ripple = w1 * 0.5 + w2 * 0.32 + w3 * 0.18;
        vec3 N = normalize(vec3(w2 * 0.045, 1.0, w1 * 0.028));

        col += uGlow * (0.024 + ripple * 0.022) * (0.35 + edge * 0.65);

        // 天空/城市漫反射
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 2.6);
        col = mix(col, uFog * 1.15 + uGlow * 0.08, fres * 0.38);

        // 太阳/月亮高光
        vec3 L = normalize(uSunDir);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 160.0);
        col += uSunColor * spec * 0.55 * (0.25 + uSunIntensity);

        // 桥、塔、游船在水面的倒影光带。
        // 使用更低的频率和更慢的流动，并按屏幕导数在远处收敛到平均值，
        // 避免倒影光带在远景中高频闪烁。
        for (int i = 0; i < 10; i++) {
          vec4 lt = uLights[i];
          if (lt.w <= 0.001) continue;
          float dx = p.x - lt.x;
          float dz = p.y - lt.y;
          float width = lt.z;
          float streak = exp(-dx * dx / (width * width));
          float fall = exp(-abs(dz) / (70.0 + width * 0.45));
          float shimmerDetail = 0.35 + 0.65 * pow(max(0.0, sin(p.y * 0.07 + t * 2.2 + float(i) * 1.7)), 2.0);
          float shimmerAA = fwidth(p.y * 0.07);
          float shimmer = mix(0.675, shimmerDetail, 1.0 - smoothstep(0.2, 0.7, shimmerAA));
          col += uLightColors[i] * streak * fall * shimmer * lt.w * 0.34;
        }

        // 远处融入雾气
        float d = length(p - cameraPosition.xz);
        col = mix(col, uFog * 0.82, smoothstep(1500.0, 6200.0, d));

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
    extensions: { derivatives: true },
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: -4,
  });

  // 每条河段单独建网格，轻微抬高避免重叠处闪烁。
  rivers.forEach((flat, idx) => {
    const pts = flatPoints(flat);
    if (pts.length < 3) return;
    const holes = [];
    for (const isl of islandPts) {
      const c = centroidOf(isl);
      if (pointInRing(c.x, c.z, pts)) holes.push(isl);
    }
    const arr = { position: [], normal: [] };
    addFlatPolygon(arr, pts, 1.0 + idx * 0.006, holes);
    if (!arr.position.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(arr.normal, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  });

  // 小池塘
  const pondArr = { position: [], normal: [] };
  for (const flat of data.water.ponds) {
    const pts = flatPoints(flat);
    if (pts.length < 3) continue;
    addFlatPolygon(pondArr, pts, 0.58);
  }
  if (pondArr.position.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pondArr.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(pondArr.normal, 3));
    geo.computeBoundingSphere();
    const pondMat = new THREE.MeshStandardMaterial({
      color: 0x0c2b39,
      metalness: 0.55,
      roughness: 0.18,
      emissive: 0x0a2130,
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(geo, pondMat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  // 岛屿陆地
  const islandMat = new THREE.MeshStandardMaterial({
    color: 0x50785a,
    roughness: 0.92,
    metalness: 0.02,
    emissive: 0x0a1b12,
    emissiveIntensity: 0.35,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: -6,
  });
  const islandArr = { position: [], normal: [] };
  for (const isl of islandPts) {
    addFlatPolygon(islandArr, isl, 1.1);
  }
  if (islandArr.position.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(islandArr.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(islandArr.normal, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, islandMat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  return { group, mat, uniforms, islands: islandPts };
}

function appendWall(arrays, pts, y0, y1, closed = true) {
  const pos = arrays.position;
  const nor = arrays.normal;
  const n = pts.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) continue;
    const nx = dz / len;
    const nz = -dx / len;
    pos.push(
      a.x, y0, a.z,
      b.x, y0, b.z,
      a.x, y1, a.z,
      b.x, y0, b.z,
      b.x, y1, b.z,
      a.x, y1, a.z
    );
    for (let k = 0; k < 6; k++) nor.push(nx, 0, nz);
  }
}

function createRiverFront(data) {
  const group = new THREE.Group();
  const wallArr = { position: [], normal: [] };
  const walkArr = { position: [], uv: [], normal: [], index: [] };
  const lightArr = { position: [], uv: [], normal: [], index: [] };
  const rings = data.water.rivers.map((flat) => flatPoints(flat));
  const islandRings = data.water.islands.map((flat) => flatPoints(flat));

  const allRings = rings.concat(islandRings);
  for (const ring of allRings) {
    const yTop = 1.18;
    appendWall(wallArr, ring, -0.1, yTop, true);
    appendRibbon(walkArr, ring, 9.5, () => 1.22, true);
    appendRibbon(lightArr, ring, 0.45, () => 1.32, true);
  }

  if (wallArr.position.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(wallArr.position, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(wallArr.normal, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, concreteMat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  if (walkArr.position.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(walkArr.position, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(walkArr.uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(walkArr.normal, 3));
    geo.setIndex(walkArr.index);
    geo.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8a9295,
      metalness: 0.1,
      roughness: 0.8,
      emissive: 0x14242b,
      emissiveIntensity: 0.28,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -5,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  if (lightArr.position.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(lightArr.position, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(lightArr.uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(lightArr.normal, 3));
    geo.setIndex(lightArr.index);
    const mesh = new THREE.Mesh(geo, warmAccentMat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  return { group, rings, islandRings };
}

/* ============================================================
   地标细节
   ============================================================ */

function createEastTower(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const facade = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2a4753';
    ctx.fillRect(0, 0, 128, 512);
    for (let y = 0; y < 512; y += 16) {
      for (let x = 0; x < 128; x += 8) {
        const lit = Math.random() > 0.52;
        ctx.fillStyle = lit
          ? `rgba(${150 + Math.random() * 80}, ${210 + Math.random() * 30}, 245, ${0.4 + Math.random() * 0.5})`
          : 'rgba(40, 70, 84, 0.85)';
        ctx.fillRect(x + 2, y + 3, 4, 9);
      }
    }
    ctx.strokeStyle = 'rgba(150, 230, 255, 0.28)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 128; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, 512);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 12);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xdceef4,
    map: facade,
    emissive: 0xffffff,
    emissiveMap: facade,
    emissiveIntensity: 0.6,
    metalness: 0.5,
    roughness: 0.3,
  });

  // 裙楼
  const podium = new THREE.Mesh(new THREE.BoxGeometry(112, 26, 96), glassMat);
  podium.position.y = 13;
  group.add(podium);
  const podiumBand = new THREE.Mesh(new THREE.BoxGeometry(114, 1.4, 98), accentMat);
  podiumBand.position.y = 26.4;
  group.add(podiumBand);

  const sections = [
    { y0: 0, y1: 120, w: 68 },
    { y0: 120, y1: 360, w: 60 },
    { y0: 360, y1: 480, w: 51 },
    { y0: 480, y1: 522, w: 38 },
  ];
  const rFor = (w) => w / Math.SQRT2;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const next = sections[i + 1];
    const topW = next ? next.w : 30;
    const geo = new THREE.CylinderGeometry(
      rFor(topW),
      rFor(s.w),
      s.y1 - s.y0,
      4,
      1,
      false
    );
    const m = new THREE.Mesh(geo, glassMat);
    m.position.y = (s.y0 + s.y1) / 2;
    m.rotation.y = Math.PI / 4;
    group.add(m);
  }

  // 顶部冠部
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0xcfeef7,
    emissive: 0x3a93a8,
    emissiveIntensity: 0.18,
    metalness: 0.3,
    roughness: 0.25,
    transparent: true,
    opacity: 0.55,
  });
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(16, 26, 10, 4), crownMat);
  crown.position.y = 527;
  crown.rotation.y = Math.PI / 4;
  group.add(crown);

  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(28, 0.7, 6, 32), accentMat);
  crownRing.rotation.x = Math.PI / 2;
  crownRing.position.y = 522;
  group.add(crownRing);

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.7, 8, 6), redBeaconMat);
  beacon.position.y = 536;
  group.add(beacon);

  // 四角竖向灯带
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.1, 430, 1.1), accentMat);
    strip.position.set(sx * 25, 250, sz * 25);
    group.add(strip);
  }

  return group;
}

function createWestTowerDetails(x, z, h) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(38, 0.8, 6, 48), accentMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = h - 14;
  group.add(ring);

  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(36, 0.5, 6, 48), accentMat);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = h - 28;
  group.add(ring2);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(30, 38, 7, 48),
    new THREE.MeshStandardMaterial({
      color: 0xbfd6df,
      metalness: 0.6,
      roughness: 0.35,
      emissive: 0x1d4c5a,
      emissiveIntensity: 0.7,
    })
  );
  cap.position.y = h - 2;
  group.add(cap);

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), redBeaconMat);
  beacon.position.y = h + 5;
  group.add(beacon);

  return group;
}

function createCitic() {
  const group = new THREE.Group();
  group.position.set(25, 0, -3975);

  const pod = new THREE.Mesh(new THREE.BoxGeometry(150, 20, 100), darkMetalMat);
  pod.position.y = 10;
  group.add(pod);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x68747c,
    metalness: 0.55,
    roughness: 0.42,
    emissive: 0x122a34,
    emissiveIntensity: 0.45,
  });

  const tower = (ox, h, w) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    b.position.set(ox, h / 2 + 12, 0);
    group.add(b);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(2, w * 0.55, 26, 4), mat);
    top.position.set(ox, h + 12 + 13, 0);
    top.rotation.y = Math.PI / 4;
    group.add(top);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), redBeaconMat);
    beacon.position.set(ox, h + 12 + 28, 0);
    group.add(beacon);
  };

  tower(-55, 380, 46);
  tower(55, 350, 44);

  const band = new THREE.Mesh(new THREE.BoxGeometry(154, 1.5, 102), accentMat);
  band.position.y = 20.5;
  group.add(band);

  return group;
}

function createOpera() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb8c3c7,
    metalness: 0.32,
    roughness: 0.4,
    emissive: 0x1b3a44,
    emissiveIntensity: 0.4,
    side: THREE.DoubleSide,
  });

  const a = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), mat);
  a.scale.set(72, 21, 54);
  a.position.set(-142, 8, -1004);
  a.rotation.y = -0.25;
  group.add(a);

  const b = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 20), mat);
  b.scale.set(54, 16, 42);
  b.position.set(-66, 6, -978);
  b.rotation.y = 0.35;
  group.add(b);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 4, 64), accentMat);
  rim.scale.set(64, 48, 1);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(-142, 28, -1004);
  group.add(rim);

  return group;
}

function createMuseum(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x48201f,
    metalness: 0.25,
    roughness: 0.55,
    emissive: 0x2a0c0c,
    emissiveIntensity: 0.45,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(108, 28, 108), bodyMat);
  body.position.y = 14;
  group.add(body);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(116, 2.2, 116), darkMetalMat);
  roof.position.y = 28.8;
  group.add(roof);

  // 金色横向与竖向饰带
  for (let y = 5; y < 28; y += 5.5) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(109, 0.45, 109), warmAccentMat);
    band.position.y = y;
    group.add(band);
  }
  for (let i = -4; i <= 4; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 22, 0.42), warmAccentMat);
    strip.position.set(i * 11, 15, 54.6);
    group.add(strip);
    const strip2 = strip.clone();
    strip2.position.z = -54.6;
    group.add(strip2);
    const strip3 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 22, 0.42), warmAccentMat);
    strip3.position.set(54.6, 15, i * 11);
    group.add(strip3);
    const strip4 = strip3.clone();
    strip4.position.x = -54.6;
    group.add(strip4);
  }

  return group;
}

function createLibrary(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xb7c2c6,
    metalness: 0.28,
    roughness: 0.46,
    emissive: 0x1b353e,
    emissiveIntensity: 0.35,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(136, 24, 88), mat);
  base.position.y = 12;
  base.rotation.y = -0.08;
  group.add(base);

  // 倾斜的屋面
  const roof = new THREE.Mesh(new THREE.BoxGeometry(148, 3.2, 98), darkMetalMat);
  roof.position.y = 27;
  roof.rotation.z = -0.09;
  roof.rotation.y = -0.08;
  group.add(roof);

  for (let y = 6; y < 24; y += 6) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(137, 0.5, 89), accentMat);
    band.position.y = y;
    band.rotation.y = -0.08;
    group.add(band);
  }

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), redBeaconMat);
  beacon.position.y = 31;
  group.add(beacon);

  return group;
}

function createStadium(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 1.28, z);

  const bowlMat = new THREE.MeshStandardMaterial({
    color: 0xb6c7ce,
    metalness: 0.4,
    roughness: 0.45,
    emissive: 0x16333d,
    emissiveIntensity: 0.4,
    side: THREE.DoubleSide,
  });
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.05, 17, 72, 1, true), bowlMat);
  bowl.scale.set(158, 1, 92);
  bowl.position.y = 8.5;
  group.add(bowl);

  const rim = new THREE.Mesh(new THREE.RingGeometry(0.955, 1, 96), accentMat);
  rim.rotation.x = -Math.PI / 2;
  rim.scale.set(158, 92, 1);
  rim.position.y = 17.2;
  group.add(rim);

  const field = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({
      color: 0x3f7a4d,
      roughness: 0.9,
      emissive: 0x1a4326,
      emissiveIntensity: 0.65,
    })
  );
  field.rotation.x = -Math.PI / 2;
  field.scale.set(128, 64, 1);
  field.position.y = 0.7;
  group.add(field);

  // 田径跑道
  const track = new THREE.Mesh(
    new THREE.RingGeometry(0.84, 0.99, 80),
    new THREE.MeshStandardMaterial({
      color: 0x8c5648,
      roughness: 0.92,
      emissive: 0x2c0f0b,
      emissiveIntensity: 0.45,
    })
  );
  track.rotation.x = -Math.PI / 2;
  track.scale.set(158, 92, 1);
  track.position.y = 0.62;
  group.add(track);

  // 四角灯柱
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const px = dx * 146;
      const pz = dz * 76;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 34, 8), concreteMat);
      pole.position.set(px, 17, pz);
      group.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(7, 2.2, 7), warmAccentMat);
      lamp.position.set(px, 34.5, pz);
      group.add(lamp);
    }
  }

  return group;
}

function createCantonPier() {
  const group = new THREE.Group();
  group.position.set(260, 0.2, -185);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(54, 2, 14), concreteMat);
  deck.position.y = 1.5;
  group.add(deck);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(42, 1.2, 12), darkMetalMat);
  roof.position.y = 8;
  group.add(roof);

  for (const x of [-18, 0, 18]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6.5, 6), whiteSteelMat);
    col.position.set(x, 4.5, 0);
    group.add(col);
  }

  const glow = new THREE.Mesh(new THREE.BoxGeometry(40, 0.45, 0.5), warmAccentMat);
  glow.position.set(0, 8.7, 6.4);
  group.add(glow);

  // 停靠的小渡轮
  const boat = new THREE.Group();
  boat.position.set(0, 1.8, -12);
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(26, 2.2, 6),
    new THREE.MeshStandardMaterial({ color: 0xd6e3e8, metalness: 0.3, roughness: 0.5 })
  );
  hull.position.y = 1;
  boat.add(hull);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(16, 3.2, 4.6),
    new THREE.MeshStandardMaterial({ color: 0x8fb6c2, metalness: 0.35, roughness: 0.4 })
  );
  cabin.position.y = 3.2;
  boat.add(cabin);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(17, 0.7, 4.8), warmAccentMat);
  windows.position.y = 3.7;
  boat.add(windows);
  group.add(boat);

  return group;
}

/* ============================================================
   桥梁
   ============================================================ */

function buildBridge({
  points,
  width,
  deckY,
  ramp,
  railingMat,
  name,
  pierMat = concreteMat,
}) {
  const group = new THREE.Group();
  const pts = points.map(([x, z]) => ({ x, z }));
  const n = pts.length;

  const dists = [0];
  for (let i = 1; i < n; i++) {
    dists.push(dists[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const total = dists[n - 1];

  const yAt = (i) => {
    const d = dists[i];
    const a = clamp(d / ramp, 0, 1);
    const b = clamp((total - d) / ramp, 0, 1);
    return deckY * Math.min(a, b);
  };

  const deckArr = { position: [], uv: [], normal: [], index: [] };
  appendRibbon(deckArr, pts, width, (i) => yAt(i), false);

  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deckArr.position, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(deckArr.uv, 2));
  deckGeo.setAttribute('normal', new THREE.Float32BufferAttribute(deckArr.normal, 3));
  deckGeo.setIndex(deckArr.index);
  deckGeo.computeBoundingSphere();

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x6c787d,
    metalness: 0.35,
    roughness: 0.55,
    emissive: 0x162e37,
    emissiveIntensity: 0.38,
    side: THREE.DoubleSide,
  });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  group.add(deck);

  // 两侧灯带 / 护栏
  for (const side of [-1, 1]) {
    const edge = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1e-6;
      const nx = -dz / len;
      const nz = dx / len;
      edge.push({
        x: pts[i].x + nx * (width * 0.5 - 0.4) * side,
        z: pts[i].z + nz * (width * 0.5 - 0.4) * side,
      });
    }
    const railArr = { position: [], uv: [], normal: [], index: [] };
    appendRibbon(railArr, edge, 0.5, (i) => yAt(i) + 1.15, false);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(railArr.position, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(railArr.uv, 2));
    rg.setAttribute('normal', new THREE.Float32BufferAttribute(railArr.normal, 3));
    rg.setIndex(railArr.index);
    const rail = new THREE.Mesh(rg, railingMat);
    rail.frustumCulled = false;
    group.add(rail);
  }

  // 桥墩
  const pierGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const piers = [];
  for (let i = 2; i < n - 2; i++) {
    const y = yAt(i);
    if (y < deckY * 0.6) continue;
    if (i > 2 && dists[i] - dists[i - 1] < 20 && piers.length) continue;
    piers.push({ x: pts[i].x, z: pts[i].z, y });
  }
  // 限制桥墩间距大致 70m
  const picked = [];
  let last = -1e9;
  for (const p of piers) {
    if (Math.abs(p.z - last) > 62) {
      picked.push(p);
      last = p.z;
    }
  }
  for (const p of picked) {
    for (const off of [-width * 0.28, width * 0.28]) {
      const m = new THREE.Mesh(pierGeo, pierMat);
      m.scale.set(2.1, Math.max(1, p.y), 2.1);
      m.position.set(p.x + off, p.y / 2, p.z);
      group.add(m);
    }
  }

  group.userData = { name, pts, dists, total, yAt, width, deckY };
  return group;
}

function createBridges() {
  const group = new THREE.Group();
  const curves = [];
  const beacons = [];

  // ---------- 广州大桥 ----------
  {
    const pts = [
      [-866, 212], [-871, 120], [-884, 16], [-901, -79], [-937, -283],
      [-949, -365], [-953, -405], [-962, -574], [-963, -790],
    ];
    const bridge = buildBridge({
      points: pts,
      width: 27,
      deckY: 10,
      ramp: 120,
      railingMat: warmAccentMat,
      name: '广州大桥',
    });
    group.add(bridge);
    curves.push({ bridge, color: 0xffd39a, speed: 0.000028, count: 34, id: 'gz' });
  }

  // ---------- 猎德大桥（独塔斜拉） ----------
  {
    const pts = [
      [964, -101], [960, -234], [955, -401], [952, -493], [950, -538],
      [946, -667], [940, -820], [939, -859], [937, -920], [935, -996],
    ];
    const bridge = buildBridge({
      points: pts,
      width: 29,
      deckY: 13,
      ramp: 130,
      railingMat: accentMat,
      name: '猎德大桥',
    });
    group.add(bridge);

    const px = 950;
    const pz = -652;
    const pylon = new THREE.Group();
    pylon.position.set(px, 0, pz);

    const legMat = whiteSteelMat;
    const leftCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-16, 0, 6),
      new THREE.Vector3(-9, 38, 2),
      new THREE.Vector3(-2, 78, -3),
      new THREE.Vector3(-10, 116, -9),
      new THREE.Vector3(-4, 132, -4),
    ]);
    const rightCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(16, 0, 6),
      new THREE.Vector3(13, 38, 2),
      new THREE.Vector3(8, 78, -3),
      new THREE.Vector3(3, 116, -9),
      new THREE.Vector3(-4, 132, -4),
    ]);
    for (const curve of [leftCurve, rightCurve]) {
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 3.2, 8, false), legMat);
      pylon.add(mesh);
    }
    for (const y of [38, 76, 112]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(22, 1.3, 2.2), whiteSteelMat);
      brace.position.set(0, y, -1);
      pylon.add(brace);
    }

    const topGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 16, 6), accentMat);
    topGlow.position.set(-4, 138, -5);
    pylon.add(topGlow);

    const red = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), redBeaconMat);
    red.position.set(-4, 147, -4);
    pylon.add(red);
    beacons.push(red);

    group.add(pylon);

    // 斜拉索
    const cablePts = [];
    const anchorY = 12.5;
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const topY = 58 + t * 70;
      const topZ = -9 - t * 2;
      const north = -800 + t * 280;
      const south = -500 + t * 340;
      cablePts.push(px - 4, topY, pz + topZ, px, anchorY, north);
      cablePts.push(px - 4, topY, pz + topZ, px, anchorY, south);
    }
    const cableGeo = new THREE.BufferGeometry();
    cableGeo.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
    group.add(
      new THREE.LineSegments(
        cableGeo,
        new THREE.LineBasicMaterial({
          color: 0xb8f6ff,
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
    );

    curves.push({ bridge, color: 0xc8f4ff, speed: 0.000032, count: 40, id: 'ld' });
  }

  // ---------- 海心桥（步行拱桥） ----------
  {
    const pts = [
      [-382, -96], [-405, -132], [-440, -176], [-468, -220],
      [-486, -268], [-480, -316], [-454, -356], [-430, -382],
    ];
    const bridge = buildBridge({
      points: pts,
      width: 8.5,
      deckY: 6.2,
      ramp: 65,
      railingMat: warmAccentMat,
      name: '海心桥',
    });
    group.add(bridge);

    const archCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-382, 6.2, -96),
      new THREE.Vector3(-420, 32, -160),
      new THREE.Vector3(-500, 58, -245),
      new THREE.Vector3(-478, 34, -330),
      new THREE.Vector3(-430, 6.2, -382),
    ]);
    const arch = new THREE.Mesh(
      new THREE.TubeGeometry(archCurve, 48, 2.6, 8, false),
      whiteSteelMat
    );
    group.add(arch);

    const archGlow = new THREE.Mesh(
      new THREE.TubeGeometry(archCurve, 48, 0.7, 6, false),
      accentMat
    );
    archGlow.position.y = 2.1;
    group.add(archGlow);

    const hangers = [];
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      const top = archCurve.getPoint(t);
      // Approximate the deck point under the arch.
      const deck = new THREE.Vector3(
        lerp(-382, -430, t),
        6.2,
        lerp(-96, -382, t)
      );
      hangers.push(top.x, top.y, top.z, deck.x, deck.y, deck.z);
    }
    const hangerGeo = new THREE.BufferGeometry();
    hangerGeo.setAttribute('position', new THREE.Float32BufferAttribute(hangers, 3));
    group.add(
      new THREE.LineSegments(
        hangerGeo,
        new THREE.LineBasicMaterial({
          color: 0xffe1b8,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        })
      )
    );

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), redBeaconMat);
    beacon.position.set(-500, 60, -245);
    group.add(beacon);
    beacons.push(beacon);
  }

  // ---------- 华南大桥（远景） ----------
  {
    const pts = [
      [2743, -80], [2741, -260], [2743, -470], [2741, -690], [2740, -820],
    ];
    const bridge = buildBridge({
      points: pts,
      width: 32,
      deckY: 15,
      ramp: 150,
      railingMat: warmAccentMat,
      name: '华南大桥',
    });
    group.add(bridge);

    const pylon = new THREE.Mesh(new THREE.BoxGeometry(10, 158, 10), whiteSteelMat);
    pylon.position.set(2742, 79, -560);
    group.add(pylon);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(11, 1.8, 11), accentMat);
    glow.position.set(2742, 158, -560);
    group.add(glow);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), redBeaconMat);
    beacon.position.set(2742, 162, -560);
    group.add(beacon);
    beacons.push(beacon);

    const cables = [];
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const y = 40 + t * 110;
      const z = -700 + t * 130;
      cables.push(2742, y, -560, 2742, 16, z);
      cables.push(2742, y, -560, 2742, 16, -420 - t * 130);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
    group.add(
      new THREE.LineSegments(
        cg,
        new THREE.LineBasicMaterial({
          color: 0xa9efff,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        })
      )
    );
  }

  return { group, curves, beacons };
}

/* ============================================================
   树木
   ============================================================ */

function createTrees(data, islandAt, riverRings) {
  const rand = mulberry32(90210);
  const items = [];
  const palms = [];

  const isWater = (x, z) => {
    for (const ring of riverRings) {
      if (pointInRing(x, z, ring)) {
        let onIsland = false;
        for (const isl of data.water.islands) {
          if (pointInRing(x, z, flatPoints(isl))) {
            onIsland = true;
            break;
          }
        }
        if (!onIsland) return true;
      }
    }
    return false;
  };

  const addTree = (x, z, y, scale = 1) => {
    if (isWater(x, z)) return;
    const s = scale * (0.7 + rand() * 0.6);
    items.push({ x, z, y, s, ry: rand() * TAU });
  };

  // 滨江步道树列
  for (const ring of riverRings) {
    for (let i = 0; i < ring.length; i += 3) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      for (const s of [-1, 1]) {
        const x = a.x + nx * 13 * s;
        const z = a.z + nz * 13 * s;
        if (isWater(x, z)) continue;
        if (islandAt(x, z)) {
          if (rand() > 0.45) palms.push({ x, z, y: 1.3, s: 0.8 + rand() * 0.4 });
        } else if (rand() > 0.4) {
          addTree(x, z, 1.24, 0.9);
        }
      }
    }
  }

  // 海心沙环岛
  for (const isl of data.water.islands) {
    const pts = flatPoints(isl);
    for (let i = 0; i < pts.length; i += 2) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const cx = (a.x + b.x) * 0.5;
      const cz = (a.z + b.z) * 0.5;
      if (Math.abs(cx - 70) > 600 || Math.abs(cz + 555) > 180) continue;
      addTree(cx, cz, 1.3, 0.8);
    }
  }

  // 花城广场整齐的行道树
  for (let z = -760; z > -2270; z -= 27) {
    for (const x of [-132, -105, -42, 42, 105, 132]) {
      if (rand() < 0.12) continue;
      addTree(x + (rand() - 0.5) * 4, z + (rand() - 0.5) * 4, 0.36, 0.85);
    }
  }

  // 公园里的散植树
  let parkCount = 0;
  for (const [kind, flat] of data.parks) {
    if (kind !== 0) continue;
    const pts = flatPoints(flat);
    const area = Math.abs(ringArea(pts));
    if (area < 600) continue;
    const n = Math.min(7, Math.floor(area / 4500));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    for (let i = 0; i < n; i++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const x = minX + rand() * (maxX - minX);
        const z = minZ + rand() * (maxZ - minZ);
        if (pointInRing(x, z, pts)) {
          addTree(x, z, islandAt(x, z) ? 1.3 : 0.28, 0.9);
          parkCount++;
          break;
        }
      }
    }
  }

  // 主要道路行道树
  for (const [kind, width, flat] of data.roads) {
    if (kind < 1) continue;
    const pts = flatPoints(flat);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      acc += len;
      if (acc < 55) continue;
      acc = 0;
      const nx = -dz / (len || 1);
      const nz = dx / (len || 1);
      for (const s of [-1, 1]) {
        const x = b.x + nx * (width * 0.5 + 7) * s;
        const z = b.z + nz * (width * 0.5 + 7) * s;
        if (isWater(x, z)) continue;
        if (rand() < 0.55) addTree(x, z, islandAt(x, z) ? 1.3 : 0.3, 0.75);
      }
    }
  }

  // 树的数量上限，保持实例化网格轻量
  const maxTrees = 2200;
  const treeItems = items.slice(0, maxTrees);
  const palmItems = palms.slice(0, 180);

  const trunkGeo = new THREE.CylinderGeometry(0.55, 0.85, 5.6, 5);
  trunkGeo.translate(0, 2.8, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(4.4, 0);
  canopyGeo.translate(0, 8.3, 0);

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x3a2b21,
    roughness: 0.95,
    metalness: 0.02,
  });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x315f3e,
    roughness: 0.9,
    metalness: 0.02,
    emissive: new THREE.Color(0x08180e),
    emissiveIntensity: 0.5,
  });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeItems.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeItems.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  for (let i = 0; i < treeItems.length; i++) {
    const t = treeItems[i];
    dummy.position.set(t.x, t.y, t.z);
    dummy.rotation.set(0, t.ry, 0);
    dummy.scale.set(t.s, t.s, t.s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    canopies.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.28 + rand() * 0.06, 0.32 + rand() * 0.14, 0.26 + rand() * 0.12);
    canopies.setColorAt(i, col);
  }
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.add(trunks, canopies);

  // 棕榈树
  if (palmItems.length) {
    const pTrunkGeo = new THREE.CylinderGeometry(0.28, 0.52, 9.5, 5);
    pTrunkGeo.translate(0, 4.75, 0);
    const pCanopyGeo = new THREE.ConeGeometry(4.2, 2.5, 7, 1, true);
    pCanopyGeo.translate(0, 9.8, 0);
    const pTrunkMat = new THREE.MeshStandardMaterial({
      color: 0x6b5940,
      roughness: 0.95,
    });
    const pCanopyMat = new THREE.MeshStandardMaterial({
      color: 0x2f6b42,
      roughness: 0.9,
      emissive: 0x08180e,
      emissiveIntensity: 0.4,
      side: THREE.DoubleSide,
    });
    const pTrunks = new THREE.InstancedMesh(pTrunkGeo, pTrunkMat, palmItems.length);
    const pCanopies = new THREE.InstancedMesh(pCanopyGeo, pCanopyMat, palmItems.length);
    for (let i = 0; i < palmItems.length; i++) {
      const t = palmItems[i];
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(0, rand() * TAU, 0);
      dummy.scale.set(t.s, t.s, t.s);
      dummy.updateMatrix();
      pTrunks.setMatrixAt(i, dummy.matrix);
      pCanopies.setMatrixAt(i, dummy.matrix);
    }
    pTrunks.instanceMatrix.needsUpdate = true;
    pCanopies.instanceMatrix.needsUpdate = true;
    group.add(pTrunks, pCanopies);
  }

  return { group, count: treeItems.length + palmItems.length, trunks, canopies };
}

/* ============================================================
   灯光 / 车流 / 游船
   ============================================================ */

function makeGlowTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,240,210,0.7)');
  g.addColorStop(0.6, 'rgba(255,210,150,0.15)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCityLights(data, riverRings, islandAt) {
  const rand = mulberry32(5117);
  const pos = [];
  const col = [];
  const c = new THREE.Color();

  const push = (x, y, z, warm = true, strength = 1) => {
    pos.push(x, y, z);
    if (warm) c.setHSL(0.075, 0.8, 0.55 + rand() * 0.15);
    else c.setHSL(0.52, 0.55, 0.58 + rand() * 0.18);
    col.push(c.r * strength, c.g * strength, c.b * strength);
  };

  for (const [kind, width, flat] of data.roads) {
    if (kind === 3) continue;
    const pts = flatPoints(flat);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      acc += len;
      const step = kind === 2 ? 28 : kind === 1 ? 36 : 58;
      if (acc < step) continue;
      acc = 0;
      const nx = -dz / (len || 1);
      const nz = dx / (len || 1);
      for (const s of [-1, 1]) {
        const x = b.x + nx * (width * 0.5 + 3) * s;
        const z = b.z + nz * (width * 0.5 + 3) * s;
        const y = islandAt(x, z) ? 8.8 : 7.5;
        push(x, y, z, rand() > 0.18, 0.8);
      }
    }
  }

  // 江岸暖灯
  for (const ring of riverRings) {
    let acc = 0;
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1];
      const b = ring[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      acc += len;
      if (acc < 26) continue;
      acc = 0;
      push(b.x, 3.2, b.z, true, 0.9);
    }
  }

  // 花城广场轴线灯
  for (let z = -760; z > -2280; z -= 24) {
    push(-9, 3.4, z, true, 0.9);
    push(9, 3.4, z, true, 0.9);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));

  const mat = new THREE.PointsMaterial({
    size: 7.5,
    map: makeGlowTexture(),
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    alphaTest: 0.01,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

function createTraffic(curves) {
  const groups = [];
  for (const item of curves) {
    const bridge = item.bridge;
    const pts = bridge.userData.pts;
    const dists = bridge.userData.dists;
    const total = bridge.userData.total;
    const width = bridge.userData.width;
    const yAt = bridge.userData.yAt;
    const count = item.count;

    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    const data = [];

    for (let i = 0; i < count; i++) {
      const lane = i % 2 === 0 ? -width * 0.22 : width * 0.22;
      data.push({
        offset: (i / count + (i % 2) * 0.003) * total,
        speed: (i % 3 === 0 ? -1 : 1) * (0.012 + Math.random() * 0.008),
        lane,
        lateral: Math.random(),
      });
      c.setHex(i % 4 === 0 ? 0xff5a4a : 0xfff2ce);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.5,
      map: makeGlowTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;

    groups.push({ points, bridge, data, pos, dists, total, yAt, width });
  }
  return groups;
}

function makeWakeTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, s, 0);
  g.addColorStop(0, 'rgba(180,230,255,0)');
  g.addColorStop(0.55, 'rgba(210,242,255,0.22)');
  g.addColorStop(0.86, 'rgba(238,250,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0.62)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(s, 10);
  ctx.lineTo(s, s - 10);
  ctx.lineTo(0, s * 0.5);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBoats() {
  const group = new THREE.Group();
  const boats = [];

  const wakeMat = new THREE.MeshBasicMaterial({
    map: makeWakeTexture(),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  // 统一登记：位置 / 航向 / 尾迹
  const addBoat = (obj, { laneZ, speed, offset, bob, length, trail }) => {
    group.add(obj);
    if (trail) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      geo.translate(-0.5, 0, 0);
      const wake = new THREE.Mesh(geo, wakeMat);
      wake.scale.set(trail, 1, length * 0.52);
      wake.position.set(-length * 0.5 + 1.5, -0.02, 0);
      wake.renderOrder = 2;
      obj.add(wake);
    }
    boats.push({
      obj,
      laneZ,
      speed,
      offset,
      bob,
      heading: speed >= 0 ? 0 : Math.PI,
    });
  };

  const makeHull = (len, wid, color) => {
    const shape = new THREE.Shape();
    shape.moveTo(-len / 2, -wid / 2);
    shape.lineTo(len / 2 - 4, -wid / 2);
    shape.lineTo(len / 2, 0);
    shape.lineTo(len / 2 - 4, wid / 2);
    shape.lineTo(-len / 2, wid / 2);
    shape.lineTo(-len / 2 + 3, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 2.2,
      bevelEnabled: false,
      steps: 1,
    });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 2.2, 0);
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.3,
      roughness: 0.45,
      emissive: 0x0a1a22,
      emissiveIntensity: 0.25,
    });
    return new THREE.Mesh(geo, mat);
  };

  const makeCruise = () => {
    const b = new THREE.Group();
    const hull = makeHull(30, 9, 0xd9e5ea);
    b.add(hull);

    const deck1 = new THREE.Mesh(
      new THREE.BoxGeometry(24, 2.8, 7.2),
      new THREE.MeshStandardMaterial({
        color: 0x9fc7d3,
        metalness: 0.35,
        roughness: 0.35,
        emissive: 0x122c36,
        emissiveIntensity: 0.4,
      })
    );
    deck1.position.y = 4;
    b.add(deck1);

    const windows1 = new THREE.Mesh(new THREE.BoxGeometry(24.5, 1.0, 7.4), warmAccentMat);
    windows1.position.y = 4.6;
    b.add(windows1);

    const deck2 = new THREE.Mesh(
      new THREE.BoxGeometry(18, 2.4, 5.8),
      new THREE.MeshStandardMaterial({
        color: 0xcfe2e8,
        metalness: 0.3,
        roughness: 0.35,
        emissive: 0x17343e,
        emissiveIntensity: 0.45,
      })
    );
    deck2.position.y = 6.8;
    b.add(deck2);

    const windows2 = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.8, 6), accentMat);
    windows2.position.y = 7.3;
    b.add(windows2);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(19, 0.5, 6.2), darkMetalMat);
    roof.position.y = 8.2;
    b.add(roof);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6, 5), whiteSteelMat);
    mast.position.set(0, 11, 0);
    b.add(mast);
    const mastLight = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5), warmAccentMat);
    mastLight.position.set(0, 14, 0);
    b.add(mastLight);

    return b;
  };

  const makeFerry = () => {
    const b = new THREE.Group();
    const hull = makeHull(17, 6, 0xe2edf1);
    b.add(hull);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(12, 2.6, 4.6),
      new THREE.MeshStandardMaterial({
        color: 0xa7c5cf,
        metalness: 0.25,
        roughness: 0.45,
      })
    );
    cabin.position.y = 3.6;
    b.add(cabin);
    const win = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.8, 4.8), warmAccentMat);
    win.position.y = 4.05;
    b.add(win);
    return b;
  };

  const makeBarge = () => {
    const b = new THREE.Group();
    const hull = makeHull(24, 7, 0x6b7378);
    b.add(hull);
    const cargo = new THREE.Mesh(
      new THREE.BoxGeometry(12, 3.2, 5.4),
      new THREE.MeshStandardMaterial({ color: 0x6c4c34, roughness: 0.9 })
    );
    cargo.position.set(-1, 3.8, 0);
    b.add(cargo);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), warmAccentMat);
    light.position.set(9, 4.2, 0);
    b.add(light);
    return b;
  };

  const makeWaterTaxi = () => {
    const b = new THREE.Group();
    const hull = makeHull(11, 4, 0xf0f4f5);
    b.add(hull);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(6.4, 1.8, 3.2),
      new THREE.MeshStandardMaterial({
        color: 0xb7d2da,
        metalness: 0.3,
        roughness: 0.4,
      })
    );
    cabin.position.y = 3;
    b.add(cabin);
    const win = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.6, 3.4), accentMat);
    win.position.y = 3.3;
    b.add(win);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.24, 3), darkMetalMat);
    canopy.position.set(-2.4, 3.9, 0);
    b.add(canopy);
    return b;
  };

  const makeSpeedboat = () => {
    const b = new THREE.Group();
    const hull = makeHull(9, 3.2, 0xe6eef1);
    b.add(hull);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(4, 1.2, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x7d9aa5, metalness: 0.35, roughness: 0.35 })
    );
    cabin.position.set(-0.6, 2.6, 0);
    b.add(cabin);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), warmAccentMat);
    light.position.set(4, 2.9, 0);
    b.add(light);
    return b;
  };

  const cruise = makeCruise();
  addBoat(cruise, { laneZ: -270, speed: 4.4, offset: 0, bob: 0.06, length: 30, trail: 26 });

  const cruise2 = makeCruise();
  addBoat(cruise2, { laneZ: -372, speed: -3.8, offset: 760, bob: 0.05, length: 30, trail: 24 });

  const ferry1 = makeFerry();
  addBoat(ferry1, { laneZ: -312, speed: -5.2, offset: 240, bob: 0.04, length: 17, trail: 16 });

  const ferry2 = makeFerry();
  addBoat(ferry2, { laneZ: -238, speed: 4.9, offset: 780, bob: 0.045, length: 17, trail: 15 });

  const ferry3 = makeFerry();
  addBoat(ferry3, { laneZ: -566, speed: 3.6, offset: 420, bob: 0.045, length: 17, trail: 14 });

  const taxi1 = makeWaterTaxi();
  addBoat(taxi1, { laneZ: -208, speed: 6.6, offset: 1180, bob: 0.035, length: 11, trail: 12 });

  const taxi2 = makeWaterTaxi();
  addBoat(taxi2, { laneZ: -642, speed: -5.8, offset: 340, bob: 0.035, length: 11, trail: 11 });

  const barge = makeBarge();
  addBoat(barge, { laneZ: -690, speed: 2.9, offset: 1600, bob: 0.03, length: 24, trail: 18 });

  const speedboat = makeSpeedboat();
  addBoat(speedboat, { laneZ: -452, speed: -8.2, offset: 980, bob: 0.03, length: 9, trail: 15 });

  return { group, boats, cruise, cruise2 };
}

/* ============================================================
   主入口
   ============================================================ */

export function createEnvironment(scene, data) {
  const islandPts = data.water.islands.map((flat) => flatPoints(flat));
  const islandAt = (x, z) => {
    for (const ring of islandPts) {
      if (pointInRing(x, z, ring)) return true;
    }
    return false;
  };

  /* ---------- 天空 / 星空 ---------- */
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(0x030812) },
      uMid: { value: new THREE.Color(0x081a2b) },
      uBottom: { value: new THREE.Color(0x0e2838) },
      uGlow: { value: new THREE.Color(0x2a6f8c) },
      uSunColor: { value: new THREE.Color(0xcfe9ff) },
      uSunDir: { value: new THREE.Vector3(0.55, 0.34, 0.76).normalize() },
      uSunIntensity: { value: 0.55 },
      uTime: { value: 0 },
    },
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 32), skyMat);
  scene.add(sky);

  const stars = createStars();
  scene.add(stars.points);

  /* ---------- 地面 ---------- */
  const ground = createGround();
  scene.add(ground.group);

  /* ---------- 公园 ---------- */
  const parks = createParks(data, islandAt);
  scene.add(parks.group);

  /* ---------- 珠江 ---------- */
  const water = createWater(data, islandAt);
  scene.add(water.group);

  const riverFront = createRiverFront(data);
  scene.add(riverFront.group);

  /* ---------- 道路 ---------- */
  const roads = createRoadGeometry(data, islandAt);
  for (const mesh of roads.meshes) scene.add(mesh);

  /* ---------- 建筑 ---------- */
  const buildings = createBuildings(data, islandAt);
  scene.add(buildings.mesh);

  const beaconGeo = new THREE.SphereGeometry(1.4, 6, 5);
  const beaconMesh = new THREE.InstancedMesh(
    beaconGeo,
    redBeaconMat,
    Math.max(1, buildings.beacons.length)
  );
  const dummy = new THREE.Object3D();
  buildings.beacons.forEach((b, i) => {
    dummy.position.set(b.x, b.y, b.z);
    dummy.updateMatrix();
    beaconMesh.setMatrixAt(i, dummy.matrix);
  });
  beaconMesh.instanceMatrix.needsUpdate = true;
  beaconMesh.count = buildings.beacons.length;
  beaconMesh.frustumCulled = false;
  scene.add(beaconMesh);

  /* ---------- 地标 ---------- */
  const landmarks = data.landmarks;
  const east = createEastTower(landmarks.eastTower[0], landmarks.eastTower[1]);
  scene.add(east);
  scene.add(createWestTowerDetails(landmarks.westTower[0], landmarks.westTower[1], landmarks.westTower[2]));
  scene.add(createCitic());
  scene.add(createOpera());
  scene.add(createMuseum(landmarks.museum[0], landmarks.museum[1]));
  scene.add(createLibrary(landmarks.library[0], landmarks.library[1]));
  scene.add(createStadium(-48, -552));
  scene.add(createCantonPier());

  /* ---------- 桥梁 ---------- */
  const bridges = createBridges();
  scene.add(bridges.group);

  /* ---------- 树木 ---------- */
  const trees = createTrees(data, islandAt, data.water.rivers.map(flatPoints));
  scene.add(trees.group);

  /* ---------- 城市灯火 / 车流 / 游船 ---------- */
  const cityLights = createCityLights(data, data.water.rivers.map(flatPoints), islandAt);
  scene.add(cityLights);

  const traffic = createTraffic(bridges.curves);
  for (const t of traffic) scene.add(t.points);

  const boats = createBoats();
  scene.add(boats.group);

  /* ---------- 城市生命：车流 / 行人 / 信号灯 ---------- */
  const life = createLife({
    data,
    islandAt,
    riverRings: data.water.rivers.map((flat) => flatPoints(flat)),
    islandRings: data.water.islands.map((flat) => flatPoints(flat)),
  });
  scene.add(life.group);

  /* ---------- 水面倒影光源 ---------- */
  const waterLights = [
    { x: -930, z: -450, width: 80, strength: 0.5, color: 0xffd39a },
    { x: 950, z: -650, width: 70, strength: 0.55, color: 0xbff4ff },
    { x: -468, z: -240, width: 45, strength: 0.35, color: 0xffe1b8 },
    { x: 2743, z: -650, width: 80, strength: 0.4, color: 0xffd39a },
    { x: 70, z: -555, width: 100, strength: 0.35, color: 0x9fe8ff },
    { x: 0, z: -138, width: 80, strength: 0.2, color: 0xffc27a },
    { x: -700, z: -731, width: 100, strength: 0.25, color: 0xffc27a },
    { x: 180, z: -270, width: 40, strength: 0.4, color: 0xffd08a },
    { x: -300, z: -500, width: 50, strength: 0.2, color: 0x9fe8ff },
    { x: 900, z: -450, width: 50, strength: 0.2, color: 0xffc27a },
  ];
  const lightVecs = water.uniforms.uLights.value;
  const lightCols = water.uniforms.uLightColors.value;
  for (let i = 0; i < lightVecs.length; i++) {
    const l = waterLights[i];
    if (!l) continue;
    lightVecs[i].set(l.x, l.z, l.width, l.strength);
    lightCols[i].setHex(l.color);
  }
  const boatLight = lightVecs[7];
  const boatLight2 = lightVecs[9];

  /* ---------- 灯光 ---------- */
  const ambient = new THREE.HemisphereLight(0x6fa8c4, 0x04070b, 0.55);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0x9fdcff, 1.1);
  key.position.set(180, 300, 200);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x6a5cff, 0.9);
  rim.position.set(-220, 140, -240);
  scene.add(rim);

  const warm = new THREE.PointLight(0xffb56b, 2.2, 420, 2);
  warm.position.set(0, 150, 0);
  scene.add(warm);

  const deckLight = new THREE.PointLight(0x7fe9ff, 3.0, 260, 2);
  deckLight.position.set(0, 340, 0);
  scene.add(deckLight);

  scene.fog = new THREE.FogExp2(0x0e2838, 0.00022);

  /* ---------- 动画 ---------- */
  function update(time, dt) {
    skyMat.uniforms.uTime.value = time;
    water.uniforms.uTime.value = time;
    stars.mat.uniforms.uTime.value = time;
    ground.plazaMat.uniforms.uTime.value = time;
    stars.points.rotation.y = time * 0.003;

    // 城市楼顶 / 桥塔的航空障碍灯保持常亮。
    // 之前用共享材质统一闪烁，会让全城几十盏红灯同步频闪，非常干扰。
    // 真正会闪的只有广州塔自身的航空灯（见 tower.js）。

    // 游船
    for (const b of boats.boats) {
      const period = 1800;
      const x = ((time * b.speed + b.offset + 900) % period) - 900;
      b.obj.position.x = x;
      b.obj.position.z = b.laneZ + Math.sin(time * 0.3 + b.offset) * 1.5;
      b.obj.position.y = 1.05 + Math.sin(time * 1.4 + b.offset) * b.bob;
      b.obj.rotation.x = Math.sin(time * 0.9 + b.offset) * 0.004;
      b.obj.rotation.y = b.heading;
      b.obj.rotation.z = Math.sin(time * 1.1 + b.offset) * 0.006;
    }

    // 珠江夜游船的倒影跟随
    if (boatLight) {
      boatLight.x = boats.cruise.position.x;
      boatLight.y = boats.cruise.position.z;
    }
    if (boatLight2) {
      boatLight2.x = boats.cruise2.position.x;
      boatLight2.y = boats.cruise2.position.z;
    }

    // 桥上车流
    for (const t of traffic) {
      const { bridge, data: cars, pos, dists, total, yAt, width } = t;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        let d = (car.offset + time * car.speed * 60) % total;
        if (d < 0) d += total;
        let j = 1;
        while (j < dists.length - 1 && dists[j] < d) j++;
        const a = bridge.userData.pts[j - 1];
        const b = bridge.userData.pts[j];
        const seg = Math.max(0.001, dists[j] - dists[j - 1]);
        const u = (d - dists[j - 1]) / seg;
        const x = lerp(a.x, b.x, u);
        const z = lerp(a.z, b.z, u);
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        pos[i * 3] = x + nx * car.lane;
        pos[i * 3 + 1] = yAt(j - 1) + 1.2;
        pos[i * 3 + 2] = z + nz * car.lane;
      }
      t.points.geometry.attributes.position.needsUpdate = true;
    }

    // 街道车流 / 行人 / 信号灯
    life.update(time, dt);

    // 轻微的水面灯光呼吸
    if (lightVecs[0]) {
      const s = 0.72 + Math.sin(time * 0.9) * 0.08;
      lightVecs[0].w = s;
    }
  }

  return {
    update,
    skyMat,
    water: { mat: water.mat, uniforms: water.uniforms, group: water.group },
    cityMats: [buildings.mat],
    cityLights,
    bridgeLightMat: accentMat,
    stars,
    lights: { ambient, key, rim, warm, deckLight },
    ground,
    parks,
    trees,
    boats,
    traffic,
    life,
    beaconMesh,
    landmarks,
  };
}
