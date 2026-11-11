import { subsetTours } from './heldKarp';
import { DEPOT, type Instance } from './instance';
import { mulberry32 } from './rng';
import type { Edge } from './trace';

/**
 * The routing problem with several trucks (CVRP): every house orders some
 * parcels, a truck carries at most `capacity` of them, and the number of trucks
 * is free. The goal is the shortest total distance.
 */
export interface FleetProblem {
  inst: Instance;
  /** Parcels ordered by each node; 0 for the depot. */
  demand: number[];
  capacity: number;
}

export function withDemands(inst: Instance, seed: number, capacity = 10): FleetProblem {
  const rng = mulberry32(Math.imul(seed, 0x9e3779b1) >>> 0);
  const demand = inst.nodes.map((_, node) => (node === DEPOT ? 0 : 1 + Math.floor(rng() * 4)));
  return { inst, demand, capacity };
}

export interface Route {
  /** Stable across the events of a trace, so a truck keeps its colour. */
  id: number;
  /** Houses in visiting order; the depot at both ends is implied. */
  nodes: number[];
}

export function routeLoad(problem: FleetProblem, nodes: number[]): number {
  return nodes.reduce((sum, node) => sum + problem.demand[node], 0);
}

/** Length of depot → nodes → depot; `open` leaves out the leg back to the depot. */
export function routeCost(inst: Instance, nodes: number[], open = false): number {
  if (nodes.length === 0) return 0;
  let cost = inst.dist[DEPOT][nodes[0]];
  for (let i = 0; i + 1 < nodes.length; i++) cost += inst.dist[nodes[i]][nodes[i + 1]];
  return open ? cost : cost + inst.dist[nodes[nodes.length - 1]][DEPOT];
}

export function planCost(inst: Instance, routes: number[][]): number {
  return routes.reduce((sum, nodes) => sum + routeCost(inst, nodes), 0);
}

/** Every house delivered exactly once, and no truck over capacity. */
export function isFeasiblePlan(problem: FleetProblem, routes: number[][]): boolean {
  const seen = routes.flat();
  const houses = problem.inst.nodes.length - 1;
  if (seen.length !== houses || new Set(seen).size !== houses || seen.includes(DEPOT)) return false;
  return routes.every((nodes) => routeLoad(problem, nodes) <= problem.capacity);
}

interface Snapshot {
  routes: Route[];
  /** Id of the route still being built, whose truck has not driven back yet. */
  open: number | null;
  /** Total distance; an open route counts without its leg back to the depot. */
  cost: number;
  /** Line of the algorithm's pseudo-code this event corresponds to. */
  line: number;
}

export type FleetEvent =
  | (Snapshot & { kind: 'cut-start' })
  | (Snapshot & { kind: 'cut-load'; node: number; load: number })
  | (Snapshot & { kind: 'cut-full'; node: number; load: number })
  | (Snapshot & { kind: 'cut-done' })
  | (Snapshot & { kind: 'cw-start' })
  | (Snapshot & {
      kind: 'cw-consider';
      i: number;
      j: number;
      saving: number;
      /** Why the pair is merged or passed over. */
      verdict: 'merge' | 'same-route' | 'interior' | 'overload';
      /** Parcels one truck would carry if the two routes were merged. */
      load: number;
    })
  | (Snapshot & { kind: 'cw-merge'; i: number; j: number; saving: number })
  | (Snapshot & { kind: 'cw-done'; merges: number })
  | (Snapshot & { kind: 'move-start' })
  | (Snapshot & { kind: 'move-pick'; node: number; from: number; to: number; gain: number; removed: Edge[]; added: Edge[] })
  | (Snapshot & { kind: 'move-apply'; node: number; from: number; to: number; gain: number; removed: Edge[]; added: Edge[] })
  | (Snapshot & { kind: 'move-done'; moves: number });

const EPS = 1e-9;

function snapshot(inst: Instance, routes: Route[], open: number | null, line: number): Snapshot {
  const cost = routes.reduce((sum, route) => sum + routeCost(inst, route.nodes, route.id === open), 0);
  return { routes: routes.map((route) => ({ id: route.id, nodes: route.nodes.slice() })), open, cost, line };
}

// ------------------------------------------------------------ cutting

export const CUT_PSEUDOCODE = [
  'suivre la grande tournée, maison après maison :',
  '    si ses colis tiennent encore dans le camion :',
  '        la livrer',
  '    sinon :',
  '        rentrer au dépôt, repartir avec un camion vide',
];

/**
 * Route first, cluster second: follow one big tour and send the truck home
 * whenever the next house no longer fits.
 */
export function* cutTour(problem: FleetProblem, giant: number[]): Generator<FleetEvent> {
  const { inst, demand, capacity } = problem;
  const routes: Route[] = [{ id: 0, nodes: [] }];
  let load = 0;

  yield { kind: 'cut-start', ...snapshot(inst, routes, 0, 0) };
  for (const node of giant) {
    if (node === DEPOT) continue;
    if (load + demand[node] > capacity) {
      yield { kind: 'cut-full', node, load, ...snapshot(inst, routes, null, 4) };
      routes.push({ id: routes.length, nodes: [] });
      load = 0;
    }
    const current = routes[routes.length - 1];
    current.nodes.push(node);
    load += demand[node];
    yield { kind: 'cut-load', node, load, ...snapshot(inst, routes, current.id, 2) };
  }
  yield { kind: 'cut-done', ...snapshot(inst, routes, null, 0) };
}

// ------------------------------------------------------------ savings

export const SAVINGS_PSEUDOCODE = [
  'un camion par maison',
  'classer les paires de maisons par économie décroissante',
  'pour chaque paire (i, j) :',
  '    si i et j sont au bout de deux tournées différentes',
  '    et si un seul camion peut porter les deux chargements :',
  '        fusionner les deux tournées par le fil i–j',
];

/**
 * Clarke and Wright's savings heuristic, parallel version. Start with one truck
 * per house; linking houses i and j saves d(0,i) + d(0,j) − d(i,j). Take the
 * pairs from the largest saving down and merge whenever it is allowed.
 */
export function* savings(problem: FleetProblem): Generator<FleetEvent> {
  const { inst, capacity } = problem;
  const d = inst.dist;
  let routes: Route[] = inst.nodes.slice(1).map((_, k) => ({ id: k, nodes: [k + 1] }));

  const pairs: { i: number; j: number; saving: number }[] = [];
  for (let i = 1; i < inst.nodes.length; i++) {
    for (let j = i + 1; j < inst.nodes.length; j++) {
      pairs.push({ i, j, saving: d[DEPOT][i] + d[DEPOT][j] - d[i][j] });
    }
  }
  pairs.sort((a, b) => b.saving - a.saving || a.i - b.i || a.j - b.j);

  const atEnd = (route: Route, node: number) => route.nodes[0] === node || route.nodes[route.nodes.length - 1] === node;
  const mergeable = () =>
    routes.some((a) => routes.some((b) => a !== b && routeLoad(problem, a.nodes) + routeLoad(problem, b.nodes) <= capacity));

  yield { kind: 'cw-start', ...snapshot(inst, routes, null, 0) };

  let merges = 0;
  for (const { i, j, saving } of pairs) {
    // Once no two trucks fit in one, every remaining pair would be refused.
    if (saving <= EPS || !mergeable()) break;
    const a = routes.find((route) => route.nodes.includes(i))!;
    const b = routes.find((route) => route.nodes.includes(j))!;
    const load = a === b ? routeLoad(problem, a.nodes) : routeLoad(problem, a.nodes) + routeLoad(problem, b.nodes);
    const verdict =
      a === b ? 'same-route' : !atEnd(a, i) || !atEnd(b, j) ? 'interior' : load > capacity ? 'overload' : 'merge';
    const line = verdict === 'merge' ? 5 : verdict === 'overload' ? 4 : 3;
    yield { kind: 'cw-consider', i, j, saving, verdict, load, ...snapshot(inst, routes, null, line) };
    if (verdict !== 'merge') continue;

    // Turn the two routes so that one ends at i and the other starts at j.
    const head = a.nodes[a.nodes.length - 1] === i ? a.nodes : a.nodes.slice().reverse();
    const tail = b.nodes[0] === j ? b.nodes : b.nodes.slice().reverse();
    // The larger route keeps its identity, hence its colour.
    const keep = a.nodes.length > b.nodes.length || (a.nodes.length === b.nodes.length && a.id < b.id) ? a : b;
    const merged: Route = { id: keep.id, nodes: [...head, ...tail] };
    routes = routes.filter((route) => route !== (keep === a ? b : a)).map((route) => (route === keep ? merged : route));
    merges++;
    yield { kind: 'cw-merge', i, j, saving, ...snapshot(inst, routes, null, 5) };
  }

  yield { kind: 'cw-done', merges, ...snapshot(inst, routes, null, 2) };
}

// ----------------------------------------------------------- relocate

export const RELOCATE_PSEUDOCODE = [
  'répéter :',
  '    pour chaque maison, chercher sa meilleure autre place',
  '        (dans sa tournée, ou chez un camion qui a de la place)',
  '    appliquer le déplacement qui fait gagner le plus',
  'jusqu’à ce qu’aucun déplacement ne fasse gagner',
];

/**
 * Local search with the relocate move: take one house out of its route and put
 * it back wherever that shortens the plan most, in the same route or in another
 * truck with room for it. Best improvement, until nothing improves.
 */
export function relocate(problem: FleetProblem, start: Route[]): Generator<MoveEvent> {
  return relocateWhere(problem.inst, start, (nodes) => routeLoad(problem, nodes) <= problem.capacity);
}

/** The events of a relocation search, whatever rule decides which routes are allowed. */
export type MoveEvent = Extract<FleetEvent, { kind: 'move-start' | 'move-pick' | 'move-apply' | 'move-done' }>;

/**
 * Relocation search under any constraint: `allows` is asked whether a route may
 * exist once a house has been put into it (capacity here, time windows in the
 * next chapter). Taking a house out of a route is assumed to keep it allowed.
 */
export function* relocateWhere(
  inst: Instance,
  start: Route[],
  allows: (nodes: number[]) => boolean,
): Generator<MoveEvent> {
  const d = inst.dist;
  let routes: Route[] = start.map((route) => ({ id: route.id, nodes: route.nodes.slice() }));
  let moves = 0;

  yield { kind: 'move-start', ...snapshot(inst, routes, null, 0) };

  for (;;) {
    let best: { node: number; from: Route; to: Route; slot: number; gain: number; removed: Edge[]; added: Edge[] } | null = null;
    for (const from of routes) {
      for (let p = 0; p < from.nodes.length; p++) {
        const node = from.nodes[p];
        const before = p > 0 ? from.nodes[p - 1] : DEPOT;
        const after = p + 1 < from.nodes.length ? from.nodes[p + 1] : DEPOT;
        const freed = d[before][node] + d[node][after] - d[before][after];
        for (const to of routes) {
          const host = to === from ? from.nodes.filter((other) => other !== node) : to.nodes;
          for (let slot = 0; slot <= host.length; slot++) {
            const left = slot > 0 ? host[slot - 1] : DEPOT;
            const right = slot < host.length ? host[slot] : DEPOT;
            if (to === from && left === before && right === after) continue; // back where it was
            const gain = freed - (d[left][node] + d[node][right] - d[left][right]);
            // The cheap test first: only a move that would be the new best is checked against the rule.
            if (gain <= EPS || (best && gain <= best.gain)) continue;
            if (!allows([...host.slice(0, slot), node, ...host.slice(slot)])) continue;
            const removed: Edge[] = [[before, node], [node, after], [left, right]];
            const added: Edge[] = [[before, after], [left, node], [node, right]];
            best = { node, from, to, slot, gain, removed, added };
          }
        }
      }
    }
    if (!best) break;

    const { node, from, to, slot, gain, removed, added } = best;
    const details = { node, from: from.id, to: to.id, gain, removed, added };
    yield { kind: 'move-pick', ...details, ...snapshot(inst, routes, null, 1) };

    from.nodes = from.nodes.filter((other) => other !== node);
    to.nodes.splice(slot, 0, node);
    routes = routes.filter((route) => route.nodes.length > 0);
    moves++;
    yield { kind: 'move-apply', ...details, ...snapshot(inst, routes, null, 3) };
  }

  yield { kind: 'move-done', moves, ...snapshot(inst, routes, null, 4) };
}

// -------------------------------------------------------------- exact

/**
 * Exact optimum by dynamic programming: the best tour for every group of
 * houses (Held-Karp), then the best way to split the houses into groups that
 * each fit in a truck. About 3^n steps, so small teaching instances only.
 */
export function bestFleet(problem: FleetProblem): { routes: number[][]; cost: number } {
  const tours = subsetTours(problem.inst);
  const full = 1 << tours.size;

  // A group of houses is worth its best tour, or nothing if no truck can carry it.
  const load = new Int32Array(full);
  const cost = new Float64Array(full);
  for (let mask = 1; mask < full; mask++) {
    const lowest = mask & -mask;
    load[mask] = load[mask ^ lowest] + problem.demand[32 - Math.clz32(lowest)];
    cost[mask] = load[mask] > problem.capacity ? Infinity : tours.cost[mask];
  }
  return splitIntoRoutes(tours.size, cost, tours.order);
}

/**
 * The cheapest way to share `size` houses out between trucks, given the cost of
 * the best tour for every group of houses (bit masks; Infinity for a group no
 * single truck may serve) and a way to read that tour back.
 */
export function splitIntoRoutes(
  size: number,
  groupCost: Float64Array,
  order: (mask: number) => number[],
): { routes: number[][]; cost: number } {
  const full = 1 << size;
  // best[mask]: cheapest plan serving exactly the houses of `mask`.
  const best = new Float64Array(full).fill(Infinity);
  const group = new Int32Array(full);
  best[0] = 0;
  for (let mask = 1; mask < full; mask++) {
    const lowest = mask & -mask;
    // The route serving the lowest-numbered house: try every group containing it.
    for (let sub = mask; sub > 0; sub = (sub - 1) & mask) {
      if (!(sub & lowest)) continue;
      const value = groupCost[sub] + best[mask ^ sub];
      if (value < best[mask]) {
        best[mask] = value;
        group[mask] = sub;
      }
    }
  }

  const routes: number[][] = [];
  if (best[full - 1] === Infinity) return { routes, cost: Infinity };
  for (let mask = full - 1; mask > 0; mask ^= group[mask]) routes.push(order(group[mask]));
  return { routes, cost: best[full - 1] };
}
