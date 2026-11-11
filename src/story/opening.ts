import { buildCity, tellsFullStory, type City } from './city';
import { findDemandSeed } from './fleetStudy';
import { findLnsSeed, findWindowSeed, timedStudy } from './timedStudy';
import { findOrderSeed, findRoadSeed } from './worldStudy';

/**
 * The town every chapter opens on, and the draws that make each chapter tell
 * its whole story there. Searching for them takes a noticeable moment, so the
 * result is frozen here instead of being recomputed on every page load;
 * `opening.test.ts` fails if the algorithms change and these go stale, and
 * prints the values to paste back.
 */
export const OPENING = { city: 8, demands: 23, windows: 8, lns: 8, roads: 9, orders: 9 };

/** The search that `OPENING` is the frozen result of. */
export function findOpening(): typeof OPENING {
  let seed = 1;
  let city = buildCity(seed);
  while (!city || !tellsFullStory(city)) city = buildCity(++seed);
  const windows = findWindowSeed(city);
  const roads = findRoadSeed(city);
  return {
    city: seed,
    demands: findDemandSeed(city),
    windows,
    lns: findLnsSeed(city, timedStudy(city, windows)),
    roads,
    orders: findOrderSeed(city, roads),
  };
}

/** Which draws a chapter should use for a town: the curated ones on the opening town, the town's own seed elsewhere. */
export function seedsFor(city: City): Omit<typeof OPENING, 'city'> {
  const seed = city.inst.seed;
  return seed === OPENING.city ? OPENING : { demands: seed, windows: seed, lns: seed, roads: seed, orders: seed };
}
