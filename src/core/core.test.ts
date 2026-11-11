import { describe, expect, it } from 'vitest';
import { anneal } from './annealing';
import { heldKarp } from './heldKarp';
import { generateLandscape, nearestMinimum, wander } from './landscape';
import { DEPOT, generateInstance, type Instance } from './instance';
import { nearestNeighbour } from './nearestNeighbour';
import { mulberry32 } from './rng';
import { isCompleteTour, randomTour, tourCost } from './tour';
import { record, result } from './trace';
import { improvingMoves, twoOpt } from './twoOpt';

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

function bruteForce(inst: Instance): number {
  const rest = inst.nodes.map((_, i) => i).slice(1);
  let best = Infinity;
  const permute = (k: number) => {
    if (k === rest.length) {
      best = Math.min(best, tourCost(inst, [DEPOT, ...rest]));
      return;
    }
    for (let i = k; i < rest.length; i++) {
      [rest[k], rest[i]] = [rest[i], rest[k]];
      permute(k + 1);
      [rest[k], rest[i]] = [rest[i], rest[k]];
    }
  };
  permute(0);
  return best;
}

describe('generateInstance', () => {
  it('is deterministic for a given seed', () => {
    expect(generateInstance(7)).toEqual(generateInstance(7));
    expect(generateInstance(7).nodes).not.toEqual(generateInstance(8).nodes);
  });

  it('places the requested number of well separated nodes on the board', () => {
    for (const seed of SEEDS) {
      const inst = generateInstance(seed, 12);
      expect(inst.nodes).toHaveLength(13);
      for (const p of inst.nodes) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(inst.size);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(inst.size);
      }
      for (let i = 0; i < 13; i++) {
        for (let j = i + 1; j < 13; j++) expect(inst.dist[i][j]).toBeGreaterThan(8);
      }
    }
  });
});

describe('nearestNeighbour', () => {
  it('builds a complete tour whose reported cost matches its length', () => {
    for (const seed of SEEDS) {
      const inst = generateInstance(seed);
      const trace = record(nearestNeighbour(inst));
      const { tour, cost } = result(trace);
      expect(isCompleteTour(inst, tour)).toBe(true);
      expect(cost).toBeCloseTo(tourCost(inst, tour), 9);
      expect(trace[trace.length - 1].closed).toBe(true);
    }
  });

  it('always extends to the closest unvisited node', () => {
    const inst = generateInstance(3);
    for (const ev of nearestNeighbour(inst)) {
      if (ev.kind !== 'nn-consider') continue;
      const closest = Math.min(...ev.candidates.map((c) => inst.dist[ev.from][c]));
      expect(inst.dist[ev.from][ev.nearest]).toBe(closest);
    }
  });
});

describe('twoOpt', () => {
  it('never lengthens the tour and reports an accurate cost at every step', () => {
    for (const seed of SEEDS) {
      const inst = generateInstance(seed);
      const start = randomTour(inst, mulberry32(seed));
      let previous = Infinity;
      for (const ev of twoOpt(inst, start)) {
        expect(isCompleteTour(inst, ev.tour)).toBe(true);
        expect(ev.cost).toBeCloseTo(tourCost(inst, ev.tour), 6);
        expect(ev.cost).toBeLessThanOrEqual(previous + 1e-9);
        previous = ev.cost;
      }
    }
  });

  it('stops on a tour that no 2-opt move can improve', () => {
    for (const seed of SEEDS) {
      const inst = generateInstance(seed);
      const { tour } = result(record(twoOpt(inst, randomTour(inst, mulberry32(seed)))));
      const again = record(twoOpt(inst, tour));
      expect(again.some((ev) => ev.kind === '2opt-apply')).toBe(false);
    }
  });
});

describe('improvingMoves', () => {
  it('reports moves whose gain matches the tour they produce', () => {
    for (const seed of SEEDS) {
      const inst = generateInstance(seed);
      const tour = randomTour(inst, mulberry32(seed));
      const cost = tourCost(inst, tour);
      for (const move of improvingMoves(inst, tour)) {
        expect(isCompleteTour(inst, move.after)).toBe(true);
        expect(move.gain).toBeGreaterThan(0);
        expect(tourCost(inst, move.after)).toBeCloseTo(cost - move.gain, 6);
      }
    }
  });

  it('lists every pair of crossing edges, since uncrossing always shortens', () => {
    const turn = (inst: Instance, o: number, p: number, q: number) => {
      const [O, P, Q] = [inst.nodes[o], inst.nodes[p], inst.nodes[q]];
      return Math.sign((P.x - O.x) * (Q.y - O.y) - (P.y - O.y) * (Q.x - O.x));
    };
    for (const seed of SEEDS) {
      const inst = generateInstance(seed);
      const tour = randomTour(inst, mulberry32(seed));
      const n = tour.length;
      let crossings = 0;
      for (let i = 0; i < n; i++) {
        for (let j = i + 2; j < n; j++) {
          if (i === 0 && j === n - 1) continue;
          const [a, b, c, d] = [tour[i], tour[i + 1], tour[j], tour[(j + 1) % n]];
          if (turn(inst, a, b, c) !== turn(inst, a, b, d) && turn(inst, c, d, a) !== turn(inst, c, d, b)) crossings++;
        }
      }
      expect(improvingMoves(inst, tour).filter((move) => move.crossing)).toHaveLength(crossings);
    }
  });

  it('is empty exactly when 2-opt has nothing left to do', () => {
    for (const seed of SEEDS) {
      const inst = generateInstance(seed);
      const { tour } = result(record(twoOpt(inst, randomTour(inst, mulberry32(seed)))));
      expect(improvingMoves(inst, tour)).toHaveLength(0);
    }
  });
});

describe('anneal', () => {
  const run = (seed: number, options = {}) => {
    const inst = generateInstance(seed);
    const start = result(record(twoOpt(inst, result(record(nearestNeighbour(inst))).tour)));
    return { inst, start, trace: record(anneal(inst, start.tour, { seed, ...options })) };
  };

  it('reports accurate costs and returns the best tour it saw', () => {
    for (const seed of SEEDS) {
      const { inst, start, trace } = run(seed);
      let lowest = Infinity;
      for (const ev of trace.slice(0, -1)) {
        expect(isCompleteTour(inst, ev.tour)).toBe(true);
        expect(ev.cost).toBeCloseTo(tourCost(inst, ev.tour), 6);
        lowest = Math.min(lowest, ev.cost);
      }
      const done = trace[trace.length - 1];
      expect(done.kind).toBe('sa-done');
      expect(done.cost).toBeCloseTo(lowest, 6);
      expect(done.cost).toBeCloseTo(tourCost(inst, done.tour), 6);
      expect(done.cost).toBeLessThanOrEqual(start.cost + 1e-9);
    }
  });

  it('is reproducible for a seed and varies across seeds', () => {
    const inst = generateInstance(4);
    const start = result(record(nearestNeighbour(inst))).tour;
    const costs = (seed: number) => record(anneal(inst, start, { seed })).map((ev) => ev.cost);
    expect(costs(1)).toEqual(costs(1));
    expect(costs(1)).not.toEqual(costs(2));
  });

  it('follows the Metropolis rule', () => {
    for (const ev of run(5).trace) {
      if (ev.kind !== 'sa-propose') continue;
      if (ev.delta <= 0) expect(ev.accepted).toBe(true);
      else expect(ev.probability).toBeCloseTo(Math.exp(-ev.delta / ev.temperature), 12);
    }
  });

  it('turns into plain descent when it starts cold', () => {
    const { trace } = run(6, { startTemperature: 1e-6, endTemperature: 1e-7 });
    for (const ev of trace) {
      if (ev.kind === 'sa-propose' && ev.accepted) expect(ev.delta).toBeLessThanOrEqual(0);
    }
  });
});

describe('landscape', () => {
  it('is deterministic, bounded, and lists its basins deepest first', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const land = generateLandscape(seed);
      const again = generateLandscape(seed);
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          const h = land.height(i / 20, j / 20);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThanOrEqual(1);
          expect(again.height(i / 20, j / 20)).toBe(h);
        }
      }
      const heights = land.minima.map((m) => m.height);
      expect(heights).toEqual([...heights].sort((a, b) => a - b));
    }
  });

  it('a cold ball only rolls down and stops at the bottom of a pit', () => {
    const land = generateLandscape(3);
    for (const seed of SEEDS) {
      const rng = mulberry32(seed);
      const trace = Array.from(wander(land, { x: rng(), y: rng() }, { seed, startTemperature: 0 }));
      let previous = Infinity;
      for (const ev of trace) {
        expect(ev.at.height).toBeLessThanOrEqual(previous);
        previous = ev.at.height;
      }
      const end = trace[trace.length - 1].at;
      const pit = nearestMinimum(land, end);
      expect(Math.hypot(pit.x - end.x, pit.y - end.y)).toBeLessThan(0.07);
    }
  });

  it('a hot ball climbs sometimes, and remembers the lowest spot it visited', () => {
    const land = generateLandscape(3);
    const trace = Array.from(wander(land, { x: 0.5, y: 0.5 }, { seed: 7, startTemperature: 0.12 }));
    let climbed = false;
    let lowest = Infinity;
    for (const ev of trace) {
      lowest = Math.min(lowest, ev.at.height);
      expect(ev.best.height).toBe(lowest);
      if (ev.kind === 'step' && ev.accepted && ev.delta > 0) climbed = true;
    }
    expect(climbed).toBe(true);
    expect(trace[trace.length - 1].temperature).toBeLessThan(0.0025);
  });
});

describe('heldKarp', () => {
  it('matches brute force on small instances', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const inst = generateInstance(seed, 7);
      const exact = heldKarp(inst);
      expect(isCompleteTour(inst, exact.tour)).toBe(true);
      expect(exact.cost).toBeCloseTo(tourCost(inst, exact.tour), 9);
      expect(exact.cost).toBeCloseTo(bruteForce(inst), 9);
    }
  });

  it('is never beaten by the heuristics', () => {
    for (const seed of SEEDS) {
      const inst = generateInstance(seed);
      const exact = heldKarp(inst);
      const nn = result(record(nearestNeighbour(inst)));
      const improved = result(record(twoOpt(inst, nn.tour)));
      expect(exact.cost).toBeLessThanOrEqual(improved.cost + 1e-9);
      expect(improved.cost).toBeLessThanOrEqual(nn.cost + 1e-9);
    }
  });
});
