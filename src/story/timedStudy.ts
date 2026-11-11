import { largeNeighbourhood, type LnsEvent } from '../core/lns';
import {
  bestTimedFleet,
  followClock,
  insertion,
  relocateOnTime,
  withWindows,
  type TimedEvent,
  type TimedProblem,
} from '../core/timeWindows';
import type { City } from './city';

const last = <T>(items: T[]) => items[items.length - 1];

/** Everything chapters 5 and 6 compute for one town and one set of time windows. */
export interface TimedStudy {
  problem: TimedProblem;
  /** The best single tour, followed with the clock. */
  clock: TimedEvent[];
  inserted: TimedEvent[];
  /** Relocation search started from the insertion result. */
  moved: TimedEvent[];
  optimum: { routes: number[][]; cost: number };
}

export function timedStudy(city: City, seed: number): TimedStudy {
  const problem = withWindows(city.inst, seed);
  const inserted = Array.from(insertion(problem));
  return {
    problem,
    clock: Array.from(followClock(problem, city.optimum.tour)),
    inserted,
    moved: Array.from(relocateOnTime(problem, last(inserted).routes)),
    optimum: bestTimedFleet(problem),
  };
}

/**
 * Time windows that tell chapter 5's whole story on a town: the shortest tour
 * is clearly late, insertion is far from the optimum, retouching brings it much
 * closer, and a gap remains for chapter 6.
 */
export function findWindowSeed(city: City): number {
  const first = city.inst.seed;
  for (let seed = first; seed < first + 100; seed++) {
    const study = timedStudy(city, seed);
    const done = last(study.clock);
    const late = done.kind === 'clock-done' ? done.late : 0;
    const before = last(study.inserted).cost;
    const after = last(study.moved).cost;
    const gap = after / study.optimum.cost - 1;
    if (late >= 3 && after < before * 0.9 && gap > 0.01 && gap < 0.15) return seed;
  }
  return first;
}

/** One run of chapter 6's search, started from chapter 5's final plan. */
export function lnsRun(study: TimedStudy, seed: number): LnsEvent[] {
  return Array.from(largeNeighbourhood(study.problem, last(study.moved).routes, { seed }));
}

/** A draw of chapter 6's search that reaches the optimum, if one of the first forty does. */
export function findLnsSeed(city: City, study: TimedStudy): number {
  const first = city.inst.seed;
  for (let seed = first; seed < first + 40; seed++) {
    if (last(lnsRun(study, seed)).cost < study.optimum.cost * 1.0005) return seed;
  }
  return first;
}
