/**
 * The pixel-art drawing kit: a bitmap to draw on pixel by pixel, a palette
 * split by role, a tiny typeface and the elements of the town. Nothing here
 * knows about tours or timetables.
 */

/** A colour as the four bytes a canvas stores; 0 is "nothing drawn here". */
export type Ink = number;
export const NONE: Ink = 0;

export function ink(hex: string): Ink {
  const n = parseInt(hex.slice(1), 16);
  return (0xff000000 | ((n & 0xff) << 16) | (n & 0xff00) | (n >>> 16)) >>> 0;
}

/** A colour part of the way from one to another. */
export function mix(from: string, to: string, t: number): string {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const channel = (shift: number) => {
    const value = Math.round(((a >> shift) & 0xff) * (1 - t) + ((b >> shift) & 0xff) * t);
    return value.toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/**
 * The palette, split by role. The scenery stays muted and never uses pure
 * white or the line colour as a fill; what carries information is saturated
 * and always edged with the line colour, so it stands out on any ground.
 */
export const PAL = {
  line: '#2b2622',

  // Scenery: table, board, cutting mat.
  table: '#e9e1d3',
  tableShade: '#d6cab6',
  rim: '#c9a26b',
  rimLight: '#dbb984',
  rimSide: '#9c7646',
  rimDark: '#7a5a33',
  mat: '#b4c2a2',
  matLine: '#c6d2b6',
  matShade: '#99a987',
  matFleck: '#a9b896',

  // Scenery: streets and water.
  street: '#efe9dc',
  streetEdge: '#cfc6b2',
  water: '#8fb6cb',
  waterEdge: '#6c97ae',
  waterGlint: '#b3d0de',

  // Scenery: buildings and trees.
  wall: '#efe6d2',
  wallShade: '#d2c4a8',
  door: '#7b5a40',
  glass: '#7189a0',
  glint: '#c9dbe6',
  roofs: ['#d98a6a', '#7d93a8', '#e0b65a', '#c97b84'],
  leaf: '#7f9a6c',
  leafLight: '#9bb384',
  leafDark: '#5f7b55',
  trunk: '#7b5a40',
  slate: '#4a433c',
  slateLight: '#655c53',
  box: '#c9a26b',
  boxTape: '#ead9b4',

  // Information: tours and timetables. A colour says whose tour it is, never
  // how a delivery went: lateness is told with black and stripes.
  paper: '#fffdf6',
  route: '#1f6fd6',
  user: '#de3b34',
  best: '#f2b02e',
  trucks: ['#1f6fd6', '#de3b34', '#f2a71e', '#12a877'],
  muted: '#8f867b',
  board: '#37322d',
  boardLine: '#4d463f',
  boardText: '#eadfcb',
  travel: '#a79c8e',
} as const;

/** The site's series and truck colours, pushed to the saturation that information gets in this look. */
const VIVID: Record<string, string> = {
  '#2c6fb3': PAL.route,
  '#d6453d': PAL.user,
  '#d4a017': PAL.best,
  '#2a78d6': PAL.trucks[0],
  '#e34948': PAL.trucks[1],
  '#eda100': PAL.trucks[2],
  '#1baf7a': PAL.trucks[3],
  // The bound's network of the proof chapter: a grey no tour wears, light enough to stay apart from black threads.
  '#6b6257': '#a79c8e',
};
export const vivid = (colour: string) => VIVID[colour.toLowerCase()] ?? colour;

/** Whether dark writing reads better than light on a colour. */
function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff) > 150;
}

export class Bitmap {
  readonly pixels: Uint32Array<ArrayBuffer>;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Uint32Array(new ArrayBuffer(width * height * 4));
  }

  private has(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Ink {
    return this.has(x, y) ? this.pixels[y * this.width + x] : NONE;
  }

  set(x: number, y: number, colour: Ink): void {
    if (this.has(x, y)) this.pixels[y * this.width + x] = colour;
  }

  rect(x: number, y: number, width: number, height: number, colour: Ink): void {
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) this.set(x + i, y + j, colour);
  }

  /** A rectangle filled with slanted stripes of two colours: the pattern of a warning. */
  stripes(x: number, y: number, width: number, height: number, one: Ink, other: Ink): void {
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) this.set(x + i, y + j, (x + i + y + j) % 4 < 2 ? one : other);
    }
  }

  /** A rectangle drawn as its border only. */
  frame(x: number, y: number, width: number, height: number, colour: Ink): void {
    this.rect(x, y, width, 1, colour);
    this.rect(x, y + height - 1, width, 1, colour);
    this.rect(x, y, 1, height, colour);
    this.rect(x + width - 1, y, 1, height, colour);
  }

  /**
   * A straight line drawn with a square brush. With `dash`, the pen is down
   * for the first number of steps and up for the second, over and over;
   * `phase` starts the pattern part of the way through, to make dashes march.
   */
  line(x0: number, y0: number, x1: number, y1: number, colour: Ink, brush = 1, dash?: [number, number], phase = 0): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let error = dx - dy;
    for (let step = 0; ; step++) {
      if (!dash || (step + phase) % (dash[0] + dash[1]) < dash[0]) this.rect(x0, y0, brush, brush, colour);
      if (x0 === x1 && y0 === y1) break;
      const twice = 2 * error;
      if (twice > -dy) {
        error -= dy;
        x0 += sx;
      }
      if (twice < dx) {
        error += dx;
        y0 += sy;
      }
    }
  }

  /** Copies what another bitmap has drawn, optionally mirrored left to right. */
  paste(other: Bitmap, x = 0, y = 0, mirrored = false): void {
    for (let j = 0; j < other.height; j++) {
      for (let i = 0; i < other.width; i++) {
        const colour = other.get(mirrored ? other.width - 1 - i : i, j);
        if (colour !== NONE) this.set(x + i, y + j, colour);
      }
    }
  }

  /** The part of the picture below its first `rows` rows. */
  withoutTop(rows: number): Bitmap {
    const result = new Bitmap(this.width, this.height - rows);
    result.pixels.set(this.pixels.subarray(rows * this.width));
    return result;
  }

  /** A copy in which everything drawn is surrounded by a one-pixel line. */
  outlined(colour: Ink): Bitmap {
    const result = new Bitmap(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const here = this.get(x, y);
        if (here !== NONE) result.set(x, y, here);
        else if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) result.set(x, y, colour);
      }
    }
    return result;
  }

  show(canvas: HTMLCanvasElement): void {
    // Setting a canvas's size clears it, so only when it really changes.
    if (canvas.width !== this.width) canvas.width = this.width;
    if (canvas.height !== this.height) canvas.height = this.height;
    const image = new ImageData(new Uint8ClampedArray(this.pixels.buffer), this.width, this.height);
    canvas.getContext('2d')!.putImageData(image, 0, 0);
  }
}

/** A small picture typed as rows of characters, each character naming a colour; a dot is empty. */
export function sprite(rows: string[], key: Record<string, string>): Bitmap {
  const bitmap = new Bitmap(rows[0].length, rows.length);
  rows.forEach((row, y) => {
    if (row.length !== bitmap.width) throw new Error(`sprite row ${y} is ${row.length} wide, expected ${bitmap.width}`);
    [...row].forEach((character, x) => {
      if (character === '.') return;
      if (!key[character]) throw new Error(`sprite uses "${character}", which names no colour`);
      bitmap.set(x, y, ink(key[character]));
    });
  });
  return bitmap;
}

// ------------------------------------------------------------ typeface

/** Digits and the few letters the study needs, three pixels wide and five tall. */
const GLYPHS: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  h: ['#..', '#..', '##.', '#.#', '#.#'],
  '-': ['...', '...', '###', '...', '...'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
};

export const widthOf = (text: string) => text.length * 4 - 1;

export function write(bitmap: Bitmap, x: number, y: number, text: string, colour: Ink): void {
  [...text].forEach((character, index) => {
    GLYPHS[character]?.forEach((row, j) => {
      [...row].forEach((mark, i) => {
        if (mark === '#') bitmap.set(x + index * 4 + i, y + j, colour);
      });
    });
  });
}

// ------------------------------------------------------------- scenery

const LINE = PAL.line;

/** A house seen from the front and a little from above: its roof, then its wall. */
export function house(roof: string, small = false): Bitmap {
  const key = {
    o: LINE,
    R: mix(roof, '#ffffff', 0.28),
    r: roof,
    d: mix(roof, LINE, 0.28),
    W: PAL.wall,
    w: PAL.wallShade,
    D: PAL.door,
    G: PAL.glass,
    g: PAL.glint,
  };
  return small
    ? sprite(
        [
          '..ooooooo..',
          '.oRRRRRRRo.',
          'orrrrrrrrro',
          'orrrrrrrrro',
          'odddddddddo',
          'ooooooooooo',
          '.owwwwwwwo.',
          '.oWDDWWGgo.',
          '.oWDDWWGGo.',
          '.ooooooooo.',
        ],
        key,
      )
    : sprite(
        [
          '...ooooooo...',
          '..oRRRRRRRo..',
          '.oRRRRRRRRRo.',
          'orrrrrrrrrrro',
          'orrrrrrrrrrro',
          'odddddddddddo',
          'ooooooooooooo',
          '.owwwwwwwwwo.',
          '.oWGgWWWDDWo.',
          '.oWGGWWWDDWo.',
          '.oWWWWWWDDWo.',
          '.ooooooooooo.',
        ],
        key,
      );
}

/** The depot: wide and low under a dark roof, with a roller door and a flag. */
export function depot(): Bitmap {
  return sprite(
    [
      // The flag and its pole.
      '...ooooo' + '.'.repeat(13),
      '...oFFFo' + '.'.repeat(13),
      '...oFFFo' + '.'.repeat(13),
      '...ooooo' + '.'.repeat(13),
      '...o' + '.'.repeat(17),
      // The roof.
      '..' + 'o'.repeat(17) + '..',
      '.o' + 'S'.repeat(17) + 'o.',
      'o' + 'S'.repeat(19) + 'o',
      'o' + 's'.repeat(19) + 'o',
      'o' + 's'.repeat(19) + 'o',
      'o'.repeat(21),
      // The wall: a sign over the roller door, a window on each side.
      '.o' + 'k'.repeat(17) + 'o.',
      '.oKKK' + 'P'.repeat(11) + 'KKKo.',
      '.oKKK' + 'o'.repeat(11) + 'KKKo.',
      '.oKGKo' + 'H'.repeat(9) + 'oKGKo.',
      '.oKKKo' + 'h'.repeat(9) + 'oKKKo.',
      '.oKKKo' + 'H'.repeat(9) + 'oKKKo.',
      '.' + 'o'.repeat(19) + '.',
    ],
    {
      o: LINE,
      F: PAL.wall,
      S: PAL.slateLight,
      s: PAL.slate,
      k: mix(PAL.rim, LINE, 0.25),
      K: PAL.rim,
      P: PAL.wall,
      G: PAL.glass,
      H: PAL.slate,
      h: PAL.slateLight,
    },
  );
}

export function tree(conifer = false): Bitmap {
  const key = { o: LINE, L: PAL.leafLight, l: PAL.leaf, d: PAL.leafDark, T: PAL.trunk };
  return conifer
    ? sprite(['...o...', '..oLo..', '..olo..', '.oLllo.', '.olldo.', 'oLllldo', 'olldddo', '.ooToo.', '..oTo..', '..ooo..'], key)
    : sprite(['..ooo..', '.oLLlo.', 'oLLlllo', 'olllldo', 'olllddo', '.odddo.', '..oTo..', '..ooo..'], key);
}

/** A parcel waiting to be delivered. */
export function parcel(): Bitmap {
  return sprite(['ooooo', 'oPtPo', 'oPtPo', 'oPtPo', 'ooooo'], { o: LINE, P: PAL.box, t: PAL.boxTape });
}

/** A pile of parcels, two wide, as many as were ordered. */
export function parcels(count: number): Bitmap {
  const rows = Math.ceil(count / 2);
  const pile = new Bitmap(count > 1 ? 9 : 5, rows * 4 + 1);
  const box = parcel();
  for (let k = 0; k < count; k++) pile.paste(box, (k % 2) * 4, (rows - 1 - Math.floor(k / 2)) * 4);
  return pile;
}

// --------------------------------------------------------- information

export type Heading = 'side' | 'away' | 'towards';

/**
 * A truck whose cab takes the colour of its tour: seen from the side (driving
 * to the right), from behind as it drives away up the board, or from the front.
 */
export function truck(colour: string, heading: Heading = 'side'): Bitmap {
  const key = { o: LINE, B: PAL.paper, b: PAL.wallShade, C: colour, G: PAL.glint, K: PAL.slateLight };
  if (heading === 'side') {
    return sprite(
      ['.ooooooo.....', 'oBBBBBBBo....', 'oBBBBBBBoooo.', 'oBBBBBBBoCGGo', 'obbbbbbboCCCo', 'ooooooooooooo', '.oKKo...oKKo.', '..oo.....oo..'],
      key,
    );
  }
  return heading === 'towards'
    ? sprite(
        ['.ooooooo.', 'oBBBBBBBo', 'obbbbbbbo', 'ooooooooo', 'oCGGGGGCo', 'oCCCCCCCo', 'oGCCCCCGo', 'ooooooooo', '.oKo.oKo.', '..o...o..'],
        key,
      )
    : sprite(
        ['.ooooooo.', 'oBBBoBBBo', 'oBBBoBBBo', 'oBBBoBBBo', 'obbbobbbo', 'oCbbbbbCo', 'ooooooooo', '.oKo.oKo.', '..o...o..'],
        key,
      );
}

/** The mark of a stop on the ground: a disc, empty until a tour comes through; larger when it matters now. */
export function stop(fill: string, large = false): Bitmap {
  const key = { o: LINE, F: fill };
  return large
    ? sprite(['..ooo..', '.oFFFo.', 'oFFFFFo', 'oFFFFFo', 'oFFFFFo', '.oFFFo.', '..ooo..'], key)
    : sprite(['.ooo.', 'oFFFo', 'oFFFo', 'oFFFo', '.ooo.'], key);
}

/** An arrow pointing down at the place where things are happening. */
export function pointer(fill: string): Bitmap {
  return sprite(['ooooooo', 'oFFFFFo', '.oFFFo.', '..oFo..', '...o...'], { o: LINE, F: fill });
}

/** A short text on a coloured tag: the rank of a stop on the colour of its truck, an hour, a letter. */
export function badge(text: string, fill: string, textColour = isLight(fill) ? LINE : PAL.paper, edge: string = LINE): Bitmap {
  const width = widthOf(text) + 4;
  const bitmap = new Bitmap(width, 9);
  bitmap.rect(1, 0, width - 2, 9, ink(edge));
  bitmap.rect(0, 1, width, 7, ink(edge));
  bitmap.rect(1, 1, width - 2, 7, ink(fill));
  write(bitmap, 2, 2, text, ink(textColour));
  return bitmap;
}

/**
 * A house's time window at a glance: the day as a dark strip, the window as
 * its light stretch, and a needle where the truck arrives, in the colour of
 * that truck. The needle inside the light stretch is on time, before it the
 * driver waits, after it he is late: the needle is then striped black.
 */
export function gauge(day: [number, number], window: [number, number], needle?: { at: number; colour: string; late?: boolean }): Bitmap {
  const inner = 18;
  const bitmap = new Bitmap(inner + 2, 7);
  const at = (minute: number) => 1 + Math.round(((Math.min(Math.max(minute, day[0]), day[1]) - day[0]) / (day[1] - day[0])) * (inner - 1));
  bitmap.rect(0, 1, inner + 2, 5, ink(LINE));
  bitmap.rect(1, 2, inner, 3, ink(PAL.slateLight));
  bitmap.rect(at(window[0]), 2, at(window[1]) - at(window[0]) + 1, 3, ink(PAL.paper));
  if (needle) {
    // The needle sticks out above and below the strip, so it is found at once.
    const x = Math.min(at(needle.at), inner - 1);
    bitmap.rect(x - 1, 0, 4, 7, ink(LINE));
    if (needle.late) for (let row = 1; row < 6; row++) bitmap.rect(x, row, 2, 1, ink(row % 2 ? PAL.paper : LINE));
    else bitmap.rect(x, 1, 2, 5, ink(needle.colour));
  }
  return bitmap;
}
