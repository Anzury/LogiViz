import { Bitmap, PAL, badge, ink, widthOf, write } from './kit';
import type { Box } from './town';

/**
 * The search tree of a branch and bound, drawn flat on a board: the depot at
 * the top, one column per first house, and under each column one square per
 * second house. A family still open is a full square in the colour of the
 * search; an abandoned one shrinks to a small grey stub.
 */

export interface TreeView {
  /** How many houses the town has; they are numbered from 1, as on the map. */
  houses: number;
  /** The families examined so far: how their tours begin (depot first), and whether they were abandoned. */
  branches: readonly { path: number[]; cut: boolean }[];
  /** The best tour known, whose way down the tree is highlighted. */
  best: number[] | null;
  /** The family being examined right now. */
  focus: number[] | null;
  open: string;
  bestColour: string;
}

const starts = (path: readonly number[] | null, first: number, second?: number) =>
  path !== null && path[1] === first && (second === undefined || path[2] === second);

export function drawSearchTree(picture: Bitmap, frame: Box, view: TreeView): void {
  const { x, y, w, h } = frame;
  picture.rect(x + 3, y + 4, w, h, ink(PAL.tableShade));
  picture.rect(x - 1, y - 1, w + 2, h + 2, ink(PAL.rimDark));
  picture.rect(x, y, w, h, ink(PAL.rim));
  picture.rect(x, y, w, 1, ink(PAL.rimLight));
  picture.rect(x, y, 1, h, ink(PAL.rimLight));
  picture.rect(x + 3, y + 3, w - 6, h - 6, ink(PAL.board));

  const left = x + 7;
  const top = y + 7;
  const column = Math.max(8, Math.min(15, Math.floor((w - 14 - 12) / view.houses)));
  const row = Math.max(6, Math.min(9, Math.floor((h - 14 - 36) / view.houses)));
  const across = (house: number) => left + 12 + (house - 1) * column + Math.floor(column / 2);
  const down = (house: number) => top + 36 + (house - 1) * row + Math.floor(row / 2);
  const text = ink(PAL.boardText);
  const faint = ink(PAL.boardLine);
  const wire = ink(PAL.travel);

  const family = (first: number, second?: number) =>
    view.branches.find((branch) => branch.path.length === (second === undefined ? 2 : 3) && starts(branch.path, first, second));

  // The root and the bar every first choice hangs from.
  const middle = Math.round((across(1) + across(view.houses)) / 2);
  picture.rect(across(1), top + 11, across(view.houses) - across(1) + 1, 1, wire);
  picture.rect(middle, top + 8, 1, 3, wire);
  const root = badge('D', PAL.paper);
  picture.paste(root, middle - Math.floor(root.width / 2), top);

  // A square of one family: full when it is still open, a stub when it was abandoned.
  const square = (cx: number, cy: number, size: number, found: { cut: boolean } | undefined, onBest: boolean, focused: boolean) => {
    const half = Math.floor(size / 2);
    if (focused) picture.frame(cx - half - 2, cy - half - 2, size + 4, size + 4, ink(PAL.paper));
    if (!found) {
      picture.set(cx, cy, faint);
    } else if (found.cut && !onBest) {
      picture.rect(cx - 1, cy - 1, 3, 3, wire);
    } else {
      picture.rect(cx - half - 1, cy - half - 1, size + 2, size + 2, ink(PAL.line));
      picture.rect(cx - half, cy - half, size, size, ink(onBest ? view.bestColour : view.open));
    }
  };

  for (let first = 1; first <= view.houses; first++) {
    const cx = across(first);
    const label = String(first);
    write(picture, cx - Math.floor(widthOf(label) / 2), top + 14, label, text);
    picture.rect(cx, top + 11, 1, 3, wire);

    const head = family(first);
    const divided = head !== undefined && !head.cut;
    // A family that was divided grows a trunk, with a twig for each second house.
    if (divided) picture.rect(cx, top + 30, 1, down(view.houses) - (top + 30) + 1, faint);
    square(cx, top + 25, 5, head, starts(view.best, first), view.focus !== null && view.focus.length === 2 && starts(view.focus, first));

    for (let second = 1; second <= view.houses; second++) {
      if (second === first) continue;
      const leaf = family(first, second);
      if (!leaf && !divided) continue;
      square(cx, down(second), 3, leaf, starts(view.best, first, second), view.focus !== null && view.focus.length > 2 && starts(view.focus, first, second));
    }
  }

  // The second house of a family reads on the left, row by row.
  for (let second = 1; second <= view.houses; second++) {
    const label = String(second);
    write(picture, left + 9 - widthOf(label), down(second) - 2, label, text);
  }
}
