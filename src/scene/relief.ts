import * as THREE from 'three/webgpu';
import { PALETTE } from './parts';

/** The relief is cut into this many stacked sheets of cardboard. */
const LAYERS = 14;
/** World height of the full stack. */
const RISE = 1.75;
const BASE = 0.1;
/** Share of a sheet's height spent on its cut edge; the rest is flat. */
const EDGE = 0.16;

const LOW = new THREE.Color('#9a7140');
const HIGH = new THREE.Color('#f4e8cf');
const WALL = new THREE.Color(PALETTE.kraftDark);

/** Terrace position of a landscape height in [0, 1]: sheet index plus progress up its edge. */
function terrace(height: number): { sheet: number; climb: number } {
  const level = Math.min(Math.max(height, 0), 1) * LAYERS;
  const sheet = Math.min(Math.floor(level), LAYERS - 1);
  return { sheet, climb: THREE.MathUtils.smoothstep(level - sheet, 1 - EDGE, 1) };
}

/** World height of the cardboard surface for a landscape height in [0, 1]. */
export function surfaceY(height: number): number {
  const { sheet, climb } = terrace(height);
  return BASE + ((sheet + climb) / LAYERS) * RISE;
}

/**
 * A contour model of a height function: stacked sheets, darker where the
 * ground is lower, standing on the same kraft slab as the town.
 */
export function buildRelief(height: (x: number, y: number) => number, side: number, cells = 160): THREE.Group {
  // One extra ring of vertices all round, folded down to the slab, makes the side walls.
  const n = cells + 3;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const color = new THREE.Color();

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = Math.min(Math.max((i - 1) / cells, 0), 1);
      const v = Math.min(Math.max((j - 1) / cells, 0), 1);
      const wall = i === 0 || j === 0 || i === n - 1 || j === n - 1;
      const k = (j * n + i) * 3;
      positions[k] = (u - 0.5) * side;
      positions[k + 2] = (v - 0.5) * side;
      if (wall) {
        color.copy(WALL);
      } else {
        const h = height(u, v);
        const { sheet, climb } = terrace(h);
        positions[k + 1] = surfaceY(h);
        // Alternate sheets differ slightly, and cut edges are darker, as on real cardboard.
        const onEdge = climb > 0.02 && climb < 0.98;
        const shade = (onEdge ? 0.74 : 1) * (sheet % 2 === 0 ? 1 : 0.955);
        color.copy(LOW).lerp(HIGH, (sheet + climb) / LAYERS).multiplyScalar(shade);
      }
      colors[k] = color.r;
      colors[k + 1] = color.g;
      colors[k + 2] = color.b;
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const terrain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrain.castShadow = true;
  terrain.receiveShadow = true;

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(side + 0.8, 0.3, side + 0.8),
    new THREE.MeshStandardMaterial({ color: PALETTE.kraft, roughness: 0.95 }),
  );
  slab.position.y = -0.152;
  slab.castShadow = true;
  slab.receiveShadow = true;

  const group = new THREE.Group();
  group.add(slab, terrain);
  return group;
}

const SPHERE = new THREE.SphereGeometry(1, 28, 18);

/** A glossy marble: the current solution rolling on the relief. */
export function buildMarble(radius: number, color: string, opacity = 1): THREE.Mesh {
  const marble = new THREE.Mesh(
    SPHERE,
    new THREE.MeshStandardMaterial({ color, roughness: 0.25, transparent: opacity < 1, opacity }),
  );
  marble.scale.setScalar(radius);
  marble.castShadow = opacity === 1;
  marble.visible = false;
  return marble;
}
