import * as THREE from 'three/webgpu';
import type { Rng } from '../core/rng';

/** Paper-model palette shared by the scene and (via CSS variables) the page. */
export const PALETTE = {
  table: '#e9e1d3',
  kraft: '#c9a26b',
  kraftDark: '#9c7646',
  mat: '#b4c2a2',
  matLine: '#d6dfc9',
  paper: '#f7f2e8',
  ink: '#2b2622',
  slate: '#4a433c',
  roofs: ['#d98a6a', '#7d93a8', '#e0b65a', '#c97b84'],
  leaves: ['#7f9a6c', '#94ab7d'],
  metal: '#8d8a86',
  pinIdle: '#f7f2e8',
  truck: '#e0b65a',
};

const matte = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0 });

const MATERIALS = {
  paper: matte(PALETTE.paper),
  kraft: matte(PALETTE.kraft),
  kraftDark: matte(PALETTE.kraftDark),
  ink: matte(PALETTE.ink),
  slate: matte(PALETTE.slate),
  roofs: PALETTE.roofs.map(matte),
  leaves: PALETTE.leaves.map(matte),
  parcel: matte('#b98650'),
  metal: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.45, metalness: 0.6 }),
};

/** Gable roof: unit triangular prism, base on y = 0, ridge along z. */
function prismGeometry(): THREE.BufferGeometry {
  const A = [-0.5, 0, 0.5], B = [0.5, 0, 0.5], C = [0, 1, 0.5];
  const D = [-0.5, 0, -0.5], E = [0.5, 0, -0.5], F = [0, 1, -0.5];
  const triangles = [A, B, C, E, D, F, B, E, F, B, F, C, A, C, F, A, F, D];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(triangles.flat(), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function flat(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const result = geometry.toNonIndexed();
  result.computeVertexNormals();
  return result;
}

const GEOMETRY = {
  box: new THREE.BoxGeometry(1, 1, 1),
  roof: prismGeometry(),
  cone: flat(new THREE.ConeGeometry(1, 1, 6)),
  blob: new THREE.IcosahedronGeometry(1, 0),
  cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
  sphere: new THREE.SphereGeometry(1, 20, 14),
};

/** Unit cylinder along +y, used for every stretch of thread. */
export const THREAD_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);

function part(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  scale: [number, number, number],
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(...scale);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A small paper house standing on y = 0, its door facing +z. */
export function buildHouse(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  const w = 0.44 + rng() * 0.12;
  const d = 0.5 + rng() * 0.16;
  const h = 0.28 + rng() * 0.12;
  const roofHeight = 0.2 + rng() * 0.1;
  const roof = MATERIALS.roofs[Math.floor(rng() * MATERIALS.roofs.length)];
  group.add(
    part(GEOMETRY.box, MATERIALS.paper, [w, h, d], [0, h / 2, 0]),
    part(GEOMETRY.roof, roof, [w * 1.14, roofHeight, d * 1.1], [0, h, 0]),
    part(GEOMETRY.box, MATERIALS.kraftDark, [0.1, 0.17, 0.02], [w * 0.12, 0.085, d / 2 + 0.005]),
  );
  return group;
}

/** The depot: a kraft warehouse with two loading doors on its +z side. */
export function buildDepot(): THREE.Group {
  const group = new THREE.Group();
  group.add(
    part(GEOMETRY.box, MATERIALS.kraft, [1.15, 0.48, 0.8], [0, 0.24, 0]),
    part(GEOMETRY.box, MATERIALS.slate, [1.23, 0.06, 0.88], [0, 0.51, 0]),
    part(GEOMETRY.box, MATERIALS.slate, [0.3, 0.32, 0.02], [-0.24, 0.16, 0.405]),
    part(GEOMETRY.box, MATERIALS.slate, [0.3, 0.32, 0.02], [0.24, 0.16, 0.405]),
    part(GEOMETRY.box, MATERIALS.paper, [0.5, 0.16, 0.05], [0, 0.62, 0.3]),
  );
  return group;
}

export function buildTree(rng: Rng): THREE.Group {
  const group = new THREE.Group();
  const size = 0.75 + rng() * 0.6;
  const leaves = MATERIALS.leaves[Math.floor(rng() * MATERIALS.leaves.length)];
  group.add(part(GEOMETRY.cylinder, MATERIALS.kraftDark, [0.022, 0.14, 0.022], [0, 0.07, 0]));
  if (rng() < 0.55) {
    group.add(part(GEOMETRY.cone, leaves, [0.15, 0.4, 0.15], [0, 0.32, 0]));
  } else {
    const crown = part(GEOMETRY.blob, leaves, [0.17, 0.17, 0.17], [0, 0.28, 0]);
    crown.rotation.set(rng() * 3, rng() * 3, 0);
    group.add(crown);
  }
  group.scale.setScalar(size);
  return group;
}

/** A map pin. The head has its own material so its colour can follow the tour. */
export function buildPin(height: number, headRadius: number, color: string): { group: THREE.Group; head: THREE.Mesh } {
  const group = new THREE.Group();
  const needle = part(GEOMETRY.cylinder, MATERIALS.metal, [0.013, height, 0.013], [0, height / 2, 0]);
  const head = part(GEOMETRY.sphere, new THREE.MeshStandardMaterial({ color, roughness: 0.35 }), [1, 1, 1], [0, height, 0]);
  head.scale.setScalar(headRadius);
  group.add(needle, head);
  return { group, head };
}

/**
 * Toy delivery truck, about half a unit long, driving towards +x. The cab has
 * its own material so that each truck can wear the colour of its route.
 */
export function buildTruck(): { group: THREE.Group; cab: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const cab = matte(PALETTE.truck);
  group.add(
    part(GEOMETRY.box, MATERIALS.ink, [0.46, 0.03, 0.18], [0, 0.075, 0]),
    part(GEOMETRY.box, MATERIALS.paper, [0.29, 0.2, 0.21], [-0.075, 0.19, 0]),
    part(GEOMETRY.box, cab, [0.13, 0.15, 0.2], [0.16, 0.165, 0]),
  );
  for (const x of [-0.14, 0.15]) {
    for (const z of [-0.1, 0.1]) {
      const wheel = part(GEOMETRY.cylinder, MATERIALS.ink, [0.055, 0.04, 0.055], [x, 0.055, z]);
      wheel.rotation.x = Math.PI / 2;
      group.add(wheel);
    }
  }
  return { group, cab };
}

/** A small pile of parcels, two per layer: what one house has ordered. */
export function buildParcels(count: number, rng: Rng): THREE.Group {
  const group = new THREE.Group();
  for (let k = 0; k < count; k++) {
    const box = part(GEOMETRY.box, MATERIALS.parcel, [0.19, 0.16, 0.19], [(k % 2) * 0.22 - 0.11, 0.08 + Math.floor(k / 2) * 0.165, 0]);
    box.rotation.y = (rng() - 0.5) * 0.5;
    group.add(box);
  }
  return group;
}

/** Invisible, generous click target around a pin and its building. */
export function buildPickTarget(): THREE.Mesh {
  const mesh = new THREE.Mesh(GEOMETRY.cylinder);
  mesh.scale.set(0.55, 1.1, 0.55);
  mesh.position.y = 0.55;
  mesh.visible = false;
  return mesh;
}

/** The board: a kraft slab topped with a cutting mat whose squares are 1 km wide. */
export function buildBoard(side: number): THREE.Group {
  const group = new THREE.Group();
  const slab = part(GEOMETRY.box, MATERIALS.kraft, [side + 0.8, 0.3, side + 0.8], [0, -0.152, 0]);
  slab.castShadow = true;

  const cells = Math.round(side);
  const px = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cells * px;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = PALETTE.mat;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = PALETTE.matLine;
  for (let i = 0; i <= cells * 2; i++) {
    const major = i % 2 === 0;
    ctx.globalAlpha = major ? 0.9 : 0.35;
    ctx.lineWidth = major ? 3 : 2;
    const at = Math.min(Math.max((i * px) / 2, 1.5), canvas.width - 1.5);
    ctx.beginPath();
    ctx.moveTo(at, 0);
    ctx.lineTo(at, canvas.height);
    ctx.moveTo(0, at);
    ctx.lineTo(canvas.width, at);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  const mat = new THREE.Mesh(
    new THREE.PlaneGeometry(side, side),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
  );
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = 0.001;
  mat.receiveShadow = true;
  group.add(slab, mat);
  return group;
}

export function buildTable(): THREE.Mesh {
  const table = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), matte(PALETTE.table));
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.3;
  table.receiveShadow = true;
  return table;
}
