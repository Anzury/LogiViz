import { DEPOT, type Instance, type Point } from '../core/instance';
import type { RoadMap } from '../core/roads';
import { mulberry32 } from '../core/rng';
import type { Edge } from '../core/trace';
import { Bitmap, NONE, PAL, depot, house, ink, tree } from './kit';

/**
 * A town drawn for pixel art: the scenery as one layer, what carries
 * information as others, stacked so that information is never hidden.
 * Shared by the design study and by the animated stage.
 */

// The board is seen from the front and a little from above: a unit of the town
// is two pixels across and a bit less up the screen, so distances stay true.
const ACROSS = 2;
const UP = 1.6;
const MAT = { width: 100 * ACROSS, height: 100 * UP };
const RIM = 5;
const FRONT = 6;
const ORIGIN = { x: 19, y: 37 };

/** Size of a scene holding one board, and where the board stands in it. */
export const SCENE = { width: ORIGIN.x * 2 + MAT.width, height: ORIGIN.y + MAT.height + RIM + FRONT + 14 };
export const BOARD = { x: ORIGIN.x - RIM, y: ORIGIN.y - RIM, width: MAT.width + 2 * RIM, height: MAT.height + 2 * RIM + FRONT };

export interface Spot {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Something standing on the board: a picture, its left edge, and the row its foot stands on. */
export interface Thing {
  picture: Bitmap;
  x: number;
  foot: number;
  mirrored?: boolean;
  /** For a building: the node it belongs to. */
  node?: number;
}

export interface Town {
  width: number;
  height: number;
  /** Table, board and mat, with the shadows of what never moves. */
  ground: Bitmap;
  /** Buildings and trees, from the back of the board to the front. */
  scenery: Thing[];
  /** Where each node's stop is. */
  spots: Spot[];
  /** Where each node's building stands: its middle, and the row of its roof top. */
  homes: { x: number; top: number }[];
  /** What each node's building covers, to tell which one is under the pointer. */
  boxes: Box[];
}

export const place = (point: Point): Spot => ({ x: ORIGIN.x + Math.round(point.x * ACROSS), y: ORIGIN.y + Math.round(point.y * UP) });

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function drawBoard(ground: Bitmap, seed: number): void {
  const { x, y, width } = BOARD;
  const height = BOARD.height - FRONT;
  ground.rect(x + 3, y + 4, width, BOARD.height, ink(PAL.tableShade));
  ground.rect(x - 1, y - 1, width + 2, BOARD.height + 2, ink(PAL.rimDark));
  ground.rect(x, y + height, width, FRONT, ink(PAL.rimSide));
  ground.rect(x, y, width, height, ink(PAL.rim));
  ground.rect(x, y, width, 1, ink(PAL.rimLight));
  ground.rect(x, y, 1, height, ink(PAL.rimLight));

  // The cutting mat and its grid, one line every kilometre.
  ground.rect(ORIGIN.x, ORIGIN.y, MAT.width, MAT.height, ink(PAL.mat));
  const rng = mulberry32(seed);
  for (let i = 0; i < 90; i++) {
    ground.set(ORIGIN.x + Math.floor(rng() * MAT.width), ORIGIN.y + Math.floor(rng() * MAT.height), ink(PAL.matFleck));
  }
  for (let unit = 10; unit < 100; unit += 10) {
    ground.rect(ORIGIN.x + unit * ACROSS, ORIGIN.y, 1, MAT.height, ink(PAL.matLine));
    ground.rect(ORIGIN.x, ORIGIN.y + Math.round(unit * UP), MAT.width, 1, ink(PAL.matLine));
  }
  // The rim casts a thin shadow along the top and left of the mat.
  ground.rect(ORIGIN.x, ORIGIN.y, MAT.width, 1, ink(PAL.matShade));
  ground.rect(ORIGIN.x, ORIGIN.y, 1, MAT.height, ink(PAL.matShade));
}

/** A table with an empty board on it: the ground of any picture. */
export function blankBoard(width: number, height: number, seed: number): Bitmap {
  const ground = new Bitmap(width, height);
  ground.rect(0, 0, width, height, ink(PAL.table));
  drawBoard(ground, seed);
  return ground;
}

/**
 * Streets, lanes, a river and its bridges, painted on the mat. Returns what
 * they cover, so that buildings and trees can keep clear of them.
 */
function drawRoads(ground: Bitmap, map: RoadMap): Bitmap {
  const covered = new Bitmap(ground.width, ground.height);
  const band = (onto: Bitmap, from: Point, to: Point, wide: number, colour: string) => {
    const a = place(from);
    const b = place(to);
    const back = Math.floor(wide / 2);
    onto.line(a.x - back, a.y - back, b.x - back, b.y - back, ink(colour), wide);
  };
  // Only the mat is painted: the rim keeps the river and the streets in.
  const lay = (layer: Bitmap) => {
    for (let y = ORIGIN.y; y < ORIGIN.y + MAT.height; y++) {
      for (let x = ORIGIN.x; x < ORIGIN.x + MAT.width; x++) {
        const colour = layer.get(x, y);
        if (colour === NONE) continue;
        ground.set(x, y, colour);
        covered.set(x, y, colour);
      }
    }
  };

  const river = new Bitmap(ground.width, ground.height);
  map.river.slice(1).forEach((point, i) => band(river, map.river[i], point, 9, PAL.water));
  const rng = mulberry32(map.seed + 7);
  for (let i = 0; i < 400; i++) {
    const x = ORIGIN.x + Math.floor(rng() * MAT.width);
    const y = ORIGIN.y + Math.floor(rng() * MAT.height);
    if (river.get(x, y) !== NONE && river.get(x + 1, y) !== NONE && i % 6 === 0) river.rect(x, y, 2, 1, ink(PAL.waterGlint));
  }
  lay(river.outlined(ink(PAL.waterEdge)));

  const streets = new Bitmap(ground.width, ground.height);
  for (const edge of map.edges) {
    if (edge.kind !== 'bridge') band(streets, map.nodes[edge.a], map.nodes[edge.b], edge.kind === 'lane' ? 2 : 4, PAL.street);
  }
  lay(streets.outlined(ink(PAL.streetEdge)));

  // A bridge is a plank deck across the water, with a rail on each side.
  const decks = new Bitmap(ground.width, ground.height);
  for (const edge of map.edges) {
    if (edge.kind === 'bridge') band(decks, map.nodes[edge.a], map.nodes[edge.b], 6, PAL.rim);
  }
  lay(decks.outlined(ink(PAL.rimDark)));
  return covered;
}

const MAT_COLOURS = new Set([ink(PAL.mat), ink(PAL.matLine), ink(PAL.matFleck)]);

/** Darkens the mat at the foot of a thing; the rim and the table keep their colour. */
function castShadow(ground: Bitmap, thing: Thing): void {
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < thing.picture.width; i++) {
      const x = thing.x + 2 + i;
      const y = thing.foot + j;
      if (MAT_COLOURS.has(ground.get(x, y))) ground.set(x, y, ink(PAL.matShade));
    }
  }
}

/**
 * The scenery of a town: board, buildings and trees. The same town always
 * comes out the same; a wider or taller picture only leaves room beside or
 * below the board for something else. With a road map, streets and a river
 * are laid on the mat, and buildings and trees keep clear of them.
 */
export function buildTown(inst: Instance, width = SCENE.width, height = SCENE.height, roads: RoadMap | null = null): Town {
  const rng = mulberry32(Math.imul(inst.seed, 2654435761) >>> 0);
  const ground = new Bitmap(width, height);
  ground.rect(0, 0, width, height, ink(PAL.table));
  drawBoard(ground, inst.seed);
  const covered = roads ? drawRoads(ground, roads) : null;
  /** How much of a street or of the river lies under the foot of a box. */
  const underfoot = (box: Box) => {
    let count = 0;
    for (let y = box.y + box.h - 3; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) if (covered && covered.get(x, y) !== NONE) count++;
    }
    return count;
  };

  const spots = inst.nodes.map(place);
  const around = (spot: Spot): Box => ({ x: spot.x - 5, y: spot.y - 5, w: 11, h: 11 });
  const taken: Box[] = [];
  const scenery: Thing[] = [];
  const homes: Town['homes'] = [];
  const boxes: Box[] = [];

  spots.forEach((spot, node) => {
    const picture = node === DEPOT ? depot() : house(PAL.roofs[Math.floor(rng() * PAL.roofs.length)], rng() < 0.4);
    const mirrored = rng() < 0.5;
    // A building stands just behind its stop, and steps aside rather than cover a neighbour's.
    const boxAt = (shift: number, back = 0): Box => ({
      x: spot.x + shift - Math.floor(picture.width / 2),
      y: spot.y - 4 - back - picture.height + 1,
      w: picture.width,
      h: picture.height,
    });
    const fits = (box: Box) =>
      !spots.some((other, at) => at !== node && overlap(box, around(other))) && !taken.some((other) => overlap(box, other));
    let box = boxAt([0, -6, 6, -10, 10].find((shift) => fits(boxAt(shift))) ?? 0);
    if (covered) {
      // Among the places that fit, the one whose foot is least on a street or in the river.
      const places = [0, 2, 4, 6].flatMap((back) => [0, -3, 3, -6, 6, -9, 9].map((shift) => boxAt(shift, back))).filter(fits);
      box = places.reduce((best, candidate) => (underfoot(candidate) < underfoot(best) ? candidate : best), places[0] ?? box);
    }
    const foot = box.y + box.h - 1;
    taken.push({ x: box.x - 1, y: box.y - 1, w: box.w + 2, h: box.h + 2 });
    scenery.push({ picture, x: box.x, foot, mirrored: node !== DEPOT && mirrored, node });
    homes.push({ x: box.x + Math.floor(picture.width / 2), top: box.y });
    boxes.push(box);
  });

  // Trees fill the gaps, clear of the stops and of the buildings.
  for (let tries = 0, planted = 0; tries < 300 && planted < 10; tries++) {
    const picture = tree(rng() < 0.45);
    const x = ORIGIN.x + 4 + Math.floor(rng() * (MAT.width - 12));
    const foot = ORIGIN.y + 12 + Math.floor(rng() * (MAT.height - 16));
    const box = { x: x - 2, y: foot - picture.height - 1, w: picture.width + 4, h: picture.height + 4 };
    if (spots.some((spot) => overlap(box, around(spot))) || taken.some((other) => overlap(box, other))) continue;
    if (underfoot({ x, y: foot - 3, w: picture.width, h: 4 }) > 0) continue;
    taken.push(box);
    scenery.push({ picture, x, foot });
    planted++;
  }

  scenery.sort((a, b) => a.foot - b.foot);
  for (const thing of scenery) castShadow(ground, thing);
  return { width, height, ground, scenery, spots, homes, boxes };
}

export type Segment = readonly [Spot, Spot];

export interface Strokes {
  core: Bitmap;
  edged: Bitmap;
}

/** Lines of one kind, edged with another colour so that they hold on any ground. */
export function strokes(
  town: Town,
  segments: readonly Segment[],
  colour: string,
  edge: string,
  options: { brush?: number; dash?: [number, number]; phase?: number } = {},
): Strokes {
  const brush = options.brush ?? 2;
  const back = Math.floor(brush / 2);
  const core = new Bitmap(town.width, town.height);
  for (const [a, b] of segments) {
    core.line(a.x - back, a.y - back, b.x - back, b.y - back, ink(colour), brush, options.dash, options.phase);
  }
  return { core, edged: core.outlined(ink(edge)) };
}

/** The stretches of thread between the stops of some edges. */
export const between = (town: Town, edges: readonly Edge[]): Segment[] => edges.map(([from, to]): Segment => [town.spots[from], town.spots[to]]);

export const closed = (tour: readonly number[]): Edge[] => tour.map((from, i): Edge => [from, tour[(i + 1) % tour.length]]);
export const sameEdge = (a: Edge, b: Edge) => (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

/**
 * Stacks the layers of a picture: ground, lines, things, then what must never
 * be hidden. Where a building or a tree covers a line, the line shows through
 * as dots. `things` replaces the town's scenery when it is being moved about;
 * `moving` adds what is not part of the scenery, such as a truck: a truck
 * drives on top of the lines, which never show through it.
 */
export function compose(town: Town, layers: { lines: Strokes[]; things?: Thing[]; moving?: Thing[]; overlay: Bitmap }): Bitmap {
  const picture = new Bitmap(town.width, town.height);
  picture.pixels.set(town.ground.pixels);
  const moving = layers.moving ?? [];
  for (const thing of moving) castShadow(picture, thing);
  for (const line of layers.lines) picture.paste(line.edged);

  // What stands in front is painted last. Alongside, note where the thing on top is a truck.
  const standing = new Bitmap(town.width, town.height);
  const truckOnTop = new Uint8Array(town.width * town.height);
  const things = [...(layers.things ?? town.scenery), ...moving].sort((a, b) => a.foot - b.foot);
  for (const thing of things) {
    const { width, height } = thing.picture;
    const top = thing.foot - height + 1;
    const isTruck = moving.includes(thing) ? 1 : 0;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const colour = thing.picture.get(thing.mirrored ? width - 1 - i : i, j);
        const x = thing.x + i;
        const y = top + j;
        if (colour === NONE || x < 0 || y < 0 || x >= town.width || y >= town.height) continue;
        standing.pixels[y * town.width + x] = colour;
        truckOnTop[y * town.width + x] = isTruck;
      }
    }
  }
  picture.paste(standing);

  for (const line of layers.lines) {
    for (let at = 0; at < picture.pixels.length; at++) {
      const colour = line.core.pixels[at];
      if (colour !== NONE && standing.pixels[at] !== NONE && truckOnTop[at] === 0) {
        const x = at % town.width;
        const y = (at - x) / town.width;
        if ((x + y) % 2 === 0) picture.pixels[at] = colour;
      }
    }
  }
  picture.paste(layers.overlay);
  return picture;
}

/** Puts a picture with its middle on a spot. */
export const centred = (onto: Bitmap, picture: Bitmap, spot: Spot) =>
  onto.paste(picture, spot.x - Math.floor(picture.width / 2), spot.y - Math.floor(picture.height / 2));
