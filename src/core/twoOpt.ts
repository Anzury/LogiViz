import type { Instance } from './instance';
import { tourCost } from './tour';
import type { Edge, TraceEvent } from './trace';

/** Pseudo-code shown next to the scene; event `line` values index into it. */
export const TWO_OPT_PSEUDOCODE = [
  'répéter :',
  '    pour chaque paire de fils (a→b) et (c→d) :',
  '        gain ← d(a,b) + d(c,d) − d(a,c) − d(b,d)',
  '        si gain > 0 :',
  '            renouer en (a→c) et (b→d)',
  'jusqu’à ce qu’aucune paire n’améliore',
];

const EPS = 1e-9;

/**
 * 2-opt local search, first improvement: look at every pair of non-adjacent
 * edges, and whenever swapping them shortens the tour, do it straight away.
 * Stops after a full pass without any improvement (a 2-opt local optimum).
 */
export function* twoOpt(inst: Instance, start: number[]): Generator<TraceEvent> {
  const d = inst.dist;
  const n = start.length;
  const tour = start.slice();
  let cost = tourCost(inst, tour);
  let passes = 0;
  let moves = 0;
  const snap = (line: number) => ({ tour: tour.slice(), closed: true, cost, line });

  yield { kind: '2opt-start', ...snap(0) };

  let improved = true;
  while (improved) {
    improved = false;
    passes++;
    for (let i = 0; i < n - 2; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // these two edges share the depot
        const a = tour[i];
        const b = tour[i + 1];
        const c = tour[j];
        const e = tour[(j + 1) % n];
        const gain = d[a][b] + d[c][e] - d[a][c] - d[b][e];
        const removed: [Edge, Edge] = [[a, b], [c, e]];
        const added: [Edge, Edge] = [[a, c], [b, e]];
        yield { kind: '2opt-examine', removed, added, gain, ...snap(2) };

        if (gain > EPS) {
          // Reconnecting a→c and b→e means driving the stretch b…c backwards.
          for (let lo = i + 1, hi = j; lo < hi; lo++, hi--) {
            [tour[lo], tour[hi]] = [tour[hi], tour[lo]];
          }
          cost -= gain;
          moves++;
          improved = true;
          yield { kind: '2opt-apply', removed, added, gain, ...snap(4) };
        }
      }
    }
  }

  yield { kind: '2opt-done', passes, moves, ...snap(5) };
}

export interface TwoOptMove {
  removed: [Edge, Edge];
  added: [Edge, Edge];
  gain: number;
  /** True when the two removed edges visibly cross on the board. */
  crossing: boolean;
  /** The tour once the move is applied. */
  after: number[];
}

/** Every single 2-opt move that would shorten `tour`, without applying any. */
export function improvingMoves(inst: Instance, tour: number[]): TwoOptMove[] {
  const d = inst.dist;
  const n = tour.length;
  const moves: TwoOptMove[] = [];
  for (let i = 0; i < n - 2; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const a = tour[i];
      const b = tour[i + 1];
      const c = tour[j];
      const e = tour[(j + 1) % n];
      const gain = d[a][b] + d[c][e] - d[a][c] - d[b][e];
      if (gain <= EPS) continue;
      const after = [...tour.slice(0, i + 1), ...tour.slice(i + 1, j + 1).reverse(), ...tour.slice(j + 1)];
      const crossing = segmentsCross(inst, a, b, c, e);
      moves.push({ removed: [[a, b], [c, e]], added: [[a, c], [b, e]], gain, crossing, after });
    }
  }
  return moves;
}

function segmentsCross(inst: Instance, a: number, b: number, c: number, e: number): boolean {
  const side = (o: number, p: number, q: number) => {
    const O = inst.nodes[o];
    const P = inst.nodes[p];
    const Q = inst.nodes[q];
    return (P.x - O.x) * (Q.y - O.y) - (P.y - O.y) * (Q.x - O.x);
  };
  return side(c, e, a) * side(c, e, b) < 0 && side(a, b, c) * side(a, b, e) < 0;
}
