import * as THREE from 'three';
import { flatPoints, centroidOf } from '../core/utils.js';

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

export function createBuildings(data, islandAt) {
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
