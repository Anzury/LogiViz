import { DEPOT, type Instance } from './instance';
import type { Edge } from './trace';

/**
 * The cheapest network of threads connecting a set of nodes (minimum spanning
 * tree, Prim's algorithm). Any path through all of them is such a network, so
 * its length can never be below this one: a lower bound.
 */
export function spanningTree(inst: Instance, nodes: number[]): { cost: number; edges: Edge[] } {
  const edges: Edge[] = [];
  if (nodes.length < 2) return { cost: 0, edges };
  const d = inst.dist;
  const reach = nodes.map((node) => d[nodes[0]][node]);
  const via = nodes.map(() => 0);
  const linked = nodes.map((_, i) => i === 0);
  let cost = 0;
  for (let added = 1; added < nodes.length; added++) {
    let next = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (!linked[i] && (next < 0 || reach[i] < reach[next])) next = i;
    }
    linked[next] = true;
    cost += reach[next];
    edges.push([nodes[via[next]], nodes[next]]);
    for (let i = 0; i < nodes.length; i++) {
      if (!linked[i] && d[nodes[next]][nodes[i]] < reach[i]) {
        reach[i] = d[nodes[next]][nodes[i]];
        via[i] = next;
      }
    }
  }
  return { cost, edges };
}

/**
 * Lower bound on every tour that starts with `path` (depot first): what is
 * already driven, plus the cheapest network linking the houses still to visit
 * to both the truck's position and the depot.
 */
export function boundOf(inst: Instance, path: number[]): { bound: number; driven: number; tree: Edge[] } {
  let driven = 0;
  for (let i = 0; i + 1 < path.length; i++) driven += inst.dist[path[i]][path[i + 1]];
  const visited = new Set(path);
  const rest = inst.nodes.map((_, node) => node).filter((node) => !visited.has(node));
  const end = path[path.length - 1];
  // With a single node the "network" is just the leg home; Prim handles it like any other set.
  const { cost, edges } = spanningTree(inst, [...new Set([end, ...rest, DEPOT])]);
  return { bound: driven + cost, driven, tree: edges };
}

/** Pseudo-code shown next to the scene; event `line` values index into it. */
export const BRANCH_BOUND_PSEUDOCODE = [
  'meilleure ← la meilleure tournée connue',
  'explorer(début) :',
  '    borne ← trajet déjà fait + plus court réseau reliant le reste',
  '    si borne ≥ longueur de meilleure : abandonner cette famille',
  '    si toutes les maisons sont visitées : meilleure ← cette tournée',
  '    sinon : pour chaque maison restante, explorer(début + cette maison)',
];

interface Snapshot {
  /** Length of the best tour known so far. */
  best: number;
  bestTour: number[];
  /** Families of tours looked at: one bound computed for each. */
  examined: number;
  /** Families abandoned because their bound was no better than the best tour. */
  cut: number;
  /** Visiting orders ruled out without being built, summed over the abandoned families. */
  ruledOut: number;
  /** Line of the pseudo-code this event corresponds to. */
  line: number;
}

export type BranchEvent =
  | (Snapshot & { kind: 'bb-start'; bound: number; tree: Edge[] })
  | (Snapshot & {
      kind: 'bb-node';
      /** How the family's tours begin, depot first. */
      path: number[];
      /** Length of that beginning. */
      driven: number;
      bound: number;
      tree: Edge[];
      /** True when the bound proves the family cannot beat the best tour. */
      pruned: boolean;
    })
  | (Snapshot & {
      kind: 'bb-below';
      path: number[];
      /** Families examined, and abandoned, underneath this one. */
      examinedBelow: number;
      cutBelow: number;
      /** True if a better tour was found somewhere underneath. */
      improved: boolean;
    })
  | (Snapshot & { kind: 'bb-best'; path: number[]; previous: number })
  | (Snapshot & { kind: 'bb-done'; orders: number });

const EPS = 1e-9;

function factorial(n: number): number {
  let product = 1;
  for (let k = 2; k <= n; k++) product *= k;
  return product;
}

/**
 * Depth-first branch and bound for the single-truck problem. Tours are grouped
 * into families by how they begin; a family whose lower bound is no better than
 * the best tour known is abandoned whole. When the search ends, the best tour
 * is proven optimal.
 *
 * The search visits far too many families to narrate each: families fixing up
 * to `detail` houses get an event of their own, and everything underneath one
 * of the deepest of those is reported as a single summary.
 */
export function* branchAndBound(
  inst: Instance,
  start: { tour: number[]; cost: number },
  detail = 2,
): Generator<BranchEvent> {
  const d = inst.dist;
  const houses = inst.nodes.length - 1;
  const state = { best: start.cost, bestTour: start.tour.slice(), examined: 0, cut: 0, ruledOut: 0 };
  const snap = (line: number): Snapshot => ({ ...state, bestTour: state.bestTour.slice(), line });

  const root = boundOf(inst, [DEPOT]);
  yield { kind: 'bb-start', bound: root.bound, tree: root.tree, ...snap(0) };

  function* explore(path: number[], driven: number): Generator<BranchEvent> {
    const depth = path.length - 1;
    const end = path[depth];
    const { bound, tree } = boundOf(inst, path);
    state.examined++;
    const pruned = bound >= state.best - EPS;
    if (pruned) {
      state.cut++;
      state.ruledOut += factorial(houses - depth);
    }
    if (depth <= detail) yield { kind: 'bb-node', path: path.slice(), driven, bound, tree, pruned, ...snap(pruned ? 3 : 2) };
    if (pruned) return;

    if (depth === houses) {
      // Every house is visited and the bound, now the exact length, beats the best tour.
      const previous = state.best;
      state.best = driven + d[end][DEPOT];
      state.bestTour = path.slice();
      yield { kind: 'bb-best', path: path.slice(), previous, ...snap(4) };
      return;
    }

    const before = { examined: state.examined, cut: state.cut, best: state.best };
    // Closest houses first: good tours tend to be found early, which sharpens every later cut.
    const next = inst.nodes
      .map((_, node) => node)
      .filter((node) => !path.includes(node))
      .sort((a, b) => d[end][a] - d[end][b]);
    for (const node of next) {
      path.push(node);
      yield* explore(path, driven + d[end][node]);
      path.pop();
    }
    if (depth === detail) {
      yield {
        kind: 'bb-below',
        path: path.slice(),
        examinedBelow: state.examined - before.examined,
        cutBelow: state.cut - before.cut,
        improved: state.best < before.best - EPS,
        ...snap(5),
      };
    }
  }

  yield* explore([DEPOT], 0);
  yield { kind: 'bb-done', orders: factorial(houses), ...snap(0) };
}
