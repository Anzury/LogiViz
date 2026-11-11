import { mulberry32 } from './rng';

/**
 * A toy search landscape: a smooth height function over the unit square with a
 * handful of basins of different depths. It stands in for the (far larger,
 * many-dimensional) space of tours, so that "going down" and "getting stuck"
 * can be watched directly. The walks below are real algorithms run on it.
 */
export interface Landscape {
  seed: number;
  /** Height in [0, 1] at a point of the unit square. */
  height(x: number, y: number): number;
  /** The bottom of every basin, deepest first. */
  minima: Spot[];
}

export interface Spot {
  x: number;
  y: number;
  height: number;
}

interface Basin {
  x: number;
  y: number;
  depth: number;
  radius: number;
}

export function generateLandscape(seed: number, basinCount = 6): Landscape {
  const rng = mulberry32(seed);
  const basins: Basin[] = [];
  let gap = 0.3;
  let misses = 0;
  while (basins.length < basinCount) {
    const x = 0.16 + rng() * 0.68;
    const y = 0.16 + rng() * 0.68;
    if (basins.every((b) => Math.hypot(b.x - x, b.y - y) >= gap)) {
      const depth = basins.length === 0 ? 1 : 0.42 + rng() * 0.34;
      basins.push({ x, y, depth, radius: 0.085 + rng() * 0.04 });
      misses = 0;
    } else if (++misses > 200) {
      gap *= 0.92;
      misses = 0;
    }
  }

  // A shallow bowl keeps the rim high; each basin digs a Gaussian pit into it.
  const raw = (x: number, y: number) => {
    let value = 1.3 * ((x - 0.5) ** 2 + (y - 0.5) ** 2);
    for (const b of basins) value -= b.depth * Math.exp(-((x - b.x) ** 2 + (y - b.y) ** 2) / (2 * b.radius ** 2));
    return value;
  };
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i <= 100; i++) {
    for (let j = 0; j <= 100; j++) {
      const value = raw(i / 100, j / 100);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  const height = (x: number, y: number) => 0.03 + 0.97 * Math.min(Math.max((raw(x, y) - low) / (high - low), 0), 1);

  const minima = basins.map((b) => settle(height, b.x, b.y)).sort((a, b) => a.height - b.height);
  return { seed, height, minima };
}

/** Slides a point to the bottom of the basin it sits in (pattern search). */
function settle(height: Landscape['height'], x: number, y: number): Spot {
  let here: Spot = { x, y, height: height(x, y) };
  for (let step = 0.02; step > 1e-5; ) {
    let moved = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = Math.min(Math.max(here.x + dx * step, 0), 1);
      const ny = Math.min(Math.max(here.y + dy * step, 0), 1);
      const value = height(nx, ny);
      if (value < here.height) {
        here = { x: nx, y: ny, height: value };
        moved = true;
      }
    }
    if (!moved) step /= 2;
  }
  return here;
}

/** The basin bottom closest to a point: which pit a ball ended up in. */
export function nearestMinimum(land: Landscape, spot: { x: number; y: number }): Spot {
  return land.minima.reduce((best, m) =>
    Math.hypot(m.x - spot.x, m.y - spot.y) < Math.hypot(best.x - spot.x, best.y - spot.y) ? m : best,
  );
}

export interface WalkOptions {
  seed: number;
  /** 0 gives a ball that only ever rolls down; above 0 it is simulated annealing. */
  startTemperature: number;
  iterations?: number;
  /** Length of one step, as a fraction of the board's side. */
  step?: number;
}

interface WalkState {
  /** Where the ball is once this event has happened. */
  at: Spot;
  /** Lowest spot visited so far. */
  best: Spot;
  temperature: number;
}

export type WalkEvent =
  | (WalkState & { kind: 'start' })
  | (WalkState & {
      kind: 'step';
      candidate: Spot;
      /** Height change of the proposed step; positive means uphill. */
      delta: number;
      probability: number;
      accepted: boolean;
    })
  | (WalkState & { kind: 'end'; steps: number });

const END_TEMPERATURE = 0.002;
/** A cold ball that has been refused this many steps in a row is at the bottom of a pit. */
const STUCK_AFTER = 20;

/**
 * A ball taking random steps on the landscape. Downhill steps are always taken;
 * uphill ones with probability exp(−Δ/T), where T cools down geometrically.
 * At temperature 0 this is plain descent, which stops in the first pit it finds.
 */
export function* wander(land: Landscape, start: { x: number; y: number }, options: WalkOptions): Generator<WalkEvent> {
  const { seed, startTemperature, step = 0.07 } = options;
  const hot = startTemperature > 0;
  const iterations = options.iterations ?? (hot ? 900 : 2000);
  const cooling = hot ? (END_TEMPERATURE / startTemperature) ** (1 / iterations) : 1;
  const rng = mulberry32(seed);

  let at: Spot = { x: start.x, y: start.y, height: land.height(start.x, start.y) };
  let best = at;
  let temperature = startTemperature;
  let refused = 0;
  let steps = 0;

  yield { kind: 'start', at, best, temperature };

  for (; steps < iterations && (hot || refused < STUCK_AFTER); steps++) {
    let x: number;
    let y: number;
    do {
      const angle = rng() * Math.PI * 2;
      x = at.x + Math.cos(angle) * step;
      y = at.y + Math.sin(angle) * step;
    } while (x < 0 || x > 1 || y < 0 || y > 1);

    const candidate: Spot = { x, y, height: land.height(x, y) };
    const delta = candidate.height - at.height;
    const probability = delta <= 0 ? 1 : hot ? Math.exp(-delta / temperature) : 0;
    const accepted = delta <= 0 || rng() < probability;
    if (accepted) {
      at = candidate;
      refused = 0;
      if (at.height < best.height) best = at;
    } else {
      refused++;
    }
    yield { kind: 'step', at, best, temperature, candidate, delta, probability, accepted };
    temperature *= cooling;
  }

  yield { kind: 'end', at, best, temperature, steps };
}
