import * as THREE from 'three/webgpu';
import type { Point } from '../core/instance';
import type { RoadMap } from '../core/roads';
import { PALETTE } from './parts';

const STREET = new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 1, side: THREE.DoubleSide });
const WATER = new THREE.MeshStandardMaterial({ color: '#8fb6cb', roughness: 0.35, side: THREE.DoubleSide });
const DECK = new THREE.MeshStandardMaterial({ color: PALETTE.kraft, roughness: 0.95 });
const RAIL = new THREE.MeshStandardMaterial({ color: PALETTE.kraftDark, roughness: 0.95 });
const BOX = new THREE.BoxGeometry(1, 1, 1);

/**
 * A flat ribbon following a line of points, `width` wide. Corners are joined by
 * averaging the directions on either side, which is enough for gentle bends.
 */
function ribbon(points: THREE.Vector3[], width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  points.forEach((point, i) => {
    const before = points[Math.max(i - 1, 0)];
    const after = points[Math.min(i + 1, points.length - 1)];
    const along = after.clone().sub(before).setY(0).normalize();
    const across = new THREE.Vector3(-along.z, 0, along.x).multiplyScalar(width / 2);
    positions.push(point.x + across.x, point.y, point.z + across.z, point.x - across.x, point.y, point.z - across.z);
    if (i > 0) {
      const k = i * 2;
      indices.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Many separate straight strips in one geometry; each is lengthened by half its width so corners close up. */
function strips(segments: { from: THREE.Vector3; to: THREE.Vector3; width: number }[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const { from, to, width } of segments) {
    const along = to.clone().sub(from).setY(0).normalize();
    const across = new THREE.Vector3(-along.z, 0, along.x).multiplyScalar(width / 2);
    const a = from.clone().addScaledVector(along, -width / 2);
    const b = to.clone().addScaledVector(along, width / 2);
    const k = positions.length / 3;
    for (const corner of [a.clone().add(across), a.clone().sub(across), b.clone().add(across), b.clone().sub(across)]) {
      positions.push(corner.x, corner.y, corner.z);
    }
    indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Streets, lanes, a river and its bridges, laid flat on the board like strips of
 * paper. `place` turns a point of the town into a point of the model at a height.
 */
export function buildRoads(map: RoadMap, place: (point: Point, y: number) => THREE.Vector3): THREE.Group {
  const group = new THREE.Group();

  const river = new THREE.Mesh(ribbon(map.river.map((point) => place(point, 0.008)), 0.62), WATER);
  river.receiveShadow = true;

  const paved = map.edges.filter((edge) => edge.kind !== 'bridge');
  const streets = new THREE.Mesh(
    strips(
      paved.map((edge) => ({
        from: place(map.nodes[edge.a], 0.012),
        to: place(map.nodes[edge.b], 0.012),
        width: edge.kind === 'lane' ? 0.09 : 0.17,
      })),
    ),
    STREET,
  );
  streets.receiveShadow = true;
  group.add(river, streets);

  for (const edge of map.edges.filter((bridge) => bridge.kind === 'bridge')) {
    const from = place(map.nodes[edge.a], 0);
    const to = place(map.nodes[edge.b], 0);
    const bridge = new THREE.Group();
    bridge.position.copy(from).lerp(to, 0.5);
    bridge.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
    const length = from.distanceTo(to) + 0.17;
    const deck = new THREE.Mesh(BOX, DECK);
    deck.scale.set(length, 0.05, 0.28);
    deck.position.y = 0.035;
    deck.castShadow = true;
    deck.receiveShadow = true;
    bridge.add(deck);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(BOX, RAIL);
      rail.scale.set(length * 0.7, 0.07, 0.025);
      rail.position.set(0, 0.09, side * 0.14);
      rail.castShadow = true;
      bridge.add(rail);
    }
    group.add(bridge);
  }
  return group;
}
