import * as THREE from 'three';
import { TAU, flatPoints, pointInRing, centroidOf } from '../core/utils.js';
import { warmAccentMat, concreteMat, paleStoneMat } from './materials.js';
import { appendRibbon } from './roads.js';

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

export function createGround() {
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

export function createParks(data, islandAt) {
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

export function createWater(data, islandAt) {
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

export function createRiverFront(data) {
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
