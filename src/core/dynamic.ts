import { heldKarp, subsetTours } from './heldKarp';
import { DEPOT, UNITS_PER_KM, type Instance } from './instance';
import { mulberry32 } from './rng';

/** Pseudo-code shown next to the scene; event `line` values index into it. */
export const DYNAMIC_PSEUDOCODE = [
  'partir avec la meilleure tournée pour les commandes connues',
  'à chaque arrêt :',
  '    regarder les commandes arrivées entre-temps',
  '    insérer chacune là où elle rallonge le moins le reste de la tournée',
  '    repartir vers l’arrêt suivant',
  'rentrer au dépôt quand il ne reste rien',
];

export interface DynamicOptions {
  seed: number;
  /** Houses whose order is known before the truck leaves. */
  known?: number;
  /** Driving speed, and minutes spent at each house. */
  speedKmh?: number;
  service?: number;
}

interface Snapshot {
  /** Houses delivered so far, in order. */
  served: number[];
  /** Houses still to deliver, in the order currently planned. */
  plan: number[];
  /** Where the truck is. */
  at: number;
  /** Minutes since the truck left the depot. */
  clock: number;
  /** Distance driven so far. */
  driven: number;
  /** Line of the pseudo-code this event corresponds to. */
  line: number;
}

export type DynamicEvent =
  | (Snapshot & { kind: 'dyn-start'; late: { node: number; release: number }[] })
  | (Snapshot & {
      kind: 'dyn-order';
      node: number;
      /** Minute at which the order came in. */
      release: number;
      /** The two stops the house was slipped between; the first may be where the truck stands. */
      between: [number, number];
      detour: number;
    })
  | (Snapshot & { kind: 'dyn-drive'; from: number; to: number })
  | (Snapshot & { kind: 'dyn-wait'; until: number })
  | (Snapshot & { kind: 'dyn-done' });

/**
 * A morning where some orders are only known once the truck is on the road.
 * The driver starts on the best tour for what is known, and at every stop
 * slips the orders that have come in since into the rest of the tour, each
 * where it costs least. `inst` gives the distances to use (by road, typically).
 */
export function* dynamicDay(inst: Instance, options: DynamicOptions): Generator<DynamicEvent> {
  const { seed, known = 7, speedKmh = 20, service = 10 } = options;
  const d = inst.dist;
  const pace = 60 / speedKmh / UNITS_PER_KM;
  const rng = mulberry32(Math.imul(seed, 0x2c1b3c6d) >>> 0);

  const houses = inst.nodes.map((_, node) => node).slice(1);
  for (let i = houses.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [houses[i], houses[j]] = [houses[j], houses[i]];
  }
  const early = houses.slice(0, known);
  // The rest come in while the truck is out: spread over the first three quarters of a well-informed morning.
  const morning = heldKarp(inst).cost * pace + houses.length * service;
  const late = houses
    .slice(known)
    .map((node) => ({ node, release: Math.round(10 + rng() * (0.75 * morning - 10)) }))
    .sort((a, b) => a.release - b.release);

  const mask = early.reduce((bits, node) => bits | (1 << (node - 1)), 0);
  const plan = subsetTours(inst).order(mask);
  const served: number[] = [];
  const pending = late.slice();
  let at = DEPOT;
  let clock = 0;
  let driven = 0;
  const snap = (line: number): Snapshot => ({ served: served.slice(), plan: plan.slice(), at, clock, driven, line });

  yield { kind: 'dyn-start', late: late.slice(), ...snap(0) };

  for (;;) {
    while (pending.length > 0 && pending[0].release <= clock) {
      const { node, release } = pending.shift()!;
      let best = { slot: 0, detour: Infinity };
      for (let slot = 0; slot <= plan.length; slot++) {
        const before = slot > 0 ? plan[slot - 1] : at;
        const after = slot < plan.length ? plan[slot] : DEPOT;
        const detour = d[before][node] + d[node][after] - d[before][after];
        if (detour < best.detour) best = { slot, detour };
      }
      const between: [number, number] = [best.slot > 0 ? plan[best.slot - 1] : at, best.slot < plan.length ? plan[best.slot] : DEPOT];
      plan.splice(best.slot, 0, node);
      yield { kind: 'dyn-order', node, release, between, detour: best.detour, ...snap(3) };
    }

    if (plan.length === 0) {
      if (at !== DEPOT) {
        const from = at;
        driven += d[at][DEPOT];
        clock += d[at][DEPOT] * pace;
        at = DEPOT;
        yield { kind: 'dyn-drive', from, to: DEPOT, ...snap(5) };
        continue;
      }
      if (pending.length === 0) break;
      // Home with nothing to do: wait for the next order to come in.
      clock = pending[0].release;
      yield { kind: 'dyn-wait', until: clock, ...snap(2) };
      continue;
    }

    const from = at;
    const to = plan.shift()!;
    driven += d[from][to];
    clock += d[from][to] * pace + service;
    at = to;
    served.push(to);
    yield { kind: 'dyn-drive', from, to, ...snap(4) };
  }

  yield { kind: 'dyn-done', ...snap(5) };
}
