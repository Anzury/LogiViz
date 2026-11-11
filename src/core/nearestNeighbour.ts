import { DEPOT, type Instance } from './instance';
import type { TraceEvent } from './trace';

/** Pseudo-code shown next to the scene; event `line` values index into it. */
export const NN_PSEUDOCODE = [
  'tournée ← [dépôt]',
  'tant qu’il reste des maisons non livrées :',
  '    mesurer la distance jusqu’à chacune',
  '    aller à la plus proche',
  'revenir au dépôt',
];

/** Greedy construction: from the current stop, always drive to the closest unvisited house. */
export function* nearestNeighbour(inst: Instance): Generator<TraceEvent> {
  const n = inst.nodes.length;
  const tour = [DEPOT];
  const visited = new Set(tour);
  let cost = 0;
  const snap = (line: number, closed = false) => ({ tour: tour.slice(), closed, cost, line });

  yield { kind: 'nn-start', ...snap(0) };

  while (tour.length < n) {
    const from = tour[tour.length - 1];
    const candidates: number[] = [];
    let nearest = -1;
    for (let v = 0; v < n; v++) {
      if (visited.has(v)) continue;
      candidates.push(v);
      if (nearest < 0 || inst.dist[from][v] < inst.dist[from][nearest]) nearest = v;
    }
    yield { kind: 'nn-consider', from, candidates, nearest, ...snap(2) };

    tour.push(nearest);
    visited.add(nearest);
    cost += inst.dist[from][nearest];
    yield { kind: 'nn-extend', from, to: nearest, ...snap(3) };
  }

  const from = tour[tour.length - 1];
  cost += inst.dist[from][DEPOT];
  yield { kind: 'nn-close', from, ...snap(4, true) };
}
