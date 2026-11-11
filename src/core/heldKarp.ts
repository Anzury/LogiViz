import { DEPOT, type Instance } from './instance';

/** The best closed tour through the depot and every subset of customers. */
export interface SubsetTours {
  /** Number of customers; subsets are bit masks over customers 1..size (bit k is customer k + 1). */
  size: number;
  /** Length of the best tour depot → customers of the mask → depot. */
  cost: Float64Array;
  /** Visiting order of that tour, as node ids, depot excluded. */
  order(mask: number): number[];
}

/**
 * Dynamic programming over subsets (Held-Karp). Memory and time grow as 2^n,
 * so this is only for small teaching instances: it gives the chapters true
 * optima to measure heuristics against.
 */
export function subsetTours(inst: Instance): SubsetTours {
  const m = inst.nodes.length - 1; // customers are nodes 1..m
  if (m > 16) throw new Error(`Held-Karp is limited to 16 customers, got ${m}`);
  const d = inst.dist;
  const full = 1 << m;

  // best[mask * m + last]: shortest path from the depot through `mask`, ending at customer `last`.
  const best = new Float64Array(full * m).fill(Infinity);
  const parent = new Int8Array(full * m).fill(-1);
  for (let k = 0; k < m; k++) best[(1 << k) * m + k] = d[DEPOT][k + 1];

  for (let mask = 1; mask < full; mask++) {
    for (let last = 0; last < m; last++) {
      if (!(mask & (1 << last))) continue;
      const here = best[mask * m + last];
      if (here === Infinity) continue;
      for (let next = 0; next < m; next++) {
        if (mask & (1 << next)) continue;
        const slot = (mask | (1 << next)) * m + next;
        const value = here + d[last + 1][next + 1];
        if (value < best[slot]) {
          best[slot] = value;
          parent[slot] = last;
        }
      }
    }
  }

  // Close each path back to the depot, remembering which customer comes last.
  const cost = new Float64Array(full);
  const end = new Int8Array(full).fill(-1);
  for (let mask = 1; mask < full; mask++) {
    cost[mask] = Infinity;
    for (let k = 0; k < m; k++) {
      if (!(mask & (1 << k))) continue;
      const value = best[mask * m + k] + d[k + 1][DEPOT];
      if (value < cost[mask]) {
        cost[mask] = value;
        end[mask] = k;
      }
    }
  }

  const order = (mask: number) => {
    const reversed: number[] = [];
    for (let last = end[mask]; last >= 0; ) {
      reversed.push(last + 1);
      const previous = parent[mask * m + last];
      mask ^= 1 << last;
      last = previous;
    }
    return reversed.reverse();
  };
  return { size: m, cost, order };
}

/** Exact optimum of the single-truck problem. */
export function heldKarp(inst: Instance): { tour: number[]; cost: number } {
  const tours = subsetTours(inst);
  const everyone = (1 << tours.size) - 1;
  return { tour: [DEPOT, ...tours.order(everyone)], cost: tours.cost[everyone] };
}
