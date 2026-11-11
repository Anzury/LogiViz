import { dynamicDay, type DynamicEvent } from '../core/dynamic';
import { heldKarp } from '../core/heldKarp';
import { generateRoads, roadTable, searchRoad, type RoadEvent, type RoadMap, type RoadTable } from '../core/roads';
import { tourCost } from '../core/tour';
import type { City, Solution } from './city';

const last = <T>(items: T[]) => items[items.length - 1];

/** Everything chapter 8 computes for one town, one street network and one morning of orders. */
export interface WorldStudy {
  map: RoadMap;
  table: RoadTable;
  /** The two places the streets keep furthest apart, compared with the straight line between them. */
  pair: { from: number; to: number; straight: number; road: number };
  /** The search for the shortest way between those two. */
  search: RoadEvent[];
  /** The visiting order that is best as the crow flies, measured along the streets. */
  crow: Solution;
  /** The visiting order that is best along the streets. */
  road: Solution;
  /** A morning where five orders come in while the truck is out. */
  live: DynamicEvent[];
}

export function worldStudy(city: City, roadSeed: number, orderSeed: number): WorldStudy {
  const map = generateRoads(city.inst, roadSeed);
  const table = roadTable(city.inst, map);
  const byRoad = table.inst.dist;

  let pair = { from: 0, to: 1, straight: city.inst.dist[0][1], road: byRoad[0][1] };
  for (let a = 0; a < city.inst.nodes.length; a++) {
    for (let b = a + 1; b < city.inst.nodes.length; b++) {
      const straight = city.inst.dist[a][b];
      // Neighbours a stone's throw apart would win on ratio alone and show nothing.
      if (straight >= 12 && byRoad[a][b] / straight > pair.road / pair.straight) pair = { from: a, to: b, straight, road: byRoad[a][b] };
    }
  }

  return {
    map,
    table,
    pair,
    search: Array.from(searchRoad(map, map.place[pair.from], map.place[pair.to])),
    crow: { tour: city.optimum.tour, cost: tourCost(table.inst, city.optimum.tour) },
    road: heldKarp(table.inst),
    live: Array.from(dynamicDay(table.inst, { seed: orderSeed })),
  };
}

/**
 * A street network that tells chapter 8's story on a town: two places the river
 * keeps far apart, and a best order by road that differs from the best order as
 * the crow flies.
 */
export function findRoadSeed(city: City): number {
  const first = city.inst.seed;
  for (let seed = first; seed < first + 100; seed++) {
    const study = worldStudy(city, seed, first);
    if (study.pair.road >= study.pair.straight * 2.5 && study.crow.cost >= study.road.cost * 1.04) return seed;
  }
  return first;
}

/** A morning of orders where not knowing them in advance costs something, without ruining the day. */
export function findOrderSeed(city: City, roadSeed: number): number {
  const first = city.inst.seed;
  for (let seed = first; seed < first + 100; seed++) {
    const study = worldStudy(city, roadSeed, seed);
    const price = last(study.live).driven / study.road.cost;
    const idle = study.live.some((ev) => ev.kind === 'dyn-wait');
    if (price >= 1.08 && price <= 1.4 && !idle) return seed;
  }
  return first;
}
