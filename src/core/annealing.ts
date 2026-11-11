import type { Instance } from './instance';
import { mulberry32 } from './rng';
import { tourCost } from './tour';
import type { Edge, TraceEvent } from './trace';

/** Pseudo-code shown next to the scene; event `line` values index into it. */
export const ANNEAL_PSEUDOCODE = [
  'T ← température de départ',
  'répéter :',
  '    tirer deux fils au hasard',
  '    Δ ← allongement si on les renoue',
  '    si Δ < 0, ou avec la probabilité exp(−Δ / T) :',
  '        renouer',
  '    T ← α × T',
  'rendre la meilleure tournée rencontrée',
];

export interface AnnealOptions {
  seed: number;
  iterations?: number;
  /** In board units, like tour lengths: a move that lengthens the tour by T is accepted with probability 1/e. */
  startTemperature?: number;
  endTemperature?: number;
}

/**
 * Simulated annealing over 2-opt moves. Each step proposes one random move;
 * improvements are always taken, degradations with probability exp(−Δ/T)
 * (Metropolis rule), and T shrinks geometrically until almost nothing bad is
 * accepted any more. The answer is the best tour seen on the way.
 */
export function* anneal(inst: Instance, start: number[], options: AnnealOptions): Generator<TraceEvent> {
  const { seed, iterations = 800, startTemperature = 20, endTemperature = 2 } = options;
  const rng = mulberry32(seed);
  const d = inst.dist;
  const n = start.length;
  const cooling = (endTemperature / startTemperature) ** (1 / iterations);

  const tour = start.slice();
  let cost = tourCost(inst, tour);
  let best = tour.slice();
  let bestCost = cost;
  let temperature = startTemperature;
  let accepted = 0;
  let uphill = 0;
  const snap = (line: number) => ({ tour: tour.slice(), closed: true, cost, line, temperature, best: bestCost });

  yield { kind: 'sa-start', ...snap(0) };

  for (let k = 0; k < iterations; k++) {
    // Two distinct, non-adjacent edges, every pair equally likely.
    let i: number;
    let j: number;
    do {
      i = Math.floor(rng() * n);
      j = Math.floor(rng() * n);
      if (i > j) [i, j] = [j, i];
    } while (j - i < 2 || (i === 0 && j === n - 1));

    const a = tour[i];
    const b = tour[i + 1];
    const c = tour[j];
    const e = tour[(j + 1) % n];
    const delta = d[a][c] + d[b][e] - d[a][b] - d[c][e];
    const probability = delta <= 0 ? 1 : Math.exp(-delta / temperature);
    const take = delta <= 0 || rng() < probability;
    const removed: [Edge, Edge] = [[a, b], [c, e]];
    const added: [Edge, Edge] = [[a, c], [b, e]];

    let record = false;
    if (take) {
      for (let lo = i + 1, hi = j; lo < hi; lo++, hi--) [tour[lo], tour[hi]] = [tour[hi], tour[lo]];
      cost += delta;
      accepted++;
      if (delta > 0) uphill++;
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = tour.slice();
        record = true;
      }
    }
    yield { kind: 'sa-propose', removed, added, delta, probability, accepted: take, record, ...snap(take ? 5 : 4) };
    temperature *= cooling;
  }

  yield {
    kind: 'sa-done',
    tour: best,
    closed: true,
    cost: bestCost,
    line: 7,
    temperature,
    best: bestCost,
    proposals: iterations,
    accepted,
    uphill,
  };
}
