import { relocateWhere, splitIntoRoutes, type MoveEvent, type Route } from './fleet';
import { DEPOT, UNITS_PER_KM, type Instance } from './instance';
import { mulberry32 } from './rng';
import type { Edge } from './trace';
import { twoOpt } from './twoOpt';

/**
 * Routing with time windows (VRPTW, without capacity): every house can only be
 * served between its opening and closing time. Trucks leave the depot when the
 * day starts; one that arrives early waits, one that arrives after closing has
 * failed. The goal is the shortest total distance with everyone served on time.
 */
export interface TimedProblem {
  inst: Instance;
  /** Start of each node's window, in minutes after midnight; node 0 is the depot's day. */
  open: number[];
  /** End of each node's window: service must start by then. */
  close: number[];
  /** Minutes needed to drive one board unit. */
  pace: number;
  /** Minutes spent at each house. */
  service: number;
}

export const DAY_START = 8 * 60;
export const DAY_END = 12 * 60;
export const SPEED_KMH = 20;
export const SERVICE_MINUTES = 10;

export function travel(problem: TimedProblem, from: number, to: number): number {
  return problem.inst.dist[from][to] * problem.pace;
}

export interface Stop {
  node: number;
  arrive: number;
  /** When service begins: on arrival, or when the window opens if the truck is early. */
  start: number;
  leave: number;
  /** Minutes spent waiting for the window to open. */
  wait: number;
  /** Minutes after the window closed; 0 when on time. */
  late: number;
}

/** Follows one truck through its houses, clock in hand. */
export function schedule(problem: TimedProblem, nodes: number[]): { stops: Stop[]; back: number; late: number } {
  const stops: Stop[] = [];
  let clock = problem.open[DEPOT];
  let from = DEPOT;
  let late = 0;
  for (const node of nodes) {
    const arrive = clock + travel(problem, from, node);
    const start = Math.max(arrive, problem.open[node]);
    const stop: Stop = {
      node,
      arrive,
      start,
      leave: start + problem.service,
      wait: start - arrive,
      late: Math.max(0, arrive - problem.close[node]),
    };
    if (stop.late > 0) late++;
    stops.push(stop);
    clock = stop.leave;
    from = node;
  }
  return { stops, back: clock + travel(problem, from, DEPOT), late };
}

export const isOnTime = (problem: TimedProblem, nodes: number[]) => schedule(problem, nodes).late === 0;

/**
 * Draws time windows for a town. Two hidden rounds are driven first and each
 * window is placed around the moment its house was reached, so a plan that
 * serves everyone on time always exists; a quarter of the houses are free all
 * morning. Windows are rounded to ten minutes.
 */
export function withWindows(inst: Instance, seed: number): TimedProblem {
  const rng = mulberry32(Math.imul(seed, 0x27d4eb2f) >>> 0);
  const pace = 60 / SPEED_KMH / UNITS_PER_KM;
  const problem: TimedProblem = {
    inst,
    open: inst.nodes.map(() => DAY_START),
    close: inst.nodes.map(() => DAY_END),
    pace,
    service: SERVICE_MINUTES,
  };

  // Split the houses in two by direction from the depot, like two delivery sectors.
  const depot = inst.nodes[DEPOT];
  const turn = rng() * Math.PI * 2;
  const bearing = (node: number) => {
    const angle = Math.atan2(inst.nodes[node].y - depot.y, inst.nodes[node].x - depot.x) - turn;
    return ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  };
  const houses = inst.nodes.map((_, node) => node).slice(1).sort((a, b) => bearing(a) - bearing(b));
  const half = Math.ceil(houses.length / 2);

  for (const sector of [houses.slice(0, half), houses.slice(half)]) {
    if (sector.length === 0) continue;
    let round = [DEPOT, ...sector];
    for (const ev of twoOpt(inst, round)) round = ev.tour;
    const order = rng() < 0.5 ? round.slice(1) : round.slice(1).reverse();

    for (const stop of schedule(problem, order).stops) {
      if (rng() < 0.25) continue; // free all morning
      const width = 40 + Math.floor(rng() * 9) * 10;
      const lead = rng() * (width - 15);
      const open = Math.max(DAY_START, Math.floor((stop.arrive - lead) / 10) * 10);
      const close = Math.max(open + width, Math.ceil((stop.arrive + 5) / 10) * 10);
      problem.open[stop.node] = open;
      problem.close[stop.node] = Math.min(Math.ceil(close / 10) * 10, DAY_END);
    }
  }
  return problem;
}

interface Snapshot {
  routes: Route[];
  /** Id of a route whose truck is still out, if any. */
  open: number | null;
  /** Total distance; an open route counts without its leg back to the depot. */
  cost: number;
  /** Line of the algorithm's pseudo-code this event corresponds to. */
  line: number;
}

export type TimedEvent =
  | (Snapshot & { kind: 'clock-start' })
  | (Snapshot & { kind: 'clock-visit'; stop: Stop })
  | (Snapshot & { kind: 'clock-done'; late: number; back: number })
  | (Snapshot & { kind: 'ins-start' })
  | (Snapshot & {
      kind: 'ins-consider';
      node: number;
      /** Places where the house could go without making anyone late. */
      fits: number;
      /** Places refused because someone would be late. */
      refused: number;
      /** Route chosen, or null when a new truck is cheaper or the only way. */
      route: number | null;
      detour: number;
    })
  | (Snapshot & { kind: 'ins-place'; node: number; route: number; fresh: boolean; detour: number; added: Edge[] })
  | (Snapshot & { kind: 'ins-done' })
  | MoveEvent;

function snapshot(inst: Instance, routes: Route[], open: number | null, line: number): Snapshot {
  let cost = 0;
  for (const route of routes) {
    let from = DEPOT;
    for (const node of route.nodes) {
      cost += inst.dist[from][node];
      from = node;
    }
    if (route.id !== open && route.nodes.length > 0) cost += inst.dist[from][DEPOT];
  }
  return { routes: routes.map((route) => ({ id: route.id, nodes: route.nodes.slice() })), open, cost, line };
}

/** One truck driving a given tour while we watch the clock: who is served on time, who is not. */
export function* followClock(problem: TimedProblem, tour: number[]): Generator<TimedEvent> {
  const nodes = tour.filter((node) => node !== DEPOT);
  const plan = schedule(problem, nodes);
  const route: Route = { id: 0, nodes: [] };
  yield { kind: 'clock-start', ...snapshot(problem.inst, [route], 0, 0) };
  for (const stop of plan.stops) {
    route.nodes.push(stop.node);
    yield { kind: 'clock-visit', stop, ...snapshot(problem.inst, [route], 0, 0) };
  }
  yield { kind: 'clock-done', late: plan.late, back: plan.back, ...snapshot(problem.inst, [route], null, 0) };
}

export const INSERTION_PSEUDOCODE = [
  'classer les maisons de la plus pressée à la moins pressée',
  'pour chaque maison :',
  '    essayer chaque place dans chaque tournée',
  '    écarter celles qui mettraient quelqu’un en retard',
  '    prendre la moins coûteuse, ou sortir un nouveau camion',
];

/**
 * Insertion heuristic with time windows. Houses are taken from the most urgent
 * (earliest closing) to the least; each goes where it lengthens the plan least
 * without making anyone late, a new truck being one of the options.
 */
export function* insertion(problem: TimedProblem): Generator<TimedEvent> {
  const { inst } = problem;
  const d = inst.dist;
  const routes: Route[] = [];
  const urgent = inst.nodes
    .map((_, node) => node)
    .slice(1)
    .sort((a, b) => problem.close[a] - problem.close[b] || problem.open[a] - problem.open[b] || a - b);

  yield { kind: 'ins-start', ...snapshot(inst, routes, null, 0) };

  for (const node of urgent) {
    // A truck of its own is always possible: there and back.
    let best = { route: null as Route | null, slot: 0, detour: d[DEPOT][node] + d[node][DEPOT] };
    let fits = 0;
    let refused = 0;
    for (const route of routes) {
      for (let slot = 0; slot <= route.nodes.length; slot++) {
        const trial = [...route.nodes.slice(0, slot), node, ...route.nodes.slice(slot)];
        if (!isOnTime(problem, trial)) {
          refused++;
          continue;
        }
        fits++;
        const before = slot > 0 ? route.nodes[slot - 1] : DEPOT;
        const after = slot < route.nodes.length ? route.nodes[slot] : DEPOT;
        const detour = d[before][node] + d[node][after] - d[before][after];
        if (detour < best.detour) best = { route, slot, detour };
      }
    }
    yield {
      kind: 'ins-consider',
      node,
      fits,
      refused,
      route: best.route ? best.route.id : null,
      detour: best.detour,
      ...snapshot(inst, routes, null, fits > 0 ? 4 : 3),
    };

    const fresh = best.route === null;
    const target = best.route ?? { id: routes.length, nodes: [] };
    if (fresh) routes.push(target);
    const before = best.slot > 0 ? target.nodes[best.slot - 1] : DEPOT;
    const after = best.slot < target.nodes.length ? target.nodes[best.slot] : DEPOT;
    target.nodes.splice(best.slot, 0, node);
    const added: Edge[] = [[before, node], [node, after]];
    yield { kind: 'ins-place', node, route: target.id, fresh, detour: best.detour, added, ...snapshot(inst, routes, null, 4) };
  }

  yield { kind: 'ins-done', ...snapshot(inst, routes, null, 1) };
}

/** Same line numbering as the capacity version of the search, which emits the events. */
export const RELOCATE_ON_TIME_PSEUDOCODE = [
  'répéter :',
  '    pour chaque maison, chercher sa meilleure autre place',
  '        (en écartant celles qui mettraient quelqu’un en retard)',
  '    appliquer le déplacement qui fait gagner le plus',
  'jusqu’à ce qu’aucun déplacement ne fasse gagner',
];

/** Relocation search (see chapter 4) where a move is only allowed if nobody ends up late. */
export function relocateOnTime(problem: TimedProblem, start: Route[]): Generator<MoveEvent> {
  return relocateWhere(problem.inst, start, (nodes) => isOnTime(problem, nodes));
}

interface Label {
  /** When the truck is free to leave the last house. */
  time: number;
  cost: number;
  /** Previous house (as a customer index) and which of its labels this one extends; -1 from the depot. */
  from: number;
  via: number;
}

/**
 * Exact optimum: the shortest plan in which everyone is served on time. For
 * each group of houses, the shortest on-time tour (dynamic programming over
 * subsets, keeping for each state the options that are not beaten on both time
 * and distance), then the best split of the houses into such groups.
 */
export function bestTimedFleet(problem: TimedProblem): { routes: number[][]; cost: number } {
  const { inst, open, close, service } = problem;
  const d = inst.dist;
  const m = inst.nodes.length - 1;
  if (m > 14) throw new Error(`The exact time-window solver is limited to 14 houses, got ${m}`);
  const full = 1 << m;
  const labels: (Label[] | undefined)[] = new Array(full * m);

  const add = (slot: number, candidate: Label) => {
    const list = (labels[slot] ??= []);
    if (list.some((label) => label.time <= candidate.time && label.cost <= candidate.cost)) return;
    let kept = 0;
    for (const label of list) {
      if (!(candidate.time <= label.time && candidate.cost <= label.cost)) list[kept++] = label;
    }
    list.length = kept;
    list.push(candidate);
  };
  const reach = (time: number, from: number, to: number) => {
    const arrive = time + travel(problem, from, to);
    return arrive > close[to] ? null : Math.max(arrive, open[to]) + service;
  };

  for (let k = 0; k < m; k++) {
    const free = reach(open[DEPOT], DEPOT, k + 1);
    if (free !== null) add((1 << k) * m + k, { time: free, cost: d[DEPOT][k + 1], from: -1, via: -1 });
  }
  for (let mask = 1; mask < full; mask++) {
    for (let last = 0; last < m; last++) {
      const list = labels[mask * m + last];
      if (!list) continue;
      for (let next = 0; next < m; next++) {
        if (mask & (1 << next)) continue;
        list.forEach((label, via) => {
          const free = reach(label.time, last + 1, next + 1);
          if (free === null) return;
          add((mask | (1 << next)) * m + next, { time: free, cost: label.cost + d[last + 1][next + 1], from: last, via });
        });
      }
    }
  }

  // Shortest on-time closed tour for each group, and where it ends.
  const cost = new Float64Array(full).fill(Infinity);
  const end = new Int32Array(full * 2).fill(-1);
  cost[0] = 0;
  for (let mask = 1; mask < full; mask++) {
    for (let last = 0; last < m; last++) {
      labels[mask * m + last]?.forEach((label, index) => {
        const value = label.cost + d[last + 1][DEPOT];
        if (value < cost[mask]) {
          cost[mask] = value;
          end[mask * 2] = last;
          end[mask * 2 + 1] = index;
        }
      });
    }
  }
  const order = (mask: number) => {
    const reversed: number[] = [];
    let last = end[mask * 2];
    let index = end[mask * 2 + 1];
    while (last >= 0) {
      const label = labels[mask * m + last]![index];
      reversed.push(last + 1);
      mask ^= 1 << last;
      last = label.from;
      index = label.via;
    }
    return reversed.reverse();
  };

  return splitIntoRoutes(m, cost, order);
}
