/**
 * What follows the reader from one chapter page to the next within a browser
 * tab: which town they are on, and the tour they drew on it in chapter 1.
 * Purely a convenience: every page works without it.
 */
interface Saved {
  seed?: number;
  tour?: { seed: number; nodes: number[] };
}

const KEY = 'logiviz';

function read(): Saved {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

function write(patch: Saved): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    // Storage can be blocked or full; the page then simply forgets between chapters.
  }
}

export const session = {
  /** Seed of the town the reader moved to with "Nouvelle ville", if any. */
  get seed(): number | null {
    return read().seed ?? null;
  },
  set seed(seed: number | null) {
    write({ seed: seed ?? undefined });
  },

  /** The complete tour the reader drew on the town with this seed, if any. */
  userTour(seed: number): number[] | null {
    const tour = read().tour;
    return tour && tour.seed === seed ? tour.nodes : null;
  },
  saveUserTour(seed: number, nodes: number[] | null): void {
    write({ tour: nodes ? { seed, nodes } : undefined });
  },
};
