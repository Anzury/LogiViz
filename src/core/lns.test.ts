import { describe, expect, it } from 'vitest';
import { planCost } from './fleet';
import { generateInstance } from './instance';
import { largeNeighbourhood, type LnsEvent } from './lns';
import { bestTimedFleet, insertion, isOnTime, relocateOnTime, withWindows } from './timeWindows';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const last = <T>(items: T[]) => items[items.length - 1];

function setUp(seed: number) {
  const problem = withWindows(generateInstance(seed), seed);
  const start = last(Array.from(relocateOnTime(problem, last(Array.from(insertion(problem))).routes)));
  return { problem, start };
}
const run = (seed: number, options = {}) => {
  const { problem, start } = setUp(seed);
  return { problem, start, trace: Array.from(largeNeighbourhood(problem, start.routes, { seed, ...options })) };
};

describe('largeNeighbourhood', () => {
  it('keeps everyone on time at every step, and every house in the plans it keeps', () => {
    for (const seed of SEEDS) {
      const { problem, trace } = run(seed);
      const houses = problem.inst.nodes.length - 1;
      for (const ev of trace) {
        for (const route of ev.routes) expect(isOnTime(problem, route.nodes)).toBe(true);
        expect(ev.cost).toBeCloseTo(planCost(problem.inst, ev.routes.map((route) => route.nodes)), 9);
        const placed = ev.routes.flatMap((route) => route.nodes);
        expect(new Set(placed).size).toBe(placed.length);
        if (ev.kind === 'lns-verdict' || ev.kind === 'lns-done' || ev.kind === 'lns-start') {
          expect(placed).toHaveLength(houses);
          expect(ev.cost).toBeCloseTo(ev.kept, 9);
        }
      }
    }
  });

  it('takes houses out, then puts every one of them back', () => {
    const { problem, trace } = run(3);
    const houses = problem.inst.nodes.length - 1;
    let out: number[] = [];
    for (const ev of trace) {
      if (ev.kind === 'lns-destroy') {
        out = ev.removed.slice();
        expect(out).toHaveLength(5);
        expect(ev.routes.flatMap((route) => route.nodes)).toHaveLength(houses - 5);
      }
      if (ev.kind === 'lns-repair') {
        out = out.filter((node) => node !== ev.node);
        expect([...ev.waiting].sort()).toEqual([...out].sort());
      }
      if (ev.kind === 'lns-verdict') expect(out).toHaveLength(0);
    }
  });

  it('only ever keeps a shorter plan', () => {
    for (const seed of SEEDS) {
      const { start, trace } = run(seed);
      let kept = start.cost;
      for (const ev of trace) {
        expect(ev.kept).toBeLessThanOrEqual(kept + 1e-9);
        if (ev.kind === 'lns-verdict') {
          expect(ev.accepted).toBe(ev.after < ev.before - 1e-9);
          expect(ev.kept).toBeCloseTo(ev.accepted ? ev.after : ev.before, 9);
        }
        kept = ev.kept;
      }
    }
  });

  it('stops after the agreed number of fruitless rounds, and never beats the optimum', () => {
    for (const seed of SEEDS) {
      const { problem, trace } = run(seed, { patience: 6 });
      const done = last(trace) as Extract<LnsEvent, { kind: 'lns-done' }>;
      expect(done.kind).toBe('lns-done');
      const verdicts = trace.filter((ev) => ev.kind === 'lns-verdict') as Extract<LnsEvent, { kind: 'lns-verdict' }>[];
      expect(verdicts).toHaveLength(done.rounds);
      expect(verdicts.filter((ev) => ev.accepted)).toHaveLength(done.improvements);
      if (done.exhausted) expect(verdicts.slice(-6).every((ev) => !ev.accepted)).toBe(true);
      expect(done.cost).toBeGreaterThanOrEqual(bestTimedFleet(problem).cost - 1e-9);
    }
  });

  it('is reproducible for a seed and varies across seeds', () => {
    const { problem, start } = setUp(2);
    const removed = (seed: number) =>
      Array.from(largeNeighbourhood(problem, start.routes, { seed })).flatMap((ev) => (ev.kind === 'lns-destroy' ? [ev.removed] : []));
    expect(removed(1)).toEqual(removed(1));
    expect(removed(1)).not.toEqual(removed(2));
  });
});
