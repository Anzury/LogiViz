import { routeCost } from '../core/fleet';
import { DEPOT } from '../core/instance';
import { schedule, type TimedProblem } from '../core/timeWindows';
import type { Maquette } from '../scene/maquette';
import type { Span } from '../scene/timeline';
import { hour, minutes } from './format';
import { COLOR, type TruckRow } from './ui';

/** A round ready to be drawn: which truck it is, and whether it has driven back yet. */
export interface Painted {
  nodes: number[];
  color: string;
  name: string;
  closed: boolean;
}

export const truckName = (index: number) => `Camion ${index + 1}`;

/**
 * Draws rounds as paths through space and time: slanted while driving,
 * vertical during a delivery, pale while waiting for a window to open, and a
 * dark stretch above the window when a delivery comes too late. The same rounds
 * are traced flat on the board underneath.
 */
export function showTimedPlan(scene: Maquette, problem: TimedProblem, painted: Painted[], current: number | null): void {
  const paths: { color: string; spans: Span[] }[] = [];
  const waits: Span[] = [];
  const late: Span[] = [];
  const beads: { node: number; time: number; color: string; big?: boolean }[] = [];
  const pins: (string | null)[] = problem.inst.nodes.map(() => null);

  for (const route of painted) {
    const plan = schedule(problem, route.nodes);
    const spans: Span[] = [];
    let from = { node: DEPOT, time: problem.open[DEPOT] };
    for (const stop of plan.stops) {
      spans.push([from, { node: stop.node, time: stop.arrive }]);
      spans.push([{ node: stop.node, time: stop.start }, { node: stop.node, time: stop.leave }]);
      if (stop.wait > 0) waits.push([{ node: stop.node, time: stop.arrive }, { node: stop.node, time: stop.start }]);
      if (stop.late > 0) late.push([{ node: stop.node, time: problem.close[stop.node] }, { node: stop.node, time: stop.arrive }]);
      beads.push({ node: stop.node, time: stop.start, color: stop.late > 0 ? COLOR.ink : route.color, big: stop.late > 0 });
      pins[stop.node] = route.color;
      from = { node: stop.node, time: stop.leave };
    }
    if (route.closed && route.nodes.length > 0) spans.push([from, { node: DEPOT, time: plan.back }]);
    paths.push({ color: route.color, spans });
  }

  scene.setThread(null);
  scene.setTracks(painted);
  scene.paintPins(pins, current);
  scene.timeline.setPaths(paths);
  scene.timeline.setWaits(waits);
  scene.timeline.setLate(late);
  scene.timeline.setBeads(beads);
}

/** Rows for the truck list: when each truck is back, how long it waited, how far it drove. */
export function timedRows(problem: TimedProblem, painted: Painted[]): TruckRow[] {
  return painted
    .filter((route) => route.nodes.length > 0)
    .map((route) => {
      const plan = schedule(problem, route.nodes);
      const waited = plan.stops.reduce((sum, stop) => sum + stop.wait, 0);
      const back = route.closed ? `retour ${hour(plan.back)}` : `en route, ${hour(plan.stops[plan.stops.length - 1].leave)}`;
      return {
        name: route.name,
        color: route.color,
        cost: routeCost(problem.inst, route.nodes, !route.closed),
        detail: waited >= 1 ? `${back}, ${minutes(waited)} d’attente` : back,
      };
    });
}
