import { anneal } from '../core/annealing';
import { heldKarp } from '../core/heldKarp';
import { generateInstance, type Instance } from '../core/instance';
import { nearestNeighbour } from '../core/nearestNeighbour';
import { record, result, type Edge, type Trace } from '../core/trace';
import { improvingMoves, twoOpt, type TwoOptMove } from '../core/twoOpt';

export const HOUSES = 12;

export interface Solution {
  tour: number[];
  cost: number;
}

/**
 * A town and everything the single-truck chapters say about it, computed once
 * when a page loads so that scrolling never waits on an algorithm.
 */
export interface City {
  inst: Instance;
  nn: Trace;
  nnResult: Solution;
  refine: Trace;
  refined: Solution;
  /** Simulated annealing started from the 2-opt local optimum, first draw. */
  anneal: Trace;
  annealed: Solution;
  optimum: Solution;
  /** The single 2-opt move used to introduce the idea, ideally a visible crossing. */
  showcase: TwoOptMove;
}

/** Null when the town cannot illustrate 2-opt: nearest neighbour left nothing to improve. */
export function buildCity(seed: number): City | null {
  const inst = generateInstance(seed, HOUSES);
  const nn = record(nearestNeighbour(inst));
  const nnResult = result(nn);
  const moves = improvingMoves(inst, nnResult.tour).sort((a, b) => b.gain - a.gain);
  const showcase = moves.find((move) => move.crossing) ?? moves[0];
  if (!showcase) return null;
  const refine = record(twoOpt(inst, nnResult.tour));
  const refined = result(refine);
  const annealing = record(anneal(inst, refined.tour, { seed }));
  return { inst, nn, nnResult, refine, refined, anneal: annealing, annealed: result(annealing), optimum: heldKarp(inst), showcase };
}

/** The first usable town from `seed` on: what "Nouvelle ville" draws. */
export function nextCity(seed: number): City {
  for (;; seed++) {
    const city = buildCity(seed);
    if (city) return city;
  }
}

/**
 * Whether a town tells the whole single-truck story: a real crossing to undo,
 * a 2-opt local optimum clearly short of the true optimum, and an annealing
 * run that closes that gap.
 */
export function tellsFullStory(city: City): boolean {
  const stuck = city.refined.cost / city.optimum.cost - 1 >= 0.03;
  const escaped = city.annealed.cost / city.optimum.cost - 1 < 0.0005;
  return city.showcase.crossing && stuck && escaped;
}

export function longestEdge(inst: Instance, tour: number[]): Edge {
  let best: Edge = [tour[0], tour[1]];
  tour.forEach((from, i) => {
    const to = tour[(i + 1) % tour.length];
    if (inst.dist[from][to] > inst.dist[best[0]][best[1]]) best = [from, to];
  });
  return best;
}
