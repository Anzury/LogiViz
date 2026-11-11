import { describe, expect, it } from 'vitest';
import { planCost } from './fleet';
import { heldKarp } from './heldKarp';
import { DEPOT, generateInstance } from './instance';
import {
  DAY_END,
  DAY_START,
  bestTimedFleet,
  followClock,
  insertion,
  relocateOnTime,
  isOnTime,
  schedule,
  travel,
  withWindows,
  type TimedEvent,
  type TimedProblem,
} from './timeWindows';

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);
const problemFor = (seed: number, customers = 12) => withWindows(generateInstance(seed, customers), seed);
const plan = (ev: TimedEvent) => ev.routes.map((route) => route.nodes);
const last = <T>(items: T[]) => items[items.length - 1];
const complete = (problem: TimedProblem, routes: number[][]) => {
  const seen = routes.flat().sort((a, b) => a - b);
  return seen.length === problem.inst.nodes.length - 1 && seen.every((node, i) => node === i + 1);
};

/** Every plan is some ordering of the houses cut into consecutive routes. */
function bruteForce(problem: TimedProblem): number {
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
        if (routes.every((nodes) => isOnTime(problem, nodes))) best = Math.min(best, planCost(problem.inst, routes));
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

describe('withWindows', () => {
  it('draws reproducible windows inside the day, on ten-minute marks', () => {
    for (const seed of SEEDS) {
      const problem = problemFor(seed);
      expect(problemFor(seed)).toEqual(problem);
      expect(problem.inst).toEqual(generateInstance(seed));
      problem.open.forEach((open, node) => {
        const close = problem.close[node];
        expect(open).toBeGreaterThanOrEqual(DAY_START);
        expect(close).toBeLessThanOrEqual(DAY_END);
        expect(close - open).toBeGreaterThanOrEqual(30);
        expect(open % 10).toBe(0);
        expect(close % 10).toBe(0);
      });
    }
  });

  it('always leaves a plan that serves everyone on time', () => {
    for (const seed of SEEDS) {
      const problem = problemFor(seed);
      // Each house can at least be reached by a truck of its own.
      for (let node = 1; node < problem.inst.nodes.length; node++) expect(isOnTime(problem, [node])).toBe(true);
      expect(bestTimedFleet(problem).cost).toBeLessThan(Infinity);
    }
  });
});

describe('schedule', () => {
  it('waits for a window to open and counts arrivals after closing as late', () => {
    const problem = problemFor(1);
    const [a, b] = [1, 2];
    problem.open[a] = DAY_START + 120;
    problem.close[a] = DAY_START + 180;
    problem.open[b] = DAY_START;
    problem.close[b] = DAY_START + 30;
    const { stops, late, back } = schedule(problem, [a, b]);
    expect(stops[0].arrive).toBeCloseTo(DAY_START + travel(problem, DEPOT, a), 9);
    expect(stops[0].start).toBe(DAY_START + 120);
    expect(stops[0].wait).toBeCloseTo(120 - travel(problem, DEPOT, a), 9);
    expect(stops[0].late).toBe(0);
    expect(stops[1].arrive).toBeCloseTo(stops[0].leave + travel(problem, a, b), 9);
    expect(stops[1].late).toBeGreaterThan(0);
    expect(late).toBe(1);
    expect(back).toBeCloseTo(stops[1].leave + travel(problem, b, DEPOT), 9);
  });
});

describe('followClock', () => {
  it('reports the same lateness as the schedule of the whole tour', () => {
    for (const seed of SEEDS) {
      const problem = problemFor(seed);
      const tour = heldKarp(problem.inst).tour;
      const trace = Array.from(followClock(problem, tour));
      const done = last(trace);
      expect(done.kind).toBe('clock-done');
      if (done.kind === 'clock-done') expect(done.late).toBe(schedule(problem, tour.slice(1)).late);
      expect(done.cost).toBeCloseTo(planCost(problem.inst, plan(done)), 9);
    }
  });
});

describe('insertion', () => {
  it('serves every house on time, taking the most urgent first', () => {
    for (const seed of SEEDS) {
      const problem = problemFor(seed);
      const trace = Array.from(insertion(problem));
      const done = last(trace);
      expect(complete(problem, plan(done))).toBe(true);
      for (const ev of trace) {
        for (const nodes of plan(ev)) expect(isOnTime(problem, nodes)).toBe(true);
      }
      expect(done.cost).toBeCloseTo(planCost(problem.inst, plan(done)), 9);
      const order = trace.flatMap((ev) => (ev.kind === 'ins-place' ? [problem.close[ev.node]] : []));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it('lengthens the plan by exactly the detour it announces', () => {
    const problem = problemFor(6);
    let before = 0;
    for (const ev of insertion(problem)) {
      if (ev.kind === 'ins-place') expect(ev.cost - before).toBeCloseTo(ev.detour, 9);
      before = ev.cost;
    }
  });
});

describe('relocateOnTime', () => {
  it('shortens the plan without ever making anyone late', () => {
    for (const seed of SEEDS) {
      const problem = problemFor(seed);
      const start = last(Array.from(insertion(problem)));
      const trace = Array.from(relocateOnTime(problem, start.routes));
      let before = start.cost;
      for (const ev of trace) {
        for (const nodes of plan(ev)) expect(isOnTime(problem, nodes)).toBe(true);
        expect(complete(problem, plan(ev))).toBe(true);
        expect(ev.cost).toBeLessThanOrEqual(before + 1e-9);
        before = ev.cost;
      }
      expect(bestTimedFleet(problem).cost).toBeLessThanOrEqual(last(trace).cost + 1e-9);
    }
  });
});

describe('bestTimedFleet', () => {
  it('matches brute force on small problems', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const problem = problemFor(seed, 6);
      const exact = bestTimedFleet(problem);
      expect(complete(problem, exact.routes)).toBe(true);
      for (const nodes of exact.routes) expect(isOnTime(problem, nodes)).toBe(true);
      expect(exact.cost).toBeCloseTo(planCost(problem.inst, exact.routes), 9);
      expect(exact.cost).toBeCloseTo(bruteForce(problem), 9);
    }
  });

  it('is on time, complete, and never beaten by insertion', () => {
    for (const seed of SEEDS) {
      const problem = problemFor(seed);
      const exact = bestTimedFleet(problem);
      expect(complete(problem, exact.routes)).toBe(true);
      for (const nodes of exact.routes) expect(isOnTime(problem, nodes)).toBe(true);
      expect(exact.cost).toBeLessThanOrEqual(last(Array.from(insertion(problem))).cost + 1e-9);
      // Windows can only make things longer than the unconstrained single tour.
      expect(exact.cost).toBeGreaterThanOrEqual(heldKarp(problem.inst).cost - 1e-9);
    }
  });
});
