import { mulberry32 } from './rng';

export interface Point {
  x: number;
  y: number;
}

/**
 * A routing instance: one depot and a set of customers on a square board.
 * Distances are Euclidean, in board units (10 units = 1 km).
 */
export interface Instance {
  seed: number;
  /** Side of the board, in board units. */
  size: number;
  /** nodes[0] is the depot, the rest are customers. */
  nodes: Point[];
  dist: number[][];
}

export const DEPOT = 0;
export const UNITS_PER_KM = 10;

export function generateInstance(seed: number, customers = 12, size = 100): Instance {
  const rng = mulberry32(seed);
  const margin = size * 0.1;
  const span = size - 2 * margin;
  const nodes: Point[] = [
    // Depot somewhere in the middle third, so no tour is trivially lopsided.
    { x: size / 2 + (rng() - 0.5) * size * 0.3, y: size / 2 + (rng() - 0.5) * size * 0.3 },
  ];

  // Rejection sampling with a minimum gap, relaxed if the board gets crowded.
  let gap = size * 0.17;
  let misses = 0;
  while (nodes.length < customers + 1) {
    const p = { x: margin + rng() * span, y: margin + rng() * span };
    if (nodes.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= gap)) {
      nodes.push(p);
      misses = 0;
    } else if (++misses > 200) {
      gap *= 0.9;
      misses = 0;
    }
  }

  const dist = nodes.map((a) => nodes.map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
  return { seed, size, nodes, dist };
}
