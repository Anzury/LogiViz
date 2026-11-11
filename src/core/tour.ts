import { DEPOT, type Instance } from './instance';
import type { Rng } from './rng';

/** Length of a visiting order; `closed` adds the leg back to the first node. */
export function tourCost(inst: Instance, tour: number[], closed = true): number {
  let cost = 0;
  for (let i = 0; i + 1 < tour.length; i++) cost += inst.dist[tour[i]][tour[i + 1]];
  if (closed && tour.length > 1) cost += inst.dist[tour[tour.length - 1]][tour[0]];
  return cost;
}

/** A complete tour starts at the depot and visits every node exactly once. */
export function isCompleteTour(inst: Instance, tour: number[]): boolean {
  if (tour.length !== inst.nodes.length || tour[0] !== DEPOT) return false;
  return new Set(tour).size === tour.length && tour.every((v) => v >= 0 && v < inst.nodes.length);
}

/** Uniformly random tour starting at the depot (Fisher-Yates on the customers). */
export function randomTour(inst: Instance, rng: Rng): number[] {
  const tour = inst.nodes.map((_, i) => i);
  for (let i = tour.length - 1; i > 1; i--) {
    const j = 1 + Math.floor(rng() * i);
    [tour[i], tour[j]] = [tour[j], tour[i]];
  }
  return tour;
}
