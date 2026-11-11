import type { Instance, Point } from './instance';
import { mulberry32 } from './rng';

/**
 * A street network laid over a town: a grid of streets one kilometre apart, a
 * river that only two bridges cross, a few closed streets, and a short access
 * lane from every house to the nearest crossroads. Distances by road replace
 * the straight lines of the earlier chapters.
 */
export interface RoadMap {
  seed: number;
  /** Crossroads first, then one node per node of the instance (depot and houses), in the same order. */
  nodes: Point[];
  /** Road node of each node of the instance. */
  place: number[];
  edges: RoadEdge[];
  /** For each road node, the streets leaving it. */
  links: { to: number; length: number }[][];
  /** The river's centre line, across the whole board. */
  river: Point[];
}

export interface RoadEdge {
  a: number;
  b: number;
  length: number;
  kind: 'street' | 'bridge' | 'lane';
}

/** Streets run along these lines of the board, on both axes. */
const LINES = [10, 20, 30, 40, 50, 60, 70, 80, 90];
const SPAN = LINES.length;
const CLOSURES = 16;

function crosses(p: Point, q: Point, r: Point, s: Point): boolean {
  const side = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  return side(r, s, p) * side(r, s, q) < 0 && side(p, q, r) * side(p, q, s) < 0;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0), 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** How far a point is from a line of segments. */
export function distanceToLine(p: Point, line: Point[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, distanceToSegment(p, line[i], line[i + 1]));
  return best;
}

const crossesLine = (p: Point, q: Point, line: Point[]) => line.some((r, i) => i + 1 < line.length && crosses(p, q, r, line[i + 1]));

/**
 * A river from the top of the board to the bottom. It crosses each east-west
 * street in the middle of a block, drifting by at most one block from one
 * street to the next, and keeps as far from the houses as the town allows.
 */
function drawRiver(inst: Instance, rng: () => number): Point[] {
  for (const clearance of [9, 7, 5.5, 4, 0]) {
    for (let attempt = 0; attempt < 200; attempt++) {
      let block = 1 + Math.floor(rng() * 6);
      const river: Point[] = [];
      for (const y of LINES) {
        // Straight across the street, so that it is crossed cleanly; any drift happens between two streets.
        river.push({ x: 15 + 10 * block, y: y - 3 }, { x: 15 + 10 * block, y: y + 3 });
        block = Math.min(Math.max(block + Math.floor(rng() * 3) - 1, 1), 6);
      }
      river.unshift({ x: river[0].x, y: 0 });
      river.push({ x: river[river.length - 1].x, y: inst.size });
      if (inst.nodes.every((node) => distanceToLine(node, river) >= clearance)) return river;
    }
  }
  throw new Error('unreachable: a river with no clearance always fits');
}

function connected(count: number, edges: RoadEdge[]): boolean {
  const links: number[][] = Array.from({ length: count }, () => []);
  for (const { a, b } of edges) {
    links[a].push(b);
    links[b].push(a);
  }
  const seen = new Set([0]);
  const queue = [0];
  for (let node = queue.pop(); node !== undefined; node = queue.pop()) {
    for (const next of links[node]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === count;
}

export function generateRoads(inst: Instance, seed: number): RoadMap {
  const rng = mulberry32(Math.imul(seed, 0x45d9f3b) >>> 0);
  const river = drawRiver(inst, rng);

  const nodes: Point[] = [];
  for (const y of LINES) for (const x of LINES) nodes.push({ x, y });
  const crossroads = nodes.length;

  // Every block of the grid is a street, unless the river is in the way.
  let edges: RoadEdge[] = [];
  const wet: RoadEdge[] = [];
  for (let j = 0; j < SPAN; j++) {
    for (let i = 0; i < SPAN; i++) {
      const here = j * SPAN + i;
      for (const there of [i + 1 < SPAN ? here + 1 : -1, j + 1 < SPAN ? here + SPAN : -1]) {
        if (there < 0) continue;
        const edge: RoadEdge = { a: here, b: there, length: 10, kind: 'street' };
        (crossesLine(nodes[here], nodes[there], river) ? wet : edges).push(edge);
      }
    }
  }

  // Two bridges, on east-west streets a good way apart.
  const eastWest = wet.filter((edge) => nodes[edge.a].y === nodes[edge.b].y);
  const nearest = (y: number) => eastWest.reduce((best, edge) => (Math.abs(nodes[edge.a].y - y) < Math.abs(nodes[best.a].y - y) ? edge : best));
  for (const bridge of new Set([nearest(30 + 10 * Math.floor(rng() * 2)), nearest(70 - 10 * Math.floor(rng() * 2))])) {
    edges.push({ ...bridge, kind: 'bridge' });
  }

  // A lane from each house to the closest crossroads on its own bank.
  const place: number[] = [];
  inst.nodes.forEach((house) => {
    let best = -1;
    for (let k = 0; k < crossroads; k++) {
      if (crossesLine(house, nodes[k], river)) continue;
      if (best < 0 || Math.hypot(house.x - nodes[k].x, house.y - nodes[k].y) < Math.hypot(house.x - nodes[best].x, house.y - nodes[best].y)) best = k;
    }
    place.push(nodes.length);
    edges.push({ a: nodes.length, b: best, length: Math.hypot(house.x - nodes[best].x, house.y - nodes[best].y), kind: 'lane' });
    nodes.push({ x: house.x, y: house.y });
  });

  // Close a few streets at random, never cutting the town in two.
  const streets = edges.filter((edge) => edge.kind === 'street');
  for (let i = streets.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [streets[i], streets[j]] = [streets[j], streets[i]];
  }
  let closed = 0;
  for (const street of streets) {
    if (closed === CLOSURES) break;
    const without = edges.filter((edge) => edge !== street);
    if (!connected(nodes.length, without)) continue;
    edges = without;
    closed++;
  }

  const links: RoadMap['links'] = nodes.map(() => []);
  for (const { a, b, length } of edges) {
    links[a].push({ to: b, length });
    links[b].push({ to: a, length });
  }
  return { seed, nodes, place, edges, links, river };
}

/** Pseudo-code shown next to the scene; event `line` values index into it. */
export const DIJKSTRA_PSEUDOCODE = [
  'distance du départ ← 0, de tous les autres carrefours ← infini',
  'répéter :',
  '    prendre le carrefour non traité le plus proche du départ',
  '    si c’est l’arrivée : le plus court chemin est trouvé',
  '    pour chaque rue qui en part :',
  '        si passer par ici raccourcit le trajet jusqu’au bout de la rue : le noter',
];

/** Shortest distances by road from one road node to all others (Dijkstra), and how each is reached. */
export function shortestPaths(map: RoadMap, source: number): { dist: number[]; via: number[] } {
  const dist = map.nodes.map(() => Infinity);
  const via = map.nodes.map(() => -1);
  const done = map.nodes.map(() => false);
  dist[source] = 0;
  for (;;) {
    let node = -1;
    for (let k = 0; k < dist.length; k++) {
      if (!done[k] && dist[k] < Infinity && (node < 0 || dist[k] < dist[node])) node = k;
    }
    if (node < 0) return { dist, via };
    done[node] = true;
    for (const { to, length } of map.links[node]) {
      if (dist[node] + length < dist[to]) {
        dist[to] = dist[node] + length;
        via[to] = node;
      }
    }
  }
}

interface SearchState {
  /** Streets by which each crossroads dealt with so far was reached. */
  reached: [number, number][];
  /** Crossroads seen but not dealt with yet, each with its best distance so far. */
  frontier: number[];
  line: number;
}

export type RoadEvent =
  | (SearchState & { kind: 'dj-start'; source: number; target: number })
  | (SearchState & { kind: 'dj-settle'; node: number; dist: number })
  | (SearchState & { kind: 'dj-done'; path: number[]; dist: number });

/** Dijkstra's search from one road node to another, one event per crossroads dealt with. */
export function* searchRoad(map: RoadMap, source: number, target: number): Generator<RoadEvent> {
  const dist = map.nodes.map(() => Infinity);
  const via = map.nodes.map(() => -1);
  const done = map.nodes.map(() => false);
  const reached: [number, number][] = [];
  const state = (line: number): SearchState => ({
    reached: reached.slice(),
    frontier: dist.flatMap((value, k) => (!done[k] && value < Infinity ? [k] : [])),
    line,
  });
  dist[source] = 0;
  yield { kind: 'dj-start', source, target, ...state(0) };

  for (;;) {
    let node = -1;
    for (let k = 0; k < dist.length; k++) {
      if (!done[k] && dist[k] < Infinity && (node < 0 || dist[k] < dist[node])) node = k;
    }
    if (node < 0) return;
    done[node] = true;
    if (via[node] >= 0) reached.push([via[node], node]);
    if (node === target) break;
    for (const { to, length } of map.links[node]) {
      if (dist[node] + length < dist[to]) {
        dist[to] = dist[node] + length;
        via[to] = node;
      }
    }
    yield { kind: 'dj-settle', node, dist: dist[node], ...state(5) };
  }

  const path = [target];
  while (via[path[0]] >= 0) path.unshift(via[path[0]]);
  yield { kind: 'dj-done', path, dist: dist[target], ...state(3) };
}

/** Road distances between the nodes of the instance, with the streets taken. */
export interface RoadTable {
  /** The same town, measured by road: a drop-in instance for every algorithm of the earlier chapters. */
  inst: Instance;
  /** Road nodes of the shortest way from one instance node to another, both ends included. */
  path(from: number, to: number): number[];
}

export function roadTable(inst: Instance, map: RoadMap): RoadTable {
  const from = map.place.map((node) => shortestPaths(map, node));
  const dist = from.map(({ dist: d }) => map.place.map((node) => d[node]));
  return {
    inst: { ...inst, dist },
    path(a, b) {
      const path = [map.place[b]];
      while (from[a].via[path[0]] >= 0) path.unshift(from[a].via[path[0]]);
      return path;
    },
  };
}
