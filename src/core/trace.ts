/**
 * The trace is the contract between algorithms and everything that shows them.
 *
 * Algorithms never draw anything: they are generators that yield one event per
 * meaningful step. Each event carries a full snapshot of the tour, so a viewer
 * can jump to any index (step back, scrub, replay) without re-running anything,
 * and the 3D scene, the pseudo-code and the charts all read the same event.
 */

export type Edge = readonly [number, number];

interface Snapshot {
  /** Visiting order so far, always starting at the depot. */
  tour: number[];
  /** True once the thread has come back to the depot. */
  closed: boolean;
  /** Length of the thread as drawn, return leg included when closed. */
  cost: number;
  /** Line of the algorithm's pseudo-code this event corresponds to. */
  line: number;
}

export type TraceEvent =
  | (Snapshot & { kind: 'nn-start' })
  | (Snapshot & { kind: 'nn-consider'; from: number; candidates: number[]; nearest: number })
  | (Snapshot & { kind: 'nn-extend'; from: number; to: number })
  | (Snapshot & { kind: 'nn-close'; from: number })
  | (Snapshot & { kind: '2opt-start' })
  | (Snapshot & { kind: '2opt-examine'; removed: [Edge, Edge]; added: [Edge, Edge]; gain: number })
  | (Snapshot & { kind: '2opt-apply'; removed: [Edge, Edge]; added: [Edge, Edge]; gain: number })
  | (Snapshot & { kind: '2opt-done'; passes: number; moves: number })
  | (Snapshot & Heat & { kind: 'sa-start' })
  | (Snapshot &
      Heat & {
        kind: 'sa-propose';
        removed: [Edge, Edge];
        added: [Edge, Edge];
        /** Change in tour length if the move is made; positive means longer. */
        delta: number;
        /** Chance this move had of being accepted (1 for an improvement). */
        probability: number;
        accepted: boolean;
        /** True when the move produced the shortest tour seen so far. */
        record: boolean;
      })
  | (Snapshot & Heat & { kind: 'sa-done'; proposals: number; accepted: number; uphill: number });

/** Extra state carried by simulated-annealing events. */
interface Heat {
  temperature: number;
  /** Length of the best tour seen so far. */
  best: number;
}

export type Trace = TraceEvent[];

/** Runs an algorithm to completion and returns its trace. */
export function record(run: Iterable<TraceEvent>): Trace {
  return Array.from(run);
}

/** The last event of a finished trace holds the algorithm's result. */
export function result(trace: Trace): { tour: number[]; cost: number } {
  const last = trace[trace.length - 1];
  return { tour: last.tour, cost: last.cost };
}
