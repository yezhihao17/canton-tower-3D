import * as THREE from 'three';

/* 把若干净几何拼成一个，减少 instance / draw call 数量 */
export function mergeGeometries(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;

  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let offset = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, offset * 3);
    nor.set(g.attributes.normal.array, offset * 3);
    offset += g.attributes.position.count;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return geo;
}
