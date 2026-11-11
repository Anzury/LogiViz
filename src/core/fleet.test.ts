import { describe, expect, it } from 'vitest';
import {
  bestFleet,
  cutTour,
  isFeasiblePlan,
  planCost,
  relocate,
  routeLoad,
  savings,
  withDemands,
  type FleetEvent,
  type FleetProblem,
} from './fleet';
import { heldKarp } from './heldKarp';
import { DEPOT, generateInstance } from './instance';

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const problemFor = (seed: number, customers = 12, capacity = 10) =>
  withDemands(generateInstance(seed, customers), seed, capacity);
const plan = (ev: FleetEvent) => ev.routes.map((route) => route.nodes);
const last = <T>(items: T[]) => items[items.length - 1];

/** Every plan is some ordering of the houses cut into consecutive routes. */
function bruteForce(problem: FleetProblem): number {
  const houses = problem.inst.nodes.map((_, i) => i).slice(1);
  let best = Infinity;
  const visit = (k: number) => {
    if (k === houses.length) {
      for (let cuts = 0; cuts < 1 << (houses.length - 1); cuts++) {
        const routes: number[][] = [[]];
        houses.forEach((house, i) => {
          routes[routes.length - 1].push(house);
          if (cuts & (1 << i)) routes.push([]);
        });
        if (routes.every((nodes) => routeLoad(problem, nodes) <= problem.capacity)) {
          best = Math.min(best, planCost(problem.inst, routes));
        }
      }
      return;
    }
    for (let i = k; i < houses.length; i++) {
      [houses[k], houses[i]] = [houses[i], houses[k]];
      visit(k + 1);
      [houses[k], houses[i]] = [houses[i], houses[k]];
    }
  };
  visit(0);
  return best;
}

describe('withDemands', () => {
  it('gives every house 1 to 4 parcels, none to the depot, reproducibly', () => {
    for (const seed of SEEDS) {
      const problem = problemFor(seed);
      expect(problem.demand[DEPOT]).toBe(0);
      for (const parcels of problem.demand.slice(1)) {
        expect(parcels).toBeGreaterThanOrEqual(1);
        expect(parcels).toBeLessThanOrEqual(4);
      }
      expect(problemFor(seed).demand).toEqual(problem.demand);
    }
  });

  it('leaves the town itself untouched', () => {
    expect(problemFor(5).inst).toEqual(generateInstance(5));
  });
});

describe('cutTour', () => {
  it('keeps the order of the big tour and never overloads a truck', () => {
    for (const seed of SEEDS) {
      const problem = problemFor(seed);
      const giant = heldKarp(problem.inst).tour;
      const done = last(Array.from(cutTour(problem, giant)));
      expect(isFeasiblePlan(problem, plan(done))).toBe(true);
      expect(plan(done).flat()).toEqual(giant.slice(1));
      expect(done.cost).toBeCloseTo(planCost(problem.inst, plan(done)), 9);
    }
  });

  it('only sends a truck home when the next house does not fit', () => {
    const problem = problemFor(3);
    for (const ev of cutTour(problem, heldKarp(problem.inst).tour)) {
      if (ev.kind === 'cut-full') expect(ev.load + problem.demand[ev.node]).toBeGreaterThan(problem.capacity);
      if (ev.kind === 'cut-load') expect(ev.load).toBeLessThanOrEqual(problem.capacity);
    }
  });
});

describe('savings', () => {
  it('starts with one truck per house and only ever shortens the plan', () => {
    for (const seed of SEEDS) {
      const problem = problemFor(seed);
      const trace = Array.from(savings(problem));
      expect(trace[0].routes).toHaveLength(12);
      let previous = Infinity;
      for (const ev of trace) {
        expect(isFeasiblePlan(problem, plan(ev))).toBe(true);
        expect(ev.cost).toBeCloseTo(planCost(problem.inst, plan(ev)), 9);
        expect(ev.cost).toBeLessThanOrEqual(previous + 1e-9);
        previous = ev.cost;
      }
    }
  });

  it('saves exactly what each merge announces', () => {
    const problem = problemFor(7);
    let before = 0;
    for (const ev of savings(problem)) {
      if (ev.kind === 'cw-merge') expect(before - ev.cost).toBeCloseTo(ev.saving, 9);
      before = ev.cost;
    }
  });

  it('considers pairs from the largest saving down', () => {
    const considered = Array.from(savings(problemFor(2))).flatMap((ev) => (ev.kind === 'cw-consider' ? [ev.saving] : []));
    expect(considered).toEqual([...considered].sort((a, b) => b - a));
  });
});

describe('relocate', () => {
  it('gains what it announces and stops where no single move helps', () => {
    for (const seed of SEEDS) {
      const problem = problemFor(seed);
      const start = last(Array.from(savings(problem))).routes;
      const trace = Array.from(relocate(problem, start));
      let before = trace[0].cost;
      for (const ev of trace) {
        expect(isFeasiblePlan(problem, plan(ev))).toBe(true);
        if (ev.kind === 'move-apply') {
          expect(before - ev.cost).toBeCloseTo(ev.gain, 9);
          expect(ev.gain).toBeGreaterThan(0);
        }
        before = ev.cost;
      }
      const again = Array.from(relocate(problem, last(trace).routes));
      expect(again.some((ev) => ev.kind === 'move-apply')).toBe(false);
    }
  });
});

describe('bestFleet', () => {
  it('matches brute force on small problems', () => {
    for (const seed of [1, 2, 3, 4]) {
      const problem = problemFor(seed, 6, 7);
      const exact = bestFleet(problem);
      expect(isFeasiblePlan(problem, exact.routes)).toBe(true);
      expect(exact.cost).toBeCloseTo(planCost(problem.inst, exact.routes), 9);
      expect(exact.cost).toBeCloseTo(bruteForce(problem), 9);
    }
  });

  it('is the single-truck optimum when one truck can carry everything', () => {
    const problem = problemFor(4, 12, 1000);
    expect(bestFleet(problem).cost).toBeCloseTo(heldKarp(problem.inst).cost, 9);
    expect(bestFleet(problem).routes).toHaveLength(1);
  });

  it('is never beaten by the heuristics', () => {
    for (const seed of SEEDS) {
      const problem = problemFor(seed);
      const exact = bestFleet(problem);
      const cut = last(Array.from(cutTour(problem, heldKarp(problem.inst).tour)));
      const saved = last(Array.from(savings(problem)));
      const moved = last(Array.from(relocate(problem, saved.routes)));
      expect(isFeasiblePlan(problem, exact.routes)).toBe(true);
      for (const heuristic of [cut, saved, moved]) expect(exact.cost).toBeLessThanOrEqual(heuristic.cost + 1e-9);
      expect(moved.cost).toBeLessThanOrEqual(saved.cost + 1e-9);
    }
  });
});
