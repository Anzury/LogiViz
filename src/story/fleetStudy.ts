import { bestFleet, cutTour, relocate, savings, withDemands, type FleetEvent, type FleetProblem } from '../core/fleet';
import type { City } from './city';

const last = <T>(items: T[]) => items[items.length - 1];

/** Everything chapter 4 computes for one town and one set of orders. */
export interface FleetStudy {
  problem: FleetProblem;
  cut: FleetEvent[];
  saved: FleetEvent[];
  moved: FleetEvent[];
  optimum: { routes: number[][]; cost: number };
}

export function fleetStudy(city: City, seed: number): FleetStudy {
  const problem = withDemands(city.inst, seed);
  const cut = Array.from(cutTour(problem, city.optimum.tour));
  const saved = Array.from(savings(problem));
  const moved = Array.from(relocate(problem, last(saved).routes));
  return { problem, cut, saved, moved, optimum: bestFleet(problem) };
}

/**
 * Orders that tell chapter 4's whole story on a town: three trucks or more,
 * savings clearly ahead of cutting, and something left for relocation to fix.
 */
export function findDemandSeed(city: City): number {
  const first = city.inst.seed;
  for (let seed = first; seed < first + 200; seed++) {
    const study = fleetStudy(city, seed);
    const total = study.problem.demand.reduce((sum, n) => sum + n, 0);
    const done = last(study.moved);
    const relocated = done.kind === 'move-done' && done.moves > 0;
    if (total > 2 * study.problem.capacity && last(study.cut).cost > last(study.saved).cost + 5 && relocated) return seed;
  }
  return first;
}
