import type { Edge, TraceEvent } from '../core/trace';
import { km } from './format';
import type { Host, TourStage } from './module';
import { all } from './ui';

/** Drawing shared by the single-truck chapters. */

export function clearOverlays(scene: TourStage): void {
  scene.setGhosts([]);
  scene.setAccent([]);
  scene.setMarked([]);
}

/** A finished tour: its thread, its pins, and the truck driving round it. */
export function showTour(host: Host<TourStage>, tour: number[], color: string, label: string, cost: number): void {
  host.scene.setThread({ tour, closed: true, color });
  host.scene.setPins(tour, color);
  host.scene.setTruck(tour);
  host.hud(label, km(cost));
}

/** Translates one trace event into threads, pins, pseudo-code line and readout. */
export function showTraceEvent(host: Host<TourStage>, ev: TraceEvent, algo: 'nn' | 'twoopt', color: string, forward: boolean): void {
  const { scene } = host;
  clearOverlays(scene);
  const grow = forward && (ev.kind === 'nn-extend' || ev.kind === 'nn-close');
  scene.setThread({ tour: ev.tour, closed: ev.closed, color, growLast: grow });
  scene.setPins(ev.tour, color, ev.closed ? null : ev.tour[ev.tour.length - 1]);

  switch (ev.kind) {
    case 'nn-consider':
      scene.setGhosts(ev.candidates.filter((c) => c !== ev.nearest).map((c): Edge => [ev.from, c]));
      scene.setAccent([[ev.from, ev.nearest]]);
      break;
    case '2opt-examine':
      scene.setMarked(ev.removed);
      scene.setGhosts(ev.added);
      break;
    case '2opt-apply':
      scene.setAccent(ev.added);
      break;
  }

  const finished = ev.kind === 'nn-close' || ev.kind === '2opt-done';
  scene.setTruck(finished ? ev.tour : null);
  host.hud(algo === 'nn' ? 'Plus proche voisin' : '2-opt', km(ev.cost));
  all(`[data-code="${algo}"] li`).forEach((line, i) => line.classList.toggle('is-current', i === ev.line));
}
