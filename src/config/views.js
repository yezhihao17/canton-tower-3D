import * as THREE from 'three';

/* 镜头预设：不同高度与角度的观察机位 */

export const VIEWS = {
  hero: {
    pos: new THREE.Vector3(600, 470, 1180),
    target: new THREE.Vector3(0, 260, -180),
    fov: 40,
  },
  waist: {
    pos: new THREE.Vector3(185, 285, -265),
    target: new THREE.Vector3(0, 285, 0),
    fov: 44,
  },
  deck: {
    pos: new THREE.Vector3(150, 380, -240),
    target: new THREE.Vector3(0, 370, 0),
    fov: 42,
  },
  top: {
    pos: new THREE.Vector3(185, 540, -285),
    target: new THREE.Vector3(0, 505, 0),
    fov: 44,
  },
  orbit: {
    pos: new THREE.Vector3(1180, 760, 820),
    target: new THREE.Vector3(30, 260, -720),
    fov: 40,
    mobile: {
      pos: new THREE.Vector3(1700, 950, 1700),
      target: new THREE.Vector3(0, 250, -700),
      fov: 50,
    },
  },
  city: {
    pos: new THREE.Vector3(1300, 1080, 1500),
    target: new THREE.Vector3(80, 120, -1900),
    fov: 44,
  },
};

