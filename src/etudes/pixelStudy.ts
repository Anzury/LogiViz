import { typo } from '../chapter/format';
import { DEPOT } from '../core/instance';
import { schedule } from '../core/timeWindows';
import { Bitmap, PAL, depot, gauge, house, ink, parcel, stop, tree, truck } from '../pixel/kit';
import { drawTimedMarks, drawTimetable, rankBadge, type TimedView } from '../pixel/timed';
import { BOARD, SCENE, between, buildTown, centred, closed, compose, sameEdge, strokes, type Spot, type Thing } from '../pixel/town';
import { buildCity, type City } from '../story/city';
import { OPENING } from '../story/opening';
import { timedStudy } from '../story/timedStudy';

/**
 * The pixel-art study: two scenes of the real opening town, redrawn element by
 * element for coarse pixels instead of filtering the 3D model.
 */

/** A truck parked in front of the depot, clear of its stop. */
const parkedTruck = (spots: Spot[]): Thing[] => [{ picture: truck(PAL.route), x: spots[DEPOT].x - 20, foot: spots[DEPOT].y + 5, mirrored: true }];

// ------------------------------------------------------------- scene 1

/** Chapter 2's key moment: the nearest-neighbour tour, the two threads that cross, and what replaces them. */
export function townScene(city: City): Bitmap {
  const town = buildTown(city.inst);
  const { removed, added } = city.showcase;
  const kept = closed(city.nnResult.tour).filter((edge) => !removed.some((gone) => sameEdge(edge, gone)));
  const lines = [
    strokes(town, between(town, kept), PAL.route, PAL.line),
    strokes(town, between(town, added), PAL.paper, PAL.line, { dash: [3, 3] }),
    strokes(town, between(town, removed), PAL.line, PAL.paper),
  ];
  const overlay = new Bitmap(town.width, town.height);
  town.spots.forEach((spot) => centred(overlay, stop(PAL.route), spot));
  // No gauge stands above the houses here: the room kept for them is trimmed.
  return compose(town, { lines, moving: parkedTruck(town.spots), overlay }).withoutTop(20);
}

// ------------------------------------------------------------- scene 2

const PANEL = { x: SCENE.width + 6, y: BOARD.y, w: 132, h: BOARD.height };
const TIME_WIDTH = PANEL.x + PANEL.w + 10;

export interface TimeFacts {
  late: number;
  waiting: number;
  houses: number;
}

/**
 * Chapter 5's hard case: the shortest tour followed with the clock. On the
 * town, each house shows its time window and when the truck gets there; on
 * the board beside it, the same morning reads from left to right.
 */
export function timeScene(city: City): { picture: Bitmap; facts: TimeFacts } {
  const town = buildTown(city.inst, TIME_WIDTH);
  const { problem } = timedStudy(city, OPENING.windows);
  const nodes = city.optimum.tour.filter((node) => node !== DEPOT);
  const plan = schedule(problem, nodes);
  const view: TimedView = {
    day: [problem.open[DEPOT], problem.close[DEPOT] + 60],
    windows: problem.open.map((open, node) => ({ open, close: problem.close[node] })),
    routes: [{ colour: PAL.route, closed: true, stops: plan.stops.map((visit) => ({ node: visit.node, visit })), back: plan.back }],
    current: null,
  };

  const overlay = new Bitmap(town.width, town.height);
  drawTimedMarks(overlay, town, view);
  const lines = [strokes(town, between(town, closed([DEPOT, ...nodes])), PAL.route, PAL.line)];
  const picture = compose(town, { lines, moving: parkedTruck(town.spots), overlay });
  drawTimetable(picture, PANEL, view);
  return {
    picture,
    facts: { late: plan.late, waiting: plan.stops.filter((visit) => visit.wait > 0).length, houses: nodes.length },
  };
}

// ---------------------------------------------------------- vocabulary

/** Every element on its own, to check that each is recognised without the others. */
export function vocabulary(): { label: string; picture: Bitmap }[] {
  const sample = (colour: string, edge: string, dash?: [number, number]) => {
    const core = new Bitmap(24, 9);
    core.line(2, 5, 19, 2, ink(colour), 2, dash);
    return core.outlined(ink(edge));
  };
  const day: [number, number] = [480, 720];
  return [
    { label: 'Maison', picture: house(PAL.roofs[0]) },
    { label: 'Maison', picture: house(PAL.roofs[1], true) },
    { label: 'Maison', picture: house(PAL.roofs[2]) },
    { label: 'Maison', picture: house(PAL.roofs[3], true) },
    { label: 'Dépôt', picture: depot() },
    { label: 'Arbre', picture: tree() },
    { label: 'Sapin', picture: tree(true) },
    { label: 'Camion, de profil', picture: truck(PAL.route) },
    { label: 'Camion, de face', picture: truck(PAL.route, 'towards') },
    { label: 'Camion, de dos', picture: truck(PAL.route, 'away') },
    { label: 'Colis', picture: parcel() },
    { label: 'Arrêt libre', picture: stop(PAL.paper) },
    { label: 'Arrêt desservi', picture: stop(PAL.route) },
    { label: 'Tournée', picture: sample(PAL.route, PAL.line) },
    { label: 'Fil à retirer', picture: sample(PAL.line, PAL.paper) },
    { label: 'Fil de remplacement', picture: sample(PAL.paper, PAL.line, [3, 3]) },
    { label: 'Arrêt du camion 1', picture: rankBadge(4, PAL.trucks[0], false) },
    { label: 'Arrêt du camion 2', picture: rankBadge(7, PAL.trucks[1], false) },
    { label: 'Arrêt du camion 3', picture: rankBadge(2, PAL.trucks[2], false) },
    { label: 'Arrêt du camion 4', picture: rankBadge(10, PAL.trucks[3], false) },
    { label: 'Livré trop tard', picture: rankBadge(12, PAL.trucks[0], true) },
    { label: 'Créneau seul', picture: gauge(day, [540, 630]) },
    { label: 'Arrivée à l’heure', picture: gauge(day, [540, 630], { at: 580, colour: PAL.trucks[0] }) },
    { label: 'Arrivée en avance', picture: gauge(day, [600, 690], { at: 540, colour: PAL.trucks[1] }) },
    { label: 'Arrivée en retard', picture: gauge(day, [510, 570], { at: 640, colour: PAL.trucks[0], late: true }) },
  ];
}

// ---------------------------------------------------------------- page

/**
 * Enlarges the scenes by a whole number of screen pixels, the same for all of
 * them so that a pixel is the same size from one scene to the next: as large
 * as the widest scene allows.
 */
function fit(canvases: HTMLCanvasElement[], most = 4): void {
  const scale = Math.min(most, ...canvases.map((canvas) => Math.floor((canvas.parentElement?.clientWidth ?? canvas.width) / canvas.width)));
  for (const canvas of canvases) {
    canvas.style.width = `${canvas.width * Math.max(scale, 1)}px`;
    canvas.style.height = `${canvas.height * Math.max(scale, 1)}px`;
  }
}

export function mountStudy(): void {
  const city = buildCity(OPENING.city)!;
  const scenes: [string, Bitmap][] = [];
  scenes.push(['town', townScene(city)]);
  const time = timeScene(city);
  scenes.push(['time', time.picture]);

  const canvases: HTMLCanvasElement[] = [];
  for (const [name, picture] of scenes) {
    const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-scene="${name}"]`);
    if (!canvas) continue;
    picture.show(canvas);
    canvases.push(canvas);
  }
  const layout = () => fit(canvases);
  layout();
  window.addEventListener('resize', layout);

  for (const [name, value] of Object.entries(time.facts)) {
    for (const el of document.querySelectorAll(`[data-fact="${name}"]`)) el.textContent = String(value);
  }

  // French spacing, as on the chapter pages.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.parentElement?.closest('script, style')) node.nodeValue = typo(node.nodeValue ?? '');
  }

  const sheet = document.querySelector('[data-vocabulary]');
  for (const { label, picture } of vocabulary()) {
    const figure = document.createElement('figure');
    const canvas = document.createElement('canvas');
    picture.show(canvas);
    canvas.style.width = `${picture.width * 5}px`;
    canvas.style.height = `${picture.height * 5}px`;
    const caption = document.createElement('figcaption');
    caption.textContent = label;
    figure.append(canvas, caption);
    sheet?.append(figure);
  }
}
