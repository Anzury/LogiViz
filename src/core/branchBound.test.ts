import { describe, expect, it } from 'vitest';
import { boundOf, branchAndBound, spanningTree, type BranchEvent } from './branchBound';
import { heldKarp } from './heldKarp';
import { DEPOT, generateInstance } from './instance';
import { nearestNeighbour } from './nearestNeighbour';
import { mulberry32 } from './rng';
import { randomTour, tourCost } from './tour';
import { record, result } from './trace';

const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const last = <T>(items: T[]) => items[items.length - 1];

describe('spanningTree', () => {
  it('links every node with one thread fewer than there are nodes', () => {
    for (const seed of SEEDS) {
      const inst = generateInstance(seed);
      const nodes = inst.nodes.map((_, node) => node);
      const { cost, edges } = spanningTree(inst, nodes);
      expect(edges).toHaveLength(nodes.length - 1);
      expect(cost).toBeCloseTo(edges.reduce((sum, [a, b]) => sum + inst.dist[a][b], 0), 9);
      // Every node is reachable from the first.
      const reached = new Set([nodes[0]]);
      for (let pass = 0; pass < nodes.length; pass++) {
        for (const [a, b] of edges) {
          if (reached.has(a)) reached.add(b);
          if (reached.has(b)) reached.add(a);
        }
      }
      expect(reached.size).toBe(nodes.length);
    }
  });

  it('is never longer than a path through the same nodes', () => {
    for (const seed of SEEDS) {
      const inst = generateInstance(seed);
      const tour = randomTour(inst, mulberry32(seed));
      // A tour without its closing leg is a path through every node.
      expect(spanningTree(inst, tour).cost).toBeLessThanOrEqual(tourCost(inst, tour, false) + 1e-9);
    }
  });
});

describe('boundOf', () => {
  it('never exceeds the length of a tour that starts that way', () => {
    for (const seed of SEEDS) {
      const inst = generateInstance(seed);
      const tour = randomTour(inst, mulberry32(seed * 7));
      const length = tourCost(inst, tour);
      for (let fixed = 1; fixed <= tour.length; fixed++) {
        expect(boundOf(inst, tour.slice(0, fixed)).bound).toBeLessThanOrEqual(length + 1e-9);
      }
      // With every house fixed, the bound is the tour itself.
      expect(boundOf(inst, tour).bound).toBeCloseTo(length, 9);
    }
  });

  it('never exceeds the optimum at the root', () => {
    for (const seed of SEEDS) {
      const inst = generateInstance(seed);
      expect(boundOf(inst, [DEPOT]).bound).toBeLessThanOrEqual(heldKarp(inst).cost + 1e-9);
    }
  });
});

describe('branchAndBound', () => {
  const run = (seed: number, detail = 2) => {
    const inst = generateInstance(seed);
    const start = result(record(nearestNeighbour(inst)));
    return { inst, start, trace: Array.from(branchAndBound(inst, start, detail)) };
  };

  it('ends on the optimum, whatever tour it starts from', () => {
    for (const seed of SEEDS) {
      const { inst, trace } = run(seed);
      const done = last(trace);
      const exact = heldKarp(inst);
      expect(done.kind).toBe('bb-done');
      expect(done.best).toBeCloseTo(exact.cost, 6);
      expect(tourCost(inst, done.bestTour)).toBeCloseTo(exact.cost, 6);
      // Starting from the optimum itself, nothing better is ever found.
      const proof = Array.from(branchAndBound(inst, exact));
      expect(proof.some((ev) => ev.kind === 'bb-best')).toBe(false);
      expect(last(proof).best).toBeCloseTo(exact.cost, 9);
    }
  });

  it('accounts for every visiting order: built, or ruled out by a cut', () => {
    for (const seed of SEEDS) {
      const { trace } = run(seed);
      const done = last(trace) as Extract<BranchEvent, { kind: 'bb-done' }>;
      const built = trace.filter((ev) => ev.kind === 'bb-best').length;
      expect(done.ruledOut + built).toBe(done.orders);
      expect(done.orders).toBe(479001600);
      expect(done.cut).toBeLessThan(done.examined);
    }
  });

  it('only cuts families whose bound cannot beat the best tour, and only improves', () => {
    const { trace } = run(5);
    let best = Infinity;
    for (const ev of trace) {
      expect(ev.best).toBeLessThanOrEqual(best + 1e-9);
      best = ev.best;
      if (ev.kind === 'bb-node') expect(ev.pruned).toBe(ev.bound >= ev.best - 1e-9);
      if (ev.kind === 'bb-best') expect(ev.best).toBeLessThan(ev.previous);
    }
  });

  it('narrates families down to the requested depth and sums up the rest', () => {
    const { trace } = run(4, 2);
    for (const ev of trace) {
      if (ev.kind === 'bb-node') expect(ev.path.length - 1).toBeLessThanOrEqual(2);
      if (ev.kind === 'bb-below') {
        expect(ev.path.length - 1).toBe(2);
        expect(ev.cutBelow).toBeLessThanOrEqual(ev.examinedBelow);
      }
    }
    const deep = Array.from(branchAndBound(generateInstance(4), result(record(nearestNeighbour(generateInstance(4)))), 3));
    expect(last(deep).examined).toBe(last(trace).examined);
    expect(deep.length).toBeGreaterThan(trace.length);
  });
});
