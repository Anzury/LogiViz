import type { DynamicEvent } from '../core/dynamic';
import { DEPOT, type Point } from '../core/instance';
import type { RoadEvent } from '../core/roads';
import { DAY_START } from '../core/timeWindows';
import type { City } from '../story/city';
import { seedsFor } from '../story/opening';
import { worldStudy, type WorldStudy } from '../story/worldStudy';
import { describeDynamic, describeRoad, dwellDynamic, dwellRoad, km, percent, typo } from './format';
import type { ChapterModule, Host } from './module';
import { Player } from './player';
import { COLOR, all, bind, drawScoreboard, one } from './ui';

type Line = [Point, Point];
const last = <T>(items: T[]) => items[items.length - 1];

/**
 * Chapter 8, "Le monde réel": streets instead of straight lines, the search
 * for the shortest way, and a morning where orders arrive while the truck is
 * already out.
 */
export class World implements ChapterModule {
  private city!: City;
  private data!: WorldStudy;
  /** Which visiting order is shown along the streets. */
  private order: 'crow' | 'road' = 'road';

  private readonly searchPlayer: Player<RoadEvent>;
  private readonly livePlayer: Player<DynamicEvent>;

  readonly steps: Record<string, () => void> = {
    streets: () => {
      this.stage();
      this.host.scene.paintPins([]);
      this.host.scene.setGroundLines([]);
      this.host.scene.setTruck(null);
      this.host.hud('Rues ouvertes', String(this.data.map.edges.filter((edge) => edge.kind !== 'lane').length));
    },
    crow: () => {
      // Straight as the crow flies in grey, the real way round in blue.
      const { scene } = this.host;
      const { from, to, road } = this.data.pair;
      this.stage();
      scene.setThread({ tour: [from, to], closed: false, color: COLOR.muted });
      scene.setPins([from, to], COLOR.algo);
      scene.setGroundLines([{ color: COLOR.algo, bold: true, segments: this.way(from, to) }]);
      scene.setTruck(null);
      this.host.hud('Par la route', km(road));
    },
    dijkstra: () => {
      this.stage();
      this.searchPlayer.render();
      if (this.searchPlayer.atStart) this.searchPlayer.play();
    },
    byroad: () => {
      this.stage();
      this.showOrder();
    },
    live: () => {
      this.stage();
      this.livePlayer.render();
      if (this.livePlayer.atStart) this.livePlayer.play();
    },
    beyond: () => {
      this.stage();
      this.showDay(last(this.data.live));
    },
  };

  constructor(private readonly host: Host) {
    this.searchPlayer = new Player<RoadEvent>(one('[data-player="dijkstra"]'), {
      show: (ev) => this.showSearch(ev),
      caption: (ev) => typo(describeRoad(ev)),
      dwell: dwellRoad,
    });
    this.livePlayer = new Player<DynamicEvent>(one('[data-player="live"]'), {
      show: (ev) => this.showDay(ev),
      caption: (ev) => typo(describeDynamic(ev, DAY_START)),
      dwell: dwellDynamic,
      milestone: (ev) => ev.kind === 'dyn-order',
    });
    document.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'order-crow' || action === 'order-road') {
        this.order = action === 'order-crow' ? 'crow' : 'road';
        host.enter('byroad', true);
      }
    });
  }

  leave(): void {
    this.searchPlayer.pause();
    this.livePlayer.pause();
    this.host.scene.setParcels(null);
  }

  setCity(city: City): void {
    const seeds = seedsFor(city);
    this.city = city;
    this.data = worldStudy(city, seeds.roads, seeds.orders);
    this.order = 'road';
    this.searchPlayer.load(this.data.search);
    this.livePlayer.load(this.data.live);
    this.renderTexts();
  }

  // --------------------------------------------------------------- scene

  /** Every step of the chapter happens on the street map, seen like the earlier chapters. */
  private stage(): void {
    const { scene } = this.host;
    scene.setView('work');
    scene.setRoadMap(this.data.map);
    scene.setThread(null);
  }

  /** The streets from one place of the town to another, as stretches to draw. */
  private way(from: number, to: number): Line[] {
    const points = this.data.table.path(from, to).map((node) => this.data.map.nodes[node]);
    return points.slice(1).map((point, i): Line => [points[i], point]);
  }

  /** A sequence of places joined by the streets between them. */
  private route(stops: number[]): Line[] {
    return stops.slice(1).flatMap((stop, i) => this.way(stops[i], stop));
  }

  private showSearch(ev: RoadEvent): void {
    const { scene } = this.host;
    const { map, pair } = this.data;
    const street = ([a, b]: [number, number]): Line => [map.nodes[a], map.nodes[b]];
    const found = ev.kind === 'dj-done' ? ev.path.slice(1).map((node, i): Line => [map.nodes[ev.path[i]], map.nodes[node]]) : [];
    scene.setThread(null);
    scene.setPins([pair.from, pair.to], COLOR.algo);
    scene.setTruck(null);
    scene.setGroundLines([
      { color: COLOR.algo, segments: ev.reached.map(street) },
      { color: COLOR.best, bold: true, segments: found },
    ]);
    this.host.hud(ev.kind === 'dj-done' ? 'Plus court chemin' : 'Carrefours traités', ev.kind === 'dj-done' ? km(ev.dist) : String(ev.reached.length));
    all('[data-code="dijkstra"] li').forEach((line, i) => line.classList.toggle('is-current', i === ev.line));
  }

  /** One of the two visiting orders, driven along the streets. */
  private showOrder(): void {
    const { scene } = this.host;
    const { tour, cost } = this.order === 'crow' ? this.data.crow : this.data.road;
    const color = this.order === 'crow' ? COLOR.muted : COLOR.algo;
    scene.setPins(tour, color);
    scene.setGroundLines([{ color, bold: true, segments: this.route([...tour, DEPOT]) }]);

    // The truck follows every corner of the route but only stops at the houses.
    const loop: Point[] = [];
    const stops: boolean[] = [];
    tour.forEach((stop, i) => {
      const nodes = this.data.table.path(stop, tour[(i + 1) % tour.length]);
      nodes.slice(0, -1).forEach((node, k) => {
        loop.push(this.data.map.nodes[node]);
        stops.push(k === 0);
      });
    });
    scene.driveAlong(loop, stops, color);
    this.host.hud(this.order === 'crow' ? 'Ordre à vol d’oiseau' : 'Ordre par la route', km(cost));
    one('[data-action="order-crow"]').setAttribute('aria-pressed', String(this.order === 'crow'));
    one('[data-action="order-road"]').setAttribute('aria-pressed', String(this.order === 'road'));
  }

  /** The morning as it stands: what is delivered, what is planned, what nobody knows about yet. */
  private showDay(ev: DynamicEvent): void {
    const { scene } = this.host;
    const { inst } = this.city;
    const pins: (string | null)[] = inst.nodes.map(() => null);
    for (const node of ev.served) pins[node] = COLOR.muted;
    for (const node of ev.plan) pins[node] = COLOR.algo;
    scene.paintPins(pins, ev.kind === 'dyn-order' ? ev.node : ev.at === DEPOT ? null : ev.at);
    // A pile of parcels marks an order that is known and not delivered yet.
    scene.setParcels(this.parcels, ev.plan);
    scene.setGroundLines([
      { color: COLOR.muted, segments: this.route([DEPOT, ...ev.served, ...(ev.at === DEPOT && ev.served.length > 0 ? [DEPOT] : [])]) },
      { color: COLOR.algo, bold: true, segments: ev.plan.length > 0 ? this.route([ev.at, ...ev.plan, DEPOT]) : [] },
    ]);
    scene.parkTruck(inst.nodes[ev.at]);
    this.host.hud('Kilomètres roulés', km(ev.driven));
    all('[data-code="live"] li').forEach((line, i) => line.classList.toggle('is-current', i === ev.line));
  }

  /** One parcel in front of every house; which piles are out changes as the morning goes. */
  private parcelsFor: { city: City; demand: number[] } | null = null;
  private get parcels(): number[] {
    if (this.parcelsFor?.city !== this.city) {
      this.parcelsFor = { city: this.city, demand: this.city.inst.nodes.map((_, node) => (node === DEPOT ? 0 : 1)) };
    }
    return this.parcelsFor.demand;
  }

  private renderTexts(): void {
    const { pair, crow, road, live } = this.data;
    const times = (pair.road / pair.straight).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
    bind('crowStatus', `Entre ces deux maisons, il y a ${km(pair.straight)} à vol d’oiseau, mais ${km(pair.road)} par la route : ${times} fois plus.`);

    drawScoreboard(
      one('[data-scoreboard="roads"]'),
      [
        { label: 'Ordre idéal à vol d’oiseau, suivi par la route', cost: crow.cost, color: COLOR.muted },
        { label: 'Ordre idéal par la route', cost: road.cost, color: COLOR.algo },
      ],
      null,
    );
    const saved = 1 - road.cost / crow.cost;
    bind(
      'roadNote',
      saved < 0.0005
        ? `Dans cette ville, l’ordre idéal est le même à vol d’oiseau et par la route : ${km(road.cost)} dans les deux cas. Ce n’est pas la règle : essaie une nouvelle ville.`
        : `Suivre par la route l’ordre idéal à vol d’oiseau coûte ${km(crow.cost)}. En comptant en rues dès le départ, ${km(road.cost)} suffisent : ${percent(saved)} de moins.`,
    );

    const start = live[0];
    const done = last(live);
    bind('liveKnown', String(start.plan.length));
    bind('liveLate', String(start.kind === 'dyn-start' ? start.late.length : 0));
    drawScoreboard(
      one('[data-scoreboard="live"]'),
      [
        { label: 'Commandes découvertes en route', cost: done.driven, color: COLOR.algo },
        { label: 'Toutes les commandes connues dès le matin', cost: road.cost, color: COLOR.best },
      ],
      road.cost,
    );
    const price = done.driven / road.cost - 1;
    bind(
      'liveNote',
      price < 0.0005
        ? 'Ce matin-là, découvrir les commandes en route n’a rien coûté : le livreur a eu de la chance.'
        : `Ne pas connaître les commandes à l’avance a coûté ${km(done.driven - road.cost)}, soit ${percent(price)} de plus que le meilleur trajet possible en sachant tout dès le matin.`,
    );
  }
}
