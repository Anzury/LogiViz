import { DEPOT } from '../core/instance';
import type { Stop } from '../core/timeWindows';
import { Bitmap, PAL, badge, gauge, ink, stop, widthOf, write } from './kit';
import { centred, type Box, type Town } from './town';

/**
 * Rounds with a timetable, drawn flat: a gauge above each house, the rank of
 * each stop on the colour of its truck, and a departure board where the
 * morning reads from left to right. Colour always says which truck; lateness
 * is told with black and stripes, so the two never get mixed up.
 */

export interface TimedRoute {
  colour: string;
  /** Whether the truck has driven back to the depot. */
  closed: boolean;
  /** The houses in the order they are served; `visit` is missing while only the order is known. */
  stops: { node: number; visit?: Stop }[];
  /** When the truck is back, once it has driven back. */
  back?: number;
}

export interface TimedView {
  /** The stretch of the day shown, in minutes after midnight. */
  day: [number, number];
  /** Each node's time window; node 0 is the depot. */
  windows: readonly { open: number; close: number }[];
  routes: TimedRoute[];
  /** The house being dealt with right now, if any. */
  current: number | null;
  /** The colour of each stop no round of the timetable serves, when something else gives it one. */
  pins?: readonly (string | null)[];
}

/**
 * A stop's rank in its round, on the colour of its truck; black when the
 * delivery came too late, edged in white where the ground itself is dark.
 */
export const rankBadge = (rank: number, colour: string, late: boolean, onDark = false) =>
  late ? badge(String(rank), PAL.line, PAL.paper, onDark ? PAL.paper : PAL.line) : badge(String(rank), colour);

/** An hour written short, as on the departure board: 9h, 10h30. */
export const clockText = (minute: number) => {
  const rounded = Math.round(minute);
  return `${Math.floor(rounded / 60)}h${rounded % 60 ? String(rounded % 60).padStart(2, '0') : ''}`;
};

/** A house's window written out, for the one house being looked at. */
export const windowTag = (window: { open: number; close: number }) => badge(`${clockText(window.open)}-${clockText(window.close)}`, PAL.paper);

/** On the town: a gauge above each house, and each stop's rank where a truck serves it. */
export function drawTimedMarks(overlay: Bitmap, town: Town, view: TimedView): void {
  const served = new Map<number, { rank: number; colour: string; visit?: Stop }>();
  for (const route of view.routes) {
    route.stops.forEach((visit, i) => served.set(visit.node, { rank: i + 1, colour: route.colour, visit: visit.visit }));
  }

  // Gauges from the back of the town to the front, then the stops over everything.
  town.spots
    .map((_, node) => node)
    .filter((node) => node !== DEPOT)
    .sort((a, b) => town.spots[a].y - town.spots[b].y)
    .forEach((node) => {
      const window = view.windows[node];
      const visit = served.get(node)?.visit;
      const needle = visit ? { at: visit.arrive, colour: served.get(node)!.colour, late: visit.late > 0 } : undefined;
      const picture = gauge(view.day, [window.open, window.close], needle);
      const home = town.homes[node];
      overlay.paste(picture, home.x - Math.floor(picture.width / 2), Math.max(home.top - picture.height - 1, 0));
    });

  town.spots.forEach((spot, node) => {
    const round = served.get(node);
    if (node === DEPOT) centred(overlay, view.pins ? stop(view.pins[node] ?? PAL.paper, node === view.current) : badge('D', PAL.paper), spot);
    else if (round) centred(overlay, rankBadge(round.rank, round.colour, (round.visit?.late ?? 0) > 0), spot);
    else centred(overlay, stop(view.pins?.[node] ?? PAL.paper, node === view.current), spot);
  });
}

/**
 * The departure board: one row per stop, grouped by truck, time running to
 * the right. On a row, the light stretch is the house's window and the block
 * is the delivery; a thin line slants down from one delivery to the next
 * while the truck drives.
 */
export function drawTimetable(picture: Bitmap, frame: Box, view: TimedView): void {
  const { x, y, w, h } = frame;
  picture.rect(x + 3, y + 4, w, h, ink(PAL.tableShade));
  picture.rect(x - 1, y - 1, w + 2, h + 2, ink(PAL.rimDark));
  picture.rect(x, y, w, h, ink(PAL.rim));
  picture.rect(x, y, w, 1, ink(PAL.rimLight));
  picture.rect(x, y, 1, h, ink(PAL.rimLight));
  picture.rect(x + 3, y + 3, w - 6, h - 6, ink(PAL.board));

  const left = x + 7;
  const from = left + 16;
  const to = x + w - 9;
  const at = (minute: number) => from + Math.round(((Math.min(Math.max(minute, view.day[0]), view.day[1]) - view.day[0]) / (view.day[1] - view.day[0])) * (to - from));
  const top = y + 7;
  const bottom = y + h - 7;

  // The hours across the top, and a faint line down from each.
  for (let minute = view.day[0]; minute <= view.day[1]; minute += 60) {
    const label = clockText(minute);
    write(picture, Math.min(at(minute) - Math.floor(widthOf(label) / 2), x + w - 5 - widthOf(label)), top, label, ink(PAL.boardText));
    picture.rect(at(minute), top + 7, 1, bottom - top - 7, ink(PAL.boardLine));
  }

  const rounds = view.routes.filter((route) => route.stops.length > 0);
  const tail = (route: TimedRoute) => (route.closed && route.back !== undefined ? 0.6 : 0.2);
  const units = rounds.reduce((sum, route) => sum + route.stops.length + tail(route), 0);
  const rowHeight = Math.max(9, Math.min(11, Math.floor((bottom - top - 10) / Math.max(units, 1))));

  let cursor = top + 10;
  rounds.forEach((route, index) => {
    if (index > 0) picture.rect(left, cursor - 1, to - left + 3, 1, ink(PAL.boardLine));
    // Each truck leaves the depot when the day starts: its line begins at the left edge of its first row.
    let last = { x: at(view.day[0]), y: cursor };

    route.stops.forEach(({ node, visit }, i) => {
      const rowTop = cursor + i * rowHeight;
      const middle = rowTop + 4;
      const window = view.windows[node];
      const late = (visit?.late ?? 0) > 0;
      if (node === view.current) picture.rect(from - 3, rowTop, to - from + 6, 9, ink(PAL.boardLine));
      const mark = rankBadge(i + 1, route.colour, late, true);
      picture.paste(mark, left + 11 - mark.width, rowTop);
      picture.rect(at(window.open), rowTop + 2, at(window.close) - at(window.open) + 1, 5, ink(PAL.paper));
      if (!visit) return;

      picture.line(last.x, last.y, at(visit.arrive), middle, ink(PAL.travel));
      // Waiting for the window to open: dots, in the colour of the truck.
      if (visit.wait > 0) picture.line(at(visit.arrive), middle, at(visit.start), middle, ink(route.colour), 1, [1, 1]);
      // Too late: warning stripes from the end of the window to the arrival.
      if (late) picture.stripes(at(window.close) + 1, middle - 1, Math.max(at(visit.arrive) - at(window.close) - 1, 0), 3, ink(PAL.paper), ink(PAL.line));
      const width = Math.max(at(visit.leave) - at(visit.start), 3);
      picture.rect(at(visit.start) - 1, rowTop, width + 2, 9, ink(late ? PAL.paper : PAL.line));
      picture.rect(at(visit.start), rowTop + 1, width, 7, ink(late ? PAL.line : route.colour));
      last = { x: at(visit.leave), y: middle };
    });

    cursor += route.stops.length * rowHeight;
    if (route.closed && route.back !== undefined) {
      // Back at the depot: a light tick where the round ends.
      picture.line(last.x, last.y, at(route.back), cursor + 1, ink(PAL.travel));
      picture.rect(at(route.back) - 1, cursor - 1, 2, 5, ink(PAL.paper));
    }
    cursor += Math.round(tail(route) * rowHeight) + 1;
  });
}
