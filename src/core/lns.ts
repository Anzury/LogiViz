import type { Route } from './fleet';
import { DEPOT } from './instance';
import { mulberry32 } from './rng';
import { isOnTime, relocateOnTime, type TimedProblem } from './timeWindows';
import type { Edge } from './trace';

/** Pseudo-code shown next to the scene; event `line` values index into it. */
export const LNS_PSEUDOCODE = [
  'répéter :',
  '    retirer une maison tirée au sort et quatre voisines',
  '    reposer chacune à sa meilleure place à l’heure',
  '    retoucher le plan obtenu, comme au chapitre 5',
  '    si le nouveau plan est plus court : le garder',
  '    sinon : revenir au plan précédent',
  'jusqu’à dix essais de suite sans progrès',
];

export interface LnsOptions {
  seed: number;
  /** Houses taken out at each round. */
  remove?: number;
  /** Stop after this many rounds in a row without improvement. */
  patience?: number;
  /** Stop after this many rounds whatever happens. */
  limit?: number;
}

interface Snapshot {
  routes: Route[];
  /** Length of the routes as they stand, houses taken out not counted. */
  cost: number;
  /** Length of the last complete plan that was kept. */
  kept: number;
  /** Which attempt this is, counting from 1; 0 before the first. */
  round: number;
  /** Line of the pseudo-code this event corresponds to. */
  line: number;
}

export type LnsEvent =
  | (Snapshot & { kind: 'lns-start' })
  | (Snapshot & { kind: 'lns-destroy'; center: number; removed: number[] })
  | (Snapshot & {
      kind: 'lns-repair';
      node: number;
      route: number;
      /** True when the house needed a truck of its own. */
      fresh: boolean;
      detour: number;
      added: Edge[];
      /** Houses still waiting to be put back. */
      waiting: number[];
    })
  | (Snapshot & { kind: 'lns-polish'; moves: number; gain: number })
  | (Snapshot & { kind: 'lns-verdict'; accepted: boolean; before: number; after: number })
  | (Snapshot & { kind: 'lns-done'; rounds: number; improvements: number; exhausted: boolean });

const EPS = 1e-9;

function length(problem: TimedProblem, routes: Route[]): number {
  const d = problem.inst.dist;
  let cost = 0;
  for (const { nodes } of routes) {
    if (nodes.length === 0) continue;
    cost += d[DEPOT][nodes[0]] + d[nodes[nodes.length - 1]][DEPOT];
    for (let i = 0; i + 1 < nodes.length; i++) cost += d[nodes[i]][nodes[i + 1]];
  }
  return cost;
}

const copy = (routes: Route[]): Route[] => routes.map((route) => ({ id: route.id, nodes: route.nodes.slice() }));

/**
 * Large neighbourhood search on a plan with time windows. Each round takes a
 * random house and a few of its neighbours out of the plan, puts them back
 * greedily, each at the cheapest place that keeps everyone on time (a truck of
 * its own being one option), then tidies the result with the relocation search.
 * A shorter plan is kept, anything else undone.
 */
export function* largeNeighbourhood(problem: TimedProblem, start: Route[], options: LnsOptions): Generator<LnsEvent> {
  const { seed, remove = 5, patience = 10, limit = 60 } = options;
  const { inst } = problem;
  const d = inst.dist;
  const rng = mulberry32(seed);
  const houses = inst.nodes.map((_, node) => node).slice(1);

  let kept = copy(start).filter((route) => route.nodes.length > 0);
  let keptCost = length(problem, kept);
  let nextId = Math.max(-1, ...kept.map((route) => route.id)) + 1;
  let round = 0;
  let improvements = 0;
  let idle = 0;
  const snap = (routes: Route[], line: number): Snapshot => ({
    routes: copy(routes),
    cost: length(problem, routes),
    kept: keptCost,
    round,
    line,
  });

  yield { kind: 'lns-start', ...snap(kept, 0) };

  while (idle < patience && round < limit) {
    round++;

    // Destroy: a random house, and neighbours drawn with a strong preference for the closest.
    const center = houses[Math.floor(rng() * houses.length)];
    const others = houses.filter((node) => node !== center).sort((a, b) => d[center][a] - d[center][b]);
    const removed = [center];
    while (removed.length < Math.min(remove, houses.length)) {
      removed.push(others.splice(Math.floor(rng() ** 3 * others.length), 1)[0]);
    }
    let trial = copy(kept)
      .map((route) => ({ id: route.id, nodes: route.nodes.filter((node) => !removed.includes(node)) }))
      .filter((route) => route.nodes.length > 0);
    yield { kind: 'lns-destroy', center, removed: removed.slice(), ...snap(trial, 1) };

    // Repair: always the cheapest feasible insertion among all houses still out.
    const waiting = removed.slice();
    while (waiting.length > 0) {
      let best = { node: waiting[0], route: null as Route | null, slot: 0, detour: Infinity };
      for (const node of waiting) {
        const alone = d[DEPOT][node] + d[node][DEPOT];
        if (alone < best.detour) best = { node, route: null, slot: 0, detour: alone };
        for (const route of trial) {
          for (let slot = 0; slot <= route.nodes.length; slot++) {
            const before = slot > 0 ? route.nodes[slot - 1] : DEPOT;
            const after = slot < route.nodes.length ? route.nodes[slot] : DEPOT;
            const detour = d[before][node] + d[node][after] - d[before][after];
            if (detour >= best.detour) continue;
            if (!isOnTime(problem, [...route.nodes.slice(0, slot), node, ...route.nodes.slice(slot)])) continue;
            best = { node, route, slot, detour };
          }
        }
      }
      const fresh = best.route === null;
      const target = best.route ?? { id: nextId++, nodes: [] };
      if (fresh) trial = [...trial, target];
      const before = best.slot > 0 ? target.nodes[best.slot - 1] : DEPOT;
      const after = best.slot < target.nodes.length ? target.nodes[best.slot] : DEPOT;
      target.nodes.splice(best.slot, 0, best.node);
      waiting.splice(waiting.indexOf(best.node), 1);
      yield {
        kind: 'lns-repair',
        node: best.node,
        route: target.id,
        fresh,
        detour: best.detour,
        added: [[before, best.node], [best.node, after]],
        waiting: waiting.slice(),
        ...snap(trial, 2),
      };
    }

    // Polish: the kept plan had been retouched, so the rebuilt one deserves the same before comparing.
    const rebuilt = length(problem, trial);
    let moves = 0;
    for (const ev of relocateOnTime(problem, trial)) {
      trial = ev.routes;
      if (ev.kind === 'move-done') moves = ev.moves;
    }
    if (moves > 0) yield { kind: 'lns-polish', moves, gain: rebuilt - length(problem, trial), ...snap(trial, 3) };

    const before = keptCost;
    const after = length(problem, trial);
    const accepted = after < before - EPS;
    if (accepted) {
      kept = trial;
      keptCost = after;
      improvements++;
      idle = 0;
    } else {
      idle++;
    }
    yield { kind: 'lns-verdict', accepted, before, after, ...snap(kept, accepted ? 4 : 5) };
  }

  yield { kind: 'lns-done', rounds: round, improvements, exhausted: idle >= patience, ...snap(kept, 6) };
}
