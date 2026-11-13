import type { Landscape } from '../core/landscape';
import { Bitmap, PAL, ink, mix, sprite } from './kit';
import { BOARD, blankBoard, type Spot } from './town';

/**
 * The toy landscape of the annealing chapter, as terraces seen from the front
 * and a little from above: the higher a terrace, the further up the screen it
 * is pushed, and its front face shows below it. Pits are good solutions.
 */

/** Terraces from the bottom of the deepest pit to the rim. */
const LEVELS = 8;
/** Pixels a terrace rises above the one below. */
const RISE = 3;
/** Side of a square of ground, in pixels. */
const CELL = 4;

/** From the bottom of a pit to the rim: deep water-green to pale sand. */
const SHADES = ['#3e6c76', '#4e8684', '#6aa089', '#8eb98d', '#b3cb97', '#d1d6a3', '#e3dab3', '#f1e7cd'];

export interface Relief {
  /** Table, board and terraces. */
  ground: Bitmap;
  /** Where on the picture something standing at a point of the landscape appears. */
  at(point: { x: number; y: number }): Spot;
}

export function buildRelief(land: Landscape, width: number, height: number): Relief {
  const ground = blankBoard(width, height, land.seed);
  const mat = { x: BOARD.x + 5, y: BOARD.y + 5, width: BOARD.width - 10, height: BOARD.height - 16 };
  const columns = Math.floor(mat.width / CELL);
  const rows = Math.floor(mat.height / CELL);
  const levelAt = (x: number, y: number) => Math.min(LEVELS - 1, Math.max(0, Math.floor(land.height(x, y) * LEVELS)));
  const level = (column: number, row: number) => levelAt((column + 0.5) / columns, (row + 0.5) / rows);

  // From the back of the board to the front, so that nearer terraces cover what stands behind them.
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const here = level(column, row);
      const x = mat.x + column * CELL;
      const top = mat.y + row * CELL - here * RISE;
      const shade = SHADES[here];
      ground.rect(x, top, CELL, CELL, ink(shade));
      ground.rect(x, top + CELL, CELL, here * RISE, ink(mix(shade, PAL.line, 0.32)));
      // A thin dark edge where the ground steps down to the left or towards the back.
      if (column > 0 && level(column - 1, row) < here) ground.rect(x, top, 1, CELL, ink(mix(shade, PAL.line, 0.18)));
      if (row > 0 && level(column, row - 1) > here) ground.rect(x, top, CELL, 1, ink(mix(shade, PAL.line, 0.14)));
    }
  }

  return {
    ground,
    at: ({ x, y }) => ({
      x: mat.x + Math.round(Math.min(Math.max(x, 0), 1) * (columns * CELL - 1)),
      y: mat.y + Math.round(Math.min(Math.max(y, 0), 1) * (rows * CELL - 1)) - levelAt(x, y) * RISE,
    }),
  };
}

/** The marble that rolls on the landscape; small and pale for a place it is only considering. */
export function marble(colour: string, considered = false): Bitmap {
  return considered
    ? sprite(['.o.', 'oPo', '.o.'], { o: PAL.line, P: PAL.paper })
    : sprite(['.ooo.', 'oGCCo', 'oCCCo', 'oCCDo', '.ooo.'], { o: PAL.line, C: colour, G: mix(colour, '#ffffff', 0.55), D: mix(colour, PAL.line, 0.3) });
}

/** A flag planted on the best place found so far. */
export function flag(): Bitmap {
  return sprite(['oooo.', 'oFFFo', 'oFFo.', 'ooo..', 'o....', 'o....', 'o....'], { o: PAL.line, F: PAL.best });
}
