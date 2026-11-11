import { describe, expect, it } from 'vitest';
import { dynamicDay, type DynamicEvent } from './dynamic';
import { heldKarp } from './heldKarp';
import { DEPOT, generateInstance } from './instance';
import { distanceToLine, generateRoads, roadTable, searchRoad, shortestPaths } from './roads';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const last = <T>(items: T[]) => items[items.length - 1];
const town = (seed: number) => {
  const inst = generateInstance(seed);
  const map = generateRoads(inst, seed);
  return { inst, map, table: roadTable(inst, map) };
};

describe('generateRoads', () => {
  it('is reproducible, and gives every house a lane to the street grid', () => {
    for (const seed of SEEDS) {
      const { inst, map } = town(seed);
      expect(generateRoads(inst, seed)).toEqual(map);
      expect(map.place).toHaveLength(inst.nodes.length);
      map.place.forEach((node, k) => {
        expect(map.nodes[node]).toEqual(inst.nodes[k]);
        expect(map.edges.filter((edge) => edge.kind === 'lane' && edge.a === node)).toHaveLength(1);
      });
    }
  });

  it('has exactly two bridges, the only streets that cross the river', () => {
    const side = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    for (const seed of SEEDS) {
      const { map } = town(seed);
      expect(map.edges.filter((edge) => edge.kind === 'bridge')).toHaveLength(2);
      for (const edge of map.edges) {
        const [p, q] = [map.nodes[edge.a], map.nodes[edge.b]];
        const crossing = map.river.some((r, i) => {
          const s = map.river[i + 1];
          return s !== undefined && side(r, s, p) * side(r, s, q) < 0 && side(p, q, r) * side(p, q, s) < 0;
        });
        expect(crossing).toBe(edge.kind === 'bridge');
      }
    }
  });

  it('keeps the river off the houses and the whole town in one piece', () => {
    for (const seed of SEEDS) {
      const { inst, map } = town(seed);
      for (const house of inst.nodes) expect(distanceToLine(house, map.river)).toBeGreaterThan(0);
      const { dist } = shortestPaths(map, map.place[DEPOT]);
      for (const value of dist) expect(value).toBeLessThan(Infinity);
    }
  });
});

describe('roadTable', () => {
  it('measures symmetric distances that are never shorter than the straight line', () => {
    for (const seed of SEEDS) {
      const { inst, table } = town(seed);
      for (let a = 0; a < inst.nodes.length; a++) {
        expect(table.inst.dist[a][a]).toBe(0);
        for (let b = a + 1; b < inst.nodes.length; b++) {
          expect(table.inst.dist[a][b]).toBeCloseTo(table.inst.dist[b][a], 9);
          expect(table.inst.dist[a][b]).toBeGreaterThanOrEqual(inst.dist[a][b] - 1e-9);
        }
      }
    }
  });

  it('returns ways that follow real streets and add up to the distance', () => {
    const { inst, map, table } = town(4);
    for (let a = 0; a < inst.nodes.length; a++) {
      for (let b = 0; b < inst.nodes.length; b++) {
        const path = table.path(a, b);
        expect(path[0]).toBe(map.place[a]);
        expect(last(path)).toBe(map.place[b]);
        let length = 0;
        for (let i = 0; i + 1 < path.length; i++) {
          const street = map.links[path[i]].find((link) => link.to === path[i + 1]);
          expect(street).toBeDefined();
          length += street!.length;
        }
        expect(length).toBeCloseTo(table.inst.dist[a][b], 9);
      }
    }
  });
});

describe('searchRoad', () => {
  it('finds the same distance as the table, dealing with crossroads nearest first', () => {
    for (const seed of SEEDS) {
      const { map, table } = town(seed);
      const trace = Array.from(searchRoad(map, map.place[3], map.place[9]));
      const done = last(trace);
      expect(done.kind).toBe('dj-done');
      if (done.kind === 'dj-done') {
        expect(done.dist).toBeCloseTo(table.inst.dist[3][9], 9);
        expect(done.path[0]).toBe(map.place[3]);
        expect(last(done.path)).toBe(map.place[9]);
      }
      const order = trace.flatMap((ev) => (ev.kind === 'dj-settle' ? [ev.dist] : []));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });
});

describe('dynamicDay', () => {
  const run = (seed: number) => {
    const { table } = town(seed);
    return { inst: table.inst, trace: Array.from(dynamicDay(table.inst, { seed })) };
  };

  it('delivers every house exactly once and ends at the depot', () => {
    for (const seed of SEEDS) {
      const { inst, trace } = run(seed);
      const done = last(trace);
      expect(done.kind).toBe('dyn-done');
      expect([...done.served].sort((a, b) => a - b)).toEqual(inst.nodes.map((_, node) => node).slice(1));
      expect(done.at).toBe(DEPOT);
      expect(done.plan).toHaveLength(0);
    }
  });

  it('drives exactly the legs it reports, and never beats knowing everything in advance', () => {
    for (const seed of SEEDS) {
      const { inst, trace } = run(seed);
      let driven = 0;
      for (const ev of trace) {
        if (ev.kind === 'dyn-drive') driven += inst.dist[ev.from][ev.to];
        expect(ev.driven).toBeCloseTo(driven, 9);
      }
      expect(last(trace).driven).toBeGreaterThanOrEqual(heldKarp(inst).cost - 1e-9);
    }
  });

  it('never delivers an order before it has come in', () => {
    for (const seed of SEEDS) {
      const { trace } = run(seed);
      const start = trace[0] as Extract<DynamicEvent, { kind: 'dyn-start' }>;
      expect(start.late).toHaveLength(5);
      const release = new Map(start.late.map(({ node, release: at }) => [node, at]));
      for (const ev of trace) {
        if (ev.kind === 'dyn-drive' && release.has(ev.to)) expect(ev.clock).toBeGreaterThanOrEqual(release.get(ev.to)!);
        if (ev.kind === 'dyn-order') expect(ev.clock).toBeGreaterThanOrEqual(ev.release);
      }
    }
  });
});
