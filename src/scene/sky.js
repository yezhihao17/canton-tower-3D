import * as THREE from 'three';
import { mulberry32, TAU } from '../core/utils.js';

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

export function createSky() {
  const mat = new THREE.ShaderMaterial({
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

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 32), mat);
  return { mesh, mat };
}

export function createStars(count = 2200) {
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
