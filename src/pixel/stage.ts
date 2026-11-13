import type { TimedPicture } from '../chapter/module';
import { DEPOT, type Instance, type Point } from '../core/instance';
import type { RoadMap } from '../core/roads';
import type { Landscape, Spot as Place } from '../core/landscape';
import type { Edge } from '../core/trace';
import type { PickHandlers, StageName, ThreadSpec, ViewName } from '../scene/maquette';
import { Bitmap, PAL, badge, ink, parcels, pointer, stop, truck, vivid, type Heading } from './kit';
import { buildRelief, flag, marble, type Relief } from './relief';
import { drawTimedMarks, drawTimetable, windowTag, type TimedRoute, type TimedView } from './timed';
import { drawSearchTree } from './tree';
import { BOARD, SCENE, buildTown, centred, compose, place, sameEdge, strokes, type Box, type Segment, type Spot, type Strokes, type Thing, type Town } from './town';

/** Pixels a truck covers in a second on its round, and how long it stops at a house. */
const TRUCK_SPEED = 44;
const TRUCK_PAUSE = 0.25;
/** Pixels a second for a truck moving from one parking place to the next. */
const PARKING_SPEED = 170;
/** Seconds a new stretch of thread takes to be pulled from one stop to the next. */
const PULL = 0.28;
/** Seconds between two buildings landing on a new board, and how long one takes to land. */
const LANDING = { apart: 0.03, lasts: 0.22 };

/** The picture's size, and where the departure board goes when there is one. */
interface Layout {
  width: number;
  height: number;
  board: Box | null;
}
const TOWN_ONLY: Layout = { width: SCENE.width, height: SCENE.height, board: null };
const BESIDE: Layout = {
  width: SCENE.width + 6 + 132 + 10,
  height: SCENE.height,
  board: { x: SCENE.width + 6, y: BOARD.y, w: 132, h: BOARD.height },
};
const BELOW: Layout = {
  width: SCENE.width,
  height: BOARD.y + BOARD.height + 10 + 148 + 10,
  board: { x: BOARD.x, y: BOARD.y + BOARD.height + 10, w: BOARD.width, h: 148 },
};
/** Below this many screen pixels per drawn pixel, the departure board is unreadable and left out. */
const SMALLEST_BOARD = 1.4;

/** Threads of one colour. */
interface Run {
  colour: string;
  edges: Edge[];
}

/** A truck on its round: which stretch it is on, how far along, and how long it still stands at a stop. */
interface Drive {
  /** The loop it drives round, corner by corner. */
  path: Spot[];
  /** Which corners are stops; null means all of them. */
  halts: readonly boolean[] | null;
  /** Null takes the colour of the single thread, as the single-truck chapters expect. */
  colour: string | null;
  leg: number;
  progress: number;
  pause: number;
}

const keyOf = ([a, b]: Edge) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const through = (stops: number[]): Edge[] => stops.slice(1).map((to, i): Edge => [stops[i], to]);

/**
 * The town as an animated pixel-art picture: a second way of drawing what the
 * chapters show on the 3D model, answering the same requests (stretch this
 * thread, colour these stops, send the truck round, show this timetable).
 *
 * A trial, only reachable in development: it has no camera, so nothing turns,
 * and it only answers the chapters listed in src/chapter/devLook.ts.
 */
export class PixelStage {
  static async create(host: HTMLElement): Promise<PixelStage> {
    return new PixelStage(host);
  }

  readonly backend = 'pixel';

  private readonly canvas = document.createElement('canvas');
  private inst: Instance | null = null;
  private town: Town | null = null;
  private shape: Layout = TOWN_ONLY;

  private thread: Run = { colour: PAL.route, edges: [] };
  private tracks: Run[] = [];
  /** A fleet's rounds, one colour per truck. */
  private fleet: Run[] = [];
  /** How many parcels each house ordered, and which piles are out (null: all of them). */
  private demand: readonly number[] | null = null;
  private parcelsOut: Set<number> | null = null;
  /** The houses of each track in the order it visits them, for the departure board. */
  private trackOrder: { colour: string; nodes: number[] }[] = [];
  /** Every thread on the board the last time they changed, to tell which are new. */
  private shown: Edge[] = [];
  /** Stretches of thread still being pulled taut, and how far along each is. */
  private readonly pulling = new Map<string, number>();
  private ghosts: readonly Edge[] = [];
  private marked: readonly Edge[] = [];
  private accent: { edges: readonly Edge[]; colour: string } = { edges: [], colour: PAL.paper };
  private pins: (string | null)[] = [];
  private current: number | null = null;

  /** Time windows, once a chapter gives some; with them come gauges and the departure board. */
  private windows: readonly { open: number; close: number }[] | null = null;
  private boardShown = false;
  private plan: { routes: TimedRoute[]; current: number | null } | null = null;
  private labelled: number[] = [];

  /** The threads of a network that is not a tour: the bound of a branch and bound. */
  private network: Run = { colour: PAL.muted, edges: [] };
  /** The search tree of a branch and bound, once a chapter asks for one: it gets the board. */
  private treeDepth: number | null = null;
  private treeShown = false;
  private treeColours: { open: string; best: string } = { open: PAL.route, best: PAL.best };
  private treeState: { branches: readonly { path: number[]; cut: boolean }[]; best: number[] | null; focus: number[] | null } = {
    branches: [],
    best: null,
    focus: null,
  };

  /** The second picture, shown in place of the town: a landscape of terraces and what rolls on it. */
  private stageName: StageName = 'town';
  private land: { landscape: Landscape; colour: string; relief: Relief | null } | null = null;
  private marbleAt: Place | null = null;
  /** Where the marble is drawn right now, as it rolls towards where it should be. */
  private marbleNow: Spot | null = null;
  private candidateAt: Place | null = null;
  private trail: readonly Place[] = [];
  private flagAt: Place | null = null;
  /** How hot the search is, from 0 to 1: the hotter, the more the landscape trembles. */
  private heat = 0;

  /** Houses taken out of the plan for now: they hover above the board. */
  private lifted = new Set<number>();

  private handlers: PickHandlers | null = null;
  private hovered: number | null = null;

  private drives: Drive[] = [];
  private drivesKey = '';
  /** Where the truck stands when it is not on a round: where the chapter left it, or beside the depot (null). */
  private parkSpot: { x: number; foot: number } | null = null;

  /** Streets laid over the town, and lines drawn flat along them. */
  private roads: RoadMap | null = null;
  private groundLines: { colour: string; bold: boolean; segments: Segment[] }[] = [];
  private parked: { x: number; foot: number; heading: Heading; mirrored: boolean } | null = null;

  private readonly calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  private shift = 0;
  private clock = 0;
  private bornAt = 0;
  private last = 0;
  private dirty = true;

  /**
   * What the time-window chapters ask of the 3D model's time axis. Here time
   * lies flat on the departure board: "raised" shows the board, and clearing
   * the paths clears the timetable.
   */
  readonly timeline = {
    setRaised: (raised: boolean): void => {
      this.boardShown = raised;
      this.dirty = true;
    },
    setPaths: (paths: readonly unknown[]): void => {
      if (paths.length > 0 || !this.plan) return;
      this.plan = null;
      this.parkSpot = null;
      this.setDrives([]);
      this.retie();
    },
    setWaits: (): void => {},
    setLate: (): void => {},
    setBeads: (): void => {},
  };

  /** What the proof chapter asks of the 3D model's search tree; here the tree is drawn flat on the board. */
  readonly tree = {
    show: (branches: readonly { path: number[]; cut: boolean }[], best: number[] | null, focus: number[] | null): void => {
      this.treeState = { branches, best, focus };
      this.dirty = true;
    },
    setColors: (open: string, best: string): void => {
      this.treeColours = { open: vivid(open), best: vivid(best) };
      this.dirty = true;
    },
    setRaised: (raised: boolean): void => {
      this.treeShown = raised;
      this.dirty = true;
    },
  };

  private constructor(private readonly host: HTMLElement) {
    host.style.position = 'relative';
    this.canvas.className = 'pixel-stage';
    host.appendChild(this.canvas);
    this.bindPointer();
    new ResizeObserver(() => this.layout()).observe(host);
    this.layout();
    requestAnimationFrame((now) => this.frame(now));
  }

  // ---------------------------------------------------------------- town

  setInstance(inst: Instance): void {
    this.inst = inst;
    this.roads = null;
    this.groundLines = [];
    this.town = buildTown(inst, this.shape.width, this.shape.height);
    this.thread = { colour: PAL.route, edges: [] };
    this.tracks = [];
    this.trackOrder = [];
    this.fleet = [];
    this.shown = [];
    this.pulling.clear();
    this.ghosts = [];
    this.marked = [];
    this.accent = { edges: [], colour: PAL.paper };
    this.pins = inst.nodes.map(() => null);
    this.current = null;
    this.hovered = null;
    this.plan = null;
    this.labelled = [];
    this.network = { colour: PAL.muted, edges: [] };
    this.treeState = { branches: [], best: null, focus: null };
    this.lifted = new Set();
    this.drives = [];
    this.drivesKey = '';
    this.parkSpot = null;
    this.parked = null;
    this.bornAt = this.clock;
    this.dirty = true;
  }

  // ------------------------------------------------------------- threads

  setThread(spec: ThreadSpec | null): void {
    const edges = spec ? through(spec.closed && spec.tour.length > 1 ? [...spec.tour, spec.tour[0]] : spec.tour) : [];
    this.thread = { colour: spec ? vivid(spec.color) : this.thread.colour, edges };
    this.retie(spec?.growLast ? edges.slice(-1) : undefined);
  }

  /** Rounds traced on the board, one colour each. */
  setTracks(routes: readonly { nodes: number[]; color: string; closed: boolean }[]): void {
    this.tracks = routes
      .filter((route) => route.nodes.length > 0)
      .map((route) => ({ colour: vivid(route.color), edges: through([DEPOT, ...route.nodes, ...(route.closed ? [DEPOT] : [])]) }));
    this.trackOrder = routes.filter((route) => route.nodes.length > 0).map((route) => ({ colour: vivid(route.color), nodes: route.nodes }));
    this.retie();
  }

  /** A fleet's rounds: one thread per truck, from the depot and back once the round is closed. */
  setFleet(routes: readonly { nodes: number[]; color: string; closed: boolean }[]): void {
    this.fleet = routes
      .filter((route) => route.nodes.length > 0)
      .map((route) => ({ colour: vivid(route.color), edges: through([DEPOT, ...route.nodes, ...(route.closed ? [DEPOT] : [])]) }));
    this.retie();
  }

  /** Puts each house's parcels out beside its stop, or only those of some houses; null takes them all away. */
  setParcels(demand: readonly number[] | null, only?: Iterable<number>): void {
    this.demand = demand;
    this.parcelsOut = only ? new Set(only) : null;
    this.dirty = true;
  }

  /** Every set of threads drawn right now: the rounds of a timetable, or the tracks and the single thread. */
  private runs(): Run[] {
    if (this.plan) {
      return this.plan.routes
        .filter((route) => route.stops.length > 0)
        .map((route) => ({
          colour: route.colour,
          edges: through([DEPOT, ...route.stops.map((visit) => visit.node), ...(route.closed ? [DEPOT] : [])]),
        }));
    }
    return [...this.tracks, ...this.fleet, this.thread];
  }

  /**
   * Notes which threads are new since the last change, and has them pulled
   * from one stop to the other: the ones the chapter points out, or the few
   * that a retying, an insertion or a move brings in.
   */
  private retie(pointedOut?: Edge[]): void {
    const edges = this.runs().flatMap((run) => run.edges);
    const fresh = edges.filter((edge) => !this.shown.some((old) => sameEdge(old, edge)));
    const pulled = pointedOut ?? (this.shown.length > 0 && fresh.length <= 3 ? fresh : []);
    for (const key of [...this.pulling.keys()]) {
      if (!edges.some((edge) => keyOf(edge) === key)) this.pulling.delete(key);
    }
    for (const edge of pulled) this.pulling.set(keyOf(edge), 0);
    this.shown = edges;
    this.dirty = true;
  }

  setGhosts(edges: readonly Edge[]): void {
    this.ghosts = edges;
    this.dirty = true;
  }

  setMarked(edges: readonly Edge[]): void {
    this.marked = edges;
    this.dirty = true;
  }

  setAccent(edges: readonly Edge[], warm = false): void {
    this.accent = { edges, colour: warm ? '#ff9650' : PAL.paper };
    this.dirty = true;
  }

  // --------------------------------------------------------------- stops

  setPins(visited: Iterable<number>, color: string, current: number | null = null): void {
    const done = new Set(visited);
    this.paintPins(this.pins.map((_, node) => (done.has(node) ? color : null)), current);
  }

  paintPins(colors: readonly (string | null)[], current: number | null = null): void {
    this.pins = this.pins.map((_, node) => (colors[node] ? vivid(colors[node]) : null));
    this.current = current;
    this.dirty = true;
  }

  /** Threads joining houses without being a tour: forks and loose ends allowed. */
  setNetwork(edges: readonly Edge[], color: string): void {
    this.network = { colour: vivid(color), edges: [...edges] };
    this.dirty = true;
  }

  /** Makes room for a search tree drawn to this depth (or takes it away with null). */
  setSearchTree(depth: number | null): void {
    if (depth === this.treeDepth) return;
    this.treeDepth = depth;
    this.layout();
    this.dirty = true;
  }

  /** Takes houses out of the plan for now (they hover above the board), or puts them all back with none. */
  setLifted(nodes: Iterable<number>): void {
    this.lifted = new Set(nodes);
    this.dirty = true;
  }

  // ---------------------------------------------------------------- time

  /** Gives every house its time window (or takes them away with null): gauges appear above the houses. */
  setWindows(windows: readonly { open: number; close: number }[] | null): void {
    if (windows === this.windows) return;
    this.windows = windows;
    this.layout();
    this.dirty = true;
  }

  /** Which houses should say their window in full; only one at a time is written out, gauges say the rest. */
  setLabels(labels: readonly { node: number; time: number | null; text: string }[]): void {
    this.labelled = labels.map((label) => label.node);
    this.dirty = true;
  }

  /** Rounds with their timetable: threads on the board, needles on the gauges, rows on the departure board. */
  setTimedPlan(picture: TimedPicture): void {
    const routes = picture.routes.map(
      (route): TimedRoute => ({
        colour: vivid(route.color),
        closed: route.closed,
        stops: route.stops.map((visit) => ({ node: visit.node, visit })),
        back: route.closed && route.stops.length > 0 ? route.back : undefined,
      }),
    );
    this.plan = { routes, current: picture.current };
    this.tracks = [];
    this.trackOrder = [];
    this.thread = { ...this.thread, edges: [] };
    this.retie();

    // The truck stands at the stop it has just reached; once every round is
    // complete and nothing is being looked at, each truck drives its own.
    const underway = routes.find((route) => !route.closed && route.stops.length > 0);
    const reached = underway?.stops[underway.stops.length - 1].node ?? null;
    const there = reached !== null && reached === picture.current && this.town ? this.town.spots[reached] : null;
    this.parkSpot = there ? { x: there.x + 11, foot: there.y + 4 } : null;
    const served = routes.filter((route) => route.stops.length > 0);
    const complete = picture.current === null && served.length > 0 && served.every((route) => route.closed);
    this.setDrives(complete ? served.map((route) => ({ tour: [DEPOT, ...route.stops.map((visit) => visit.node)], colour: route.colour })) : []);
  }

  /** What the gauges and the board show: the timetable if there is one, else the order of the tracks, else windows alone. */
  private timedView(): TimedView | null {
    if (!this.windows) return null;
    const day: [number, number] = [this.windows[DEPOT].open, this.windows[DEPOT].close + 60];
    if (this.plan) return { day, windows: this.windows, routes: this.plan.routes, current: this.plan.current };
    const ordered = this.boardShown
      ? this.trackOrder.map((track): TimedRoute => ({ colour: track.colour, closed: false, stops: track.nodes.map((node) => ({ node })) }))
      : [];
    // Without a timetable, the stops keep the colours the chapter gave them.
    return { day, windows: this.windows, routes: ordered, current: this.current, pins: ordered.length === 0 ? this.pins : undefined };
  }

  // --------------------------------------------------------------- roads

  /** Lays a street network over the town, or takes it away with null: the town is redrawn around it. */
  setRoadMap(map: RoadMap | null): void {
    if (map === this.roads) return;
    this.roads = map;
    if (this.inst) this.town = buildTown(this.inst, this.shape.width, this.shape.height, map);
    this.dirty = true;
  }

  /** Lines drawn flat on the streets: a route, a way being searched. Each group has one colour. */
  setGroundLines(groups: readonly { color: string; bold?: boolean; segments: readonly (readonly [Point, Point])[] }[]): void {
    this.groundLines = groups
      .filter((group) => group.segments.length > 0)
      .map((group) => ({
        colour: vivid(group.color),
        bold: group.bold ?? false,
        segments: group.segments.map(([from, to]): Segment => [place(from), place(to)]),
      }));
    this.dirty = true;
  }

  // -------------------------------------------------------------- trucks

  /** Sends the truck round a tour, or back to the depot with null. The same tour again does not restart it. */
  setTruck(tour: number[] | null): void {
    this.setDrives(tour && tour.length > 1 ? [{ tour, colour: null }] : []);
  }

  /** Sends one truck round each tour, each in its own colour. */
  setTrucks(routes: readonly { tour: number[]; color: string }[]): void {
    this.setDrives(routes.filter((route) => route.tour.length > 1).map((route) => ({ tour: route.tour, colour: vivid(route.color) })));
  }

  private setDrives(rounds: { tour: number[]; colour: string | null }[]): void {
    const key = rounds.map((round) => `${round.colour}:${round.tour.join(',')}`).join(';');
    if (key === this.drivesKey) return;
    this.drivesKey = key;
    const spots = this.town?.spots ?? [];
    // Staggered departures, so the trucks do not leave the depot in a pack.
    this.drives = rounds.map((round, i) => ({
      path: round.tour.map((node) => spots[node]),
      halts: null,
      colour: round.colour,
      leg: 0,
      progress: 0,
      pause: 0.4 + i * 0.6,
    }));
    this.dirty = true;
  }

  /** Sends one truck round a loop of points of the town, pausing only where `stops` says so. */
  driveAlong(loop: readonly Point[], stops: readonly boolean[], color: string): void {
    const key = `along:${color}:${loop.map((point) => point.x + ',' + point.y).join(';')}`;
    if (key === this.drivesKey) return;
    this.drivesKey = key;
    this.drives = loop.length > 1 ? [{ path: loop.map(place), halts: stops, colour: vivid(color), leg: 0, progress: 0, pause: 0.4 }] : [];
    this.dirty = true;
  }

  /** Stands the truck still at a point of the town. */
  parkTruck(point: Point): void {
    const spot = place(point);
    this.parkSpot = { x: spot.x, foot: spot.y + 3 };
    this.setDrives([]);
    this.dirty = true;
  }

  private legOf(drive: Drive): [Spot, Spot] {
    return [drive.path[drive.leg], drive.path[(drive.leg + 1) % drive.path.length]];
  }

  private advanceTrucks(dt: number): boolean {
    if (!this.town) return false;
    for (const drive of this.drives) {
      if (drive.pause > 0) {
        drive.pause -= dt;
        continue;
      }
      const [from, to] = this.legOf(drive);
      drive.progress += (dt * TRUCK_SPEED) / Math.max(Math.hypot(to.x - from.x, to.y - from.y), 1);
      if (drive.progress >= 1) {
        drive.leg = (drive.leg + 1) % drive.path.length;
        drive.progress = 0;
        // Along streets the loop has a point at every corner; only some of them are deliveries.
        drive.pause = !drive.halts || drive.halts[drive.leg] ? TRUCK_PAUSE : 0;
      }
    }
    if (this.drives.length > 0) return true;

    // No round to drive: the truck goes and stands where the chapter left it.
    const { spots } = this.town;
    const atDepot = this.parkSpot === null;
    const goal = this.parkSpot ?? { x: spots[DEPOT].x - 14, foot: spots[DEPOT].y + 5 };
    if (!this.parked) {
      this.parked = { ...goal, heading: 'side', mirrored: atDepot };
      return true;
    }
    const dx = goal.x - this.parked.x;
    const dy = goal.foot - this.parked.foot;
    const far = Math.hypot(dx, dy);
    if (far < 0.5) {
      const settled = this.parked.heading !== 'side' || this.parked.mirrored !== atDepot;
      this.parked = { ...goal, heading: 'side', mirrored: atDepot };
      return settled;
    }
    const step = Math.min((dt * PARKING_SPEED) / far, 1);
    const heading: Heading = Math.abs(dx) >= Math.abs(dy) * 0.8 ? 'side' : dy < 0 ? 'away' : 'towards';
    this.parked = { x: this.parked.x + dx * step, foot: this.parked.foot + dy * step, heading, mirrored: heading === 'side' && dx < 0 };
    return true;
  }

  /** The colour of the truck when it is not on a round of its own. */
  private truckColour(): string {
    const routes = this.plan?.routes.filter((route) => route.stops.length > 0) ?? [];
    return (routes.find((route) => !route.closed) ?? routes[routes.length - 1])?.colour ?? this.thread.colour;
  }

  /** The trucks where they are now, each turned the way it is going. */
  private trucksNow(): Thing[] {
    if (this.drives.length === 0) {
      if (!this.parked) return [];
      const picture = truck(this.truckColour(), this.parked.heading);
      return [{ picture, x: Math.round(this.parked.x - picture.width / 2), foot: Math.round(this.parked.foot), mirrored: this.parked.mirrored }];
    }
    return this.drives.map((drive) => {
      const [from, to] = this.legOf(drive);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const heading: Heading = Math.abs(dx) >= Math.abs(dy) * 0.8 ? 'side' : dy < 0 ? 'away' : 'towards';
      const picture = truck(drive.colour ?? this.thread.colour, heading);
      const x = from.x + dx * drive.progress;
      const y = from.y + dy * drive.progress;
      return { picture, x: Math.round(x - picture.width / 2), foot: Math.round(y) + 3, mirrored: heading === 'side' && dx < 0 };
    });
  }

  // -------------------------------------------------------------- layout

  /** The 3D model answers this by moving its camera; this picture has none. */
  setView(_view: ViewName): void {}

  /** Which picture is shown: the town, or the landscape of the annealing chapter. */
  setStage(stage: StageName): void {
    this.stageName = stage;
    this.dirty = true;
  }

  // -------------------------------------------------------------- relief

  /** The landscape to draw on the second picture, and the colour of the marble that rolls on it. */
  setRelief(land: Landscape, color: string): void {
    this.land = { landscape: land, colour: vivid(color), relief: null };
    this.marbleNow = null;
    this.dirty = true;
  }

  setMarble(spot: Place | null): void {
    this.marbleAt = spot;
    this.dirty = true;
  }

  /** A place the marble is considering, shown small and pale. */
  setCandidate(spot: Place | null): void {
    this.candidateAt = spot;
    this.dirty = true;
  }

  setTrail(spots: readonly Place[]): void {
    this.trail = spots.slice(-90);
    this.dirty = true;
  }

  /** Plants a flag on the best place found so far. */
  setFlag(spot: Place | null): void {
    this.flagAt = spot;
    this.dirty = true;
  }

  setShake(amount: number): void {
    this.heat = Math.min(Math.max(amount, 0), 1);
    this.dirty = true;
  }

  private drawRelief(): void {
    const land = this.land;
    if (!land) return;
    land.relief ??= buildRelief(land.landscape, this.shape.width, this.shape.height);
    const { relief } = land;
    const picture = new Bitmap(this.shape.width, this.shape.height);
    picture.pixels.set(relief.ground.pixels);

    // Where it has been: a dotted trail, bolder for the latest steps.
    this.trail.forEach((place, i) => {
      const spot = relief.at(place);
      const recent = i >= this.trail.length - 12;
      picture.rect(spot.x, spot.y, recent ? 2 : 1, recent ? 2 : 1, ink(recent ? PAL.paper : land.colour));
    });
    const stand = (drawing: Bitmap, spot: Spot) => picture.paste(drawing, spot.x - Math.floor(drawing.width / 2), spot.y - drawing.height + 2);
    if (this.flagAt) picture.paste(flag(), relief.at(this.flagAt).x, relief.at(this.flagAt).y - 6);
    if (this.candidateAt) stand(marble(land.colour, true), relief.at(this.candidateAt));
    if (this.marbleNow) stand(marble(land.colour), { x: Math.round(this.marbleNow.x), y: Math.round(this.marbleNow.y) });

    // Heat makes the whole landscape tremble by a pixel, the more often the hotter it is.
    const shiver = this.heat > 0.05 && !this.calm.matches && Math.floor(this.clock * (6 + this.heat * 18)) % 2 === 0;
    if (!shiver) {
      picture.show(this.canvas);
      return;
    }
    const shaken = new Bitmap(picture.width, picture.height);
    shaken.pixels.fill(ink(PAL.table));
    shaken.paste(picture, Math.floor(this.clock * 31) % 2 ? 1 : -1, 0);
    shaken.show(this.canvas);
  }

  /** Leaves `px` pixels on the left to the text column: the picture sits in the middle of what remains. */
  setShift(px: number): void {
    this.shift = px;
    this.layout();
  }

  private layout(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    const free = Math.max(width - 2 * this.shift, width * 0.35);
    // A drawn pixel covers a whole number of pixels of the screen, or it would blur.
    const ratio = window.devicePixelRatio || 1;
    const sizeOf = (shape: Layout) => Math.max(1, Math.floor(Math.min((free * 0.96 * ratio) / shape.width, (height * 0.94 * ratio) / shape.height)));

    // With time windows, the departure board goes beside the town or below it,
    // whichever leaves the larger pixels; on a small screen it is left out.
    let shape = TOWN_ONLY;
    if (this.windows || this.treeDepth !== null) {
      const withBoard = sizeOf(BELOW) > sizeOf(BESIDE) ? BELOW : BESIDE;
      if (sizeOf(withBoard) / ratio >= SMALLEST_BOARD) shape = withBoard;
    }
    if (shape !== this.shape || this.canvas.width !== shape.width) {
      this.shape = shape;
      this.canvas.width = shape.width;
      this.canvas.height = shape.height;
      if (this.inst) this.town = buildTown(this.inst, shape.width, shape.height, this.roads);
      if (this.land) this.land.relief = null;
      this.dirty = true;
    }

    const scale = sizeOf(shape) / ratio;
    const snap = (value: number) => Math.round(value * ratio) / ratio;
    this.canvas.style.width = `${shape.width * scale}px`;
    this.canvas.style.height = `${shape.height * scale}px`;
    this.canvas.style.left = `${snap(width - free + (free - shape.width * scale) / 2)}px`;
    this.canvas.style.top = `${snap((height - shape.height * scale) / 2)}px`;
  }

  // ------------------------------------------------------------- picking

  /** Lets the reader click houses; pass null to turn picking off. */
  setPicking(handlers: PickHandlers | null): void {
    this.handlers = handlers;
    if (!handlers) this.setHovered(null);
  }

  private bindPointer(): void {
    this.canvas.addEventListener('pointermove', (e) => this.setHovered(this.handlers ? this.nodeAt(e) : null));
    this.canvas.addEventListener('pointerleave', () => this.setHovered(null));
    this.canvas.addEventListener('click', (e) => {
      const node = this.handlers ? this.nodeAt(e) : null;
      if (node !== null) this.handlers?.pick(node);
    });
  }

  /** The node whose stop or building is under the pointer: the nearest stop if several are. */
  private nodeAt(e: MouseEvent): number | null {
    if (!this.town) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
    let best: number | null = null;
    let nearest = Infinity;
    this.town.spots.forEach((spot, node) => {
      const box = this.town!.boxes[node];
      const distance = Math.hypot(spot.x - x, spot.y - y);
      const onBuilding = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      if ((distance <= 7 || onBuilding) && distance < nearest) {
        nearest = distance;
        best = node;
      }
    });
    return best;
  }

  private setHovered(node: number | null): void {
    if (node === this.hovered) return;
    this.hovered = node;
    this.canvas.style.cursor = node === null ? '' : 'pointer';
    this.handlers?.hover?.(node);
    this.dirty = true;
  }

  // --------------------------------------------------------------- frame

  private frame(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.clock += dt;

    for (const [key, done] of this.pulling) {
      if (done + dt / PULL >= 1) this.pulling.delete(key);
      else this.pulling.set(key, done + dt / PULL);
    }
    const driving = this.advanceTrucks(dt);

    if (this.stageName === 'relief') {
      // The marble rolls to where it should be; the picture is redrawn while it moves or while it is hot.
      if (this.land && !this.land.relief) {
        this.land.relief = buildRelief(this.land.landscape, this.shape.width, this.shape.height);
        this.dirty = true;
      }
      const relief = this.land?.relief;
      const goal = this.marbleAt && relief ? relief.at(this.marbleAt) : null;
      let rolling = false;
      if (!goal) this.marbleNow = null;
      else if (!this.marbleNow) {
        // Put down where it starts, rather than rolled there from nowhere.
        this.marbleNow = goal;
        this.dirty = true;
      } else {
        const pull = 1 - Math.exp(-18 * dt);
        rolling = Math.hypot(goal.x - this.marbleNow.x, goal.y - this.marbleNow.y) > 0.3;
        this.marbleNow = { x: this.marbleNow.x + (goal.x - this.marbleNow.x) * pull, y: this.marbleNow.y + (goal.y - this.marbleNow.y) * pull };
      }
      if (this.land && (this.dirty || rolling || this.heat > 0.05)) {
        this.drawRelief();
        this.dirty = false;
      }
      requestAnimationFrame((next) => this.frame(next));
      return;
    }

    // Redrawn only while something moves: threads being pulled, dashes
    // marching, trucks driving, the pointer bobbing, buildings landing.
    const landing = this.town !== null && this.clock - this.bornAt < this.town.scenery.length * LANDING.apart + LANDING.lasts;
    const pointing = (this.plan?.current ?? this.current) !== null || this.lifted.size > 0;
    if (this.town && (this.dirty || driving || landing || pointing || this.pulling.size > 0 || this.ghosts.length > 0)) {
      this.draw(this.town);
      this.dirty = false;
    }
    requestAnimationFrame((next) => this.frame(next));
  }

  private draw(town: Town): void {
    const stretch = (edge: Edge): Segment => {
      const from = town.spots[edge[0]];
      const to = town.spots[edge[1]];
      const done = this.pulling.get(keyOf(edge));
      if (done === undefined) return [from, to];
      const eased = 1 - (1 - done) ** 3;
      return [from, { x: Math.round(from.x + (to.x - from.x) * eased), y: Math.round(from.y + (to.y - from.y) * eased) }];
    };
    const whole = (edges: readonly Edge[]) => edges.map((edge): Segment => [town.spots[edge[0]], town.spots[edge[1]]]);

    const lines: Strokes[] = [];
    // A light band under a thread makes it glow: the thread just tied, or the one about to be.
    if (this.accent.edges.length > 0) lines.push(strokes(town, whole(this.accent.edges), this.accent.colour, PAL.line, { brush: 6 }));
    if (this.network.edges.length > 0) lines.push(strokes(town, whole(this.network.edges), this.network.colour, PAL.line));
    for (const run of this.runs()) {
      if (run.edges.length > 0) lines.push(strokes(town, run.edges.map(stretch), run.colour, PAL.line));
    }
    for (const group of this.groundLines) lines.push(strokes(town, group.segments, group.colour, PAL.line, { brush: group.bold ? 2 : 1 }));
    // Threads that are only proposed: dashes that march along them.
    if (this.ghosts.length > 0) {
      lines.push(strokes(town, whole(this.ghosts), PAL.paper, PAL.line, { dash: [3, 3], phase: 5 - (Math.floor(this.clock * 9) % 6) }));
    }
    if (this.marked.length > 0) lines.push(strokes(town, whole(this.marked), PAL.line, PAL.paper));

    const overlay = new Bitmap(town.width, town.height);
    const view = this.timedView();
    const current = view ? view.current : this.current;
    if (view) {
      drawTimedMarks(overlay, town, { ...view, current: view.current ?? this.hovered });
    } else if (this.treeShown) {
      // Beside a search tree every house wears its number, the one the tree names it by.
      town.spots.forEach((spot, node) => centred(overlay, badge(node === DEPOT ? 'D' : String(node), this.pins[node] ?? PAL.paper), spot));
    } else {
      town.spots.forEach((spot, node) => {
        centred(overlay, stop(this.pins[node] ?? PAL.paper, node === this.current || node === this.hovered), spot);
      });
    }

    // Parcels wait beside the stop of the house that ordered them.
    this.demand?.forEach((count, node) => {
      if (count === 0 || (this.parcelsOut && !this.parcelsOut.has(node))) return;
      const pile = parcels(count);
      overlay.paste(pile, town.spots[node].x + 5, town.spots[node].y + 3 - pile.height);
    });

    // What is being looked at: its window written out when the chapter asks, else an arrow bobbing above it.
    const above = (node: number) => town.homes[node].top - (view && node !== DEPOT ? 9 : 0);
    if (view && this.labelled.length === 1 && this.labelled[0] !== DEPOT) {
      const node = this.labelled[0];
      const tag = windowTag(view.windows[node]);
      const x = Math.min(Math.max(town.homes[node].x - Math.floor(tag.width / 2), 1), town.width - tag.width - 1);
      overlay.paste(tag, x, Math.max(above(node) - tag.height - 1, 0));
    } else if (current !== null) {
      const arrow = pointer(view ? PAL.paper : this.thread.colour);
      overlay.paste(arrow, town.homes[current].x - 3, Math.max(above(current) - 6 - (Math.floor(this.clock * 3) % 2), 0));
    }

    // On a new board the buildings land one after the other, from the back to the front.
    const age = this.clock - this.bornAt;
    const things = town.scenery.flatMap((thing, i): Thing[] => {
      const landed = Math.min((age - i * LANDING.apart) / LANDING.lasts, 1);
      if (landed <= 0) return [];
      // A house taken out of the plan hovers, bobbing a little, until it is put back.
      const hover = thing.node !== undefined && this.lifted.has(thing.node) ? 7 + (Math.floor(this.clock * 2.5 + thing.node) % 2) : 0;
      return [{ ...thing, foot: thing.foot - Math.round((1 - landed) ** 2 * 7) - hover }];
    });

    const picture = compose(town, { lines, things, moving: this.trucksNow(), overlay });
    if (view && this.boardShown && this.shape.board) drawTimetable(picture, this.shape.board, view);
    if (this.treeShown && this.shape.board) {
      drawSearchTree(picture, this.shape.board, { houses: town.spots.length - 1, ...this.treeState, open: this.treeColours.open, bestColour: this.treeColours.best });
    }
    picture.show(this.canvas);
  }
}
