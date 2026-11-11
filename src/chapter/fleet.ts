import { planCost, routeCost, routeLoad, type FleetEvent, type Route } from '../core/fleet';
import { DEPOT } from '../core/instance';
import { mulberry32 } from '../core/rng';
import { randomTour } from '../core/tour';
import type { Edge } from '../core/trace';
import type { City } from '../story/city';
import { fleetStudy, type FleetStudy } from '../story/fleetStudy';
import { seedsFor } from '../story/opening';
import { count, describeFleet, dwellFleet, km, parcels, percent, typo } from './format';
import type { ChapterModule, Host } from './module';
import { Player } from './player';
import { COLOR, all, bind, drawFleet, drawScoreboard, one, truckColor } from './ui';

/** A route ready to be drawn: which truck it is, and whether it has driven back yet. */
interface Painted {
  nodes: number[];
  color: string;
  name: string;
  closed: boolean;
}

type Algo = 'cut' | 'savings' | 'relocate';
const LABEL: Record<Algo, string> = {
  cut: 'Grande tournée découpée',
  savings: 'Économies',
  relocate: 'Après déplacements',
};

const last = <T>(items: T[]) => items[items.length - 1];
/** Where a truck currently is: its latest house, or the depot if it has not left. */
const whereabouts = (nodes: number[]) => (nodes.length > 0 ? nodes[nodes.length - 1] : DEPOT);
const truckName = (index: number) => `Camion ${index + 1}`;

/**
 * Chapter 4, "Plusieurs camions": parcels and capacity turn one tour into a
 * fleet. The reader shares the houses out by hand, then watches three methods:
 * cutting the big tour, Clarke and Wright's savings, and relocating houses.
 */
export class Fleet implements ChapterModule {
  private city!: City;
  private data!: FleetStudy;
  /** For each event of the savings trace, the truck number of every route id that has one. */
  private savedTrucks: Map<number, number>[] = [];
  private user: { routes: number[][]; done: boolean; message: string } = { routes: [[]], done: false, message: '' };
  private optimumShown = false;

  private readonly players: Record<Algo, Player<FleetEvent>>;

  readonly steps: Record<string, () => void> = {
    capacity: () => {
      const { scene } = this.host;
      const { demand } = this.data.problem;
      scene.setView('work');
      scene.setParcels(demand);
      scene.setFleet([]);
      scene.setThread({ tour: this.city.optimum.tour, closed: true, color: COLOR.muted });
      scene.paintPins([]);
      scene.setTruck(null);
      this.host.hud('Colis à livrer', String(demand.reduce((sum, n) => sum + n, 0)));
    },
    'fleet-draw': () => {
      const { scene } = this.host;
      scene.setView('draw');
      scene.setParcels(this.data.problem.demand);
      this.renderUser();
      scene.setPicking({ pick: (node) => this.pick(node), hover: (node) => this.previewPick(node) });
    },
    cut: () => this.play('cut'),
    savings: () => this.play('savings'),
    relocate: () => this.play('relocate'),
    'fleet-result': () => {
      this.host.scene.setView('work');
      this.host.scene.setParcels(this.data.problem.demand);
      this.optimumShown = false;
      this.renderResult();
    },
  };

  constructor(private readonly host: Host) {
    const player = (algo: Algo, milestone?: (ev: FleetEvent) => boolean) =>
      new Player<FleetEvent>(one(`[data-player="${algo}"]`), {
        show: (ev, index) => this.showEvent(ev, index, algo),
        caption: (ev) => typo(describeFleet(ev, this.data.problem)),
        dwell: dwellFleet,
        milestone,
      });
    this.players = {
      cut: player('cut'),
      savings: player('savings', (ev) => ev.kind === 'cw-merge'),
      relocate: player('relocate'),
    };
    this.bindActions();
  }

  leave(): void {
    for (const player of Object.values(this.players)) player.pause();
  }

  setCity(city: City): void {
    this.city = city;
    this.data = fleetStudy(city, seedsFor(city).demands);
    this.user = { routes: [[]], done: false, message: '' };

    // During the savings run a route becomes a numbered truck once it serves two
    // houses, taking the lowest free number; a route absorbed by a merge gives
    // its number back. At the end, trucks left with a single house get one too.
    this.savedTrucks = [];
    const numbers = new Map<number, number>();
    this.data.saved.forEach((ev, k) => {
      const settled = k === this.data.saved.length - 1;
      for (const id of [...numbers.keys()]) {
        if (!ev.routes.some((route) => route.id === id)) numbers.delete(id);
      }
      for (const route of ev.routes) {
        if (numbers.has(route.id) || (!settled && route.nodes.length < 2)) continue;
        const taken = new Set(numbers.values());
        let free = 0;
        while (taken.has(free)) free++;
        numbers.set(route.id, free);
      }
      this.savedTrucks.push(new Map(numbers));
    });

    this.players.cut.load(this.data.cut);
    this.players.savings.load(this.data.saved);
    this.players.relocate.load(this.data.moved);
    this.renderTexts();
  }

  // --------------------------------------------------------------- scene

  /**
   * Gives each route its truck number and colour. `numbers` maps route ids to
   * truck numbers; a route without one (a single house the savings have not
   * merged yet) stays grey and unnamed.
   */
  private paint(routes: Route[], numbers: Map<number, number>, open: number | null = null): Painted[] {
    return routes.map((route) => {
      const truck = numbers.get(route.id);
      return {
        nodes: route.nodes,
        color: truck === undefined ? COLOR.muted : truckColor(truck),
        name: truck === undefined ? '' : truckName(truck),
        closed: route.id !== open,
      };
    });
  }

  private show(painted: Painted[], current: number | null, drive: boolean): void {
    const { scene } = this.host;
    scene.setThread(null);
    scene.setFleet(painted);
    const pins: (string | null)[] = this.data.problem.inst.nodes.map(() => null);
    for (const route of painted) {
      for (const node of route.nodes) pins[node] = route.color;
    }
    scene.paintPins(pins, current);
    const driving = painted.filter((route) => route.nodes.length > 0);
    scene.setTrucks(drive ? driving.map((route) => ({ tour: [DEPOT, ...route.nodes], color: route.color })) : []);
  }

  /** The truck list beside the model. Trucks not yet named are counted rather than listed. */
  private list(name: string, painted: Painted[]): void {
    const { problem } = this.data;
    const lone = painted.filter((route) => route.name === '' && route.nodes.length > 0);
    const rows = painted
      .filter((route) => route.nodes.length > 0 && route.name !== '')
      // By truck number, so a row does not jump around as routes merge.
      .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }))
      .map((route) => ({
        name: route.name,
        color: route.color,
        load: { parcels: routeLoad(problem, route.nodes), capacity: problem.capacity },
        cost: routeCost(problem.inst, route.nodes, !route.closed),
      }));
    const note = lone.length > 0 ? `${count(lone.length, 'camion', 'camions')} ne ${lone.length > 1 ? 'servent' : 'sert'} encore qu’une maison.` : '';
    drawFleet(one(`[data-fleet="${name}"]`), rows, note);
  }

  private play(algo: Algo): void {
    this.host.scene.setView('work');
    this.host.scene.setParcels(this.data.problem.demand);
    this.players[algo].render();
    if (this.players[algo].atStart) this.players[algo].play();
  }

  /** Translates one fleet event into coloured threads, pins, truck list and readout. */
  private showEvent(ev: FleetEvent, index: number, algo: Algo): void {
    const { scene } = this.host;
    const finished = ev.kind === 'cut-done' || ev.kind === 'cw-done' || ev.kind === 'move-done';
    const numbers =
      algo === 'cut'
        ? new Map(ev.routes.map((route) => [route.id, route.id]))
        : algo === 'savings'
          ? this.savedTrucks[index]
          : last(this.savedTrucks);
    const painted = this.paint(ev.routes, numbers, ev.open);
    let current: number | null = null;
    let ghosts: Edge[] = [];
    let marked: Edge[] = [];
    let accent: Edge[] = [];

    switch (ev.kind) {
      case 'cut-load':
      case 'cut-full':
        current = ev.node;
        break;
      case 'cw-consider':
        ghosts = [[ev.i, ev.j]];
        if (ev.verdict === 'merge') marked = [[DEPOT, ev.i], [DEPOT, ev.j]];
        break;
      case 'cw-merge':
        accent = [[ev.i, ev.j]];
        break;
      case 'move-pick':
        current = ev.node;
        marked = ev.removed;
        ghosts = ev.added;
        break;
      case 'move-apply':
        current = ev.node;
        accent = ev.added;
        break;
    }
    if (algo === 'cut') {
      // The big tour stays visible underneath, so the cuts can be read against it.
      const giant = this.city.optimum.tour;
      ghosts = giant.map((node, i): Edge => [node, giant[(i + 1) % giant.length]]);
    }

    this.show(painted, current, finished);
    scene.setGhosts(ghosts);
    scene.setMarked(marked);
    scene.setAccent(accent);
    this.host.hud(LABEL[algo], km(ev.cost));
    this.list(algo, painted);
    all(`[data-code="${algo}"] li`).forEach((line, i) => line.classList.toggle('is-current', i === ev.line));
  }

  // --------------------------------------------------------------- result

  private renderResult(): void {
    const { moved, optimum } = this.data;
    const ours = last(moved).routes;
    const numbers = last(this.savedTrucks);
    let painted = this.paint(ours, numbers);
    if (this.optimumShown) {
      // A truck the optimum shares with our result keeps its number and colour,
      // so that only what really differs changes on screen.
      const key = (nodes: number[]) => [...nodes].sort((a, b) => a - b).join(',');
      const shared = new Map(ours.map((route) => [key(route.nodes), numbers.get(route.id)]));
      const taken = new Set(optimum.routes.map((nodes) => shared.get(key(nodes))).filter((n) => n !== undefined));
      painted = optimum.routes.map((nodes) => {
        let truck = shared.get(key(nodes));
        if (truck === undefined) {
          truck = 0;
          while (taken.has(truck)) truck++;
          taken.add(truck);
        }
        return { nodes, color: truckColor(truck), name: truckName(truck), closed: true };
      });
    }
    this.show(painted, null, true);
    this.host.hud(this.optimumShown ? 'Répartition optimale' : LABEL.relocate, km(this.optimumShown ? optimum.cost : last(moved).cost));
    this.list('result', painted);
    one('[data-action="fleet-optimum"]').textContent = this.optimumShown
      ? 'Revenir au résultat des déplacements'
      : 'Voir la répartition optimale';
  }

  private renderTexts(): void {
    const { problem, cut, saved, moved, optimum } = this.data;
    const total = problem.demand.reduce((sum, n) => sum + n, 0);
    bind('parcelsTotal', parcels(total));
    bind('truckCapacity', String(problem.capacity));
    bind('trucksMin', count(Math.ceil(total / problem.capacity), 'camion', 'camions'));

    const userCost = this.user.done ? planCost(problem.inst, this.user.routes) : null;
    drawScoreboard(
      one('[data-scoreboard="fleet"]'),
      [
        { label: 'Ta répartition', cost: userCost, color: COLOR.user, soft: true },
        { label: 'Grande tournée découpée', cost: last(cut).cost, color: COLOR.algo, soft: true },
        { label: 'Économies', cost: last(saved).cost, color: COLOR.algo, soft: true },
        { label: 'Économies, puis déplacements', cost: last(moved).cost, color: COLOR.algo },
        { label: 'Répartition optimale', cost: optimum.cost, color: COLOR.best },
      ],
      optimum.cost,
    );

    const done = last(moved);
    const moves = done.kind === 'move-done' ? done.moves : 0;
    bind(
      'relocateNote',
      moves === 0
        ? 'Dans cette ville, aucun déplacement ne fait gagner : les économies avaient déjà bien rangé les maisons.'
        : `Ici, ${count(moves, 'déplacement suffit', 'déplacements suffisent')} à gagner ${km(last(saved).cost - done.cost)}.`,
    );

    const gap = done.cost / optimum.cost - 1;
    const fleet = `La répartition optimale utilise ${count(optimum.routes.length, 'camion', 'camions')}.`;
    bind(
      'fleetNote',
      gap < 0.0005
        ? `Nos méthodes ont trouvé la répartition optimale. ${fleet}`
        : `Notre meilleur résultat reste ${percent(gap)} au-dessus de la répartition optimale. ${fleet}`,
    );
    if (userCost === null) {
      bind('fleetVerdict', 'Tu n’as pas encore fini ta répartition : remonte la terminer pour te mesurer aux algorithmes.');
    } else if (userCost < done.cost - 0.05) {
      bind('fleetVerdict', `Ta répartition fait ${km(done.cost - userCost)} de moins que les algorithmes : bien vu.`);
    } else if (userCost > done.cost + 0.05) {
      bind('fleetVerdict', `Les algorithmes font ${km(userCost - done.cost)} de moins que ta répartition.`);
    } else {
      bind('fleetVerdict', 'Ta répartition fait jeu égal avec les algorithmes.');
    }
  }

  // ---------------------------------------------------------- hand drawing

  private get loading(): number[] {
    return last(this.user.routes);
  }

  private renderUser(): void {
    const { problem } = this.data;
    const { routes, done, message } = this.user;
    const painted: Painted[] = routes.map((nodes, k) => ({
      nodes,
      color: truckColor(k),
      name: truckName(k),
      closed: done || k < routes.length - 1,
    }));
    const here = done ? null : whereabouts(this.loading);
    this.host.scene.setGhosts([]);
    this.show(painted, here, done);
    const cost = painted.reduce((sum, route) => sum + routeCost(problem.inst, route.nodes, !route.closed), 0);
    this.host.hud('Ta répartition', cost > 0 ? km(cost) : '—');
    this.list('draw', painted);

    const delivered = routes.flat().length;
    const houses = problem.inst.nodes.length - 1;
    const fleet = routes.filter((nodes) => nodes.length > 0).length;
    let status = message;
    if (!status) {
      if (done) status = `Tout est livré : ${count(fleet, 'camion', 'camions')}, ${km(cost)} en tout.`;
      else if (delivered === 0) status = 'Un camion attend au dépôt. Clique une première maison.';
      else if (this.loading.length === 0) status = `Le camion est rentré. Un autre attend au dépôt : il reste ${count(houses - delivered, 'maison', 'maisons')}.`;
      else status = `${truckName(routes.length - 1)} : ${routeLoad(problem, this.loading)} colis sur ${problem.capacity}. Il reste ${count(houses - delivered, 'maison', 'maisons')}.`;
    }
    bind('fleetStatus', status);
    one<HTMLButtonElement>('[data-action="fleet-undo"]').disabled = delivered === 0;
    one<HTMLButtonElement>('[data-action="fleet-reset"]').disabled = delivered === 0;
  }

  private fits(node: number): boolean {
    const { problem } = this.data;
    return routeLoad(problem, this.loading) + problem.demand[node] <= problem.capacity;
  }

  private previewPick(node: number | null): void {
    const { problem } = this.data;
    const waiting = node !== null && node !== DEPOT && !this.user.done && !this.user.routes.flat().includes(node);
    const free = waiting && this.fits(node);
    this.host.scene.setGhosts(free ? [[whereabouts(this.loading), node]] : []);
    // The piles are small: say in words what the hovered house has ordered.
    bind(
      'fleetHint',
      !waiting
        ? 'Survole une maison pour voir sa commande.'
        : `Cette maison attend ${parcels(problem.demand[node])}${free ? '.' : ' : trop pour ce camion.'}`,
    );
  }

  private pick(node: number): void {
    const { problem } = this.data;
    const user = this.user;
    if (user.done) return;
    user.message = '';
    if (node === DEPOT) {
      // Clicking the depot sends the truck home and brings out the next one.
      if (this.loading.length > 0) user.routes.push([]);
    } else if (user.routes.flat().includes(node)) {
      return;
    } else if (!this.fits(node)) {
      const load = routeLoad(problem, this.loading);
      user.message = `Ce camion transporte déjà ${load} colis sur ${problem.capacity} : les ${parcels(problem.demand[node])} de cette maison n’y tiennent pas. Clique le dépôt pour le faire rentrer.`;
    } else {
      this.loading.push(node);
      user.done = user.routes.flat().length === problem.inst.nodes.length - 1;
    }
    this.userChanged();
  }

  private userChanged(): void {
    this.renderTexts();
    if (this.host.active() === 'fleet-draw') this.renderUser();
  }

  // ------------------------------------------------------------- actions

  private bindActions(): void {
    const actions: Record<string, () => void> = {
      'fleet-undo': () => {
        const user = this.user;
        user.done = false;
        user.message = '';
        if (this.loading.length === 0 && user.routes.length > 1) user.routes.pop();
        this.loading.pop();
        this.userChanged();
      },
      'fleet-reset': () => {
        this.user = { routes: [[]], done: false, message: '' };
        this.userChanged();
      },
      'fleet-random': () => {
        // A random order of the houses, loaded truck after truck.
        const { problem } = this.data;
        const routes: number[][] = [[]];
        for (const node of randomTour(problem.inst, mulberry32(Date.now())).slice(1)) {
          if (routeLoad(problem, last(routes)) + problem.demand[node] > problem.capacity) routes.push([]);
          last(routes).push(node);
        }
        this.user = { routes, done: true, message: '' };
        this.userChanged();
      },
      'fleet-optimum': () => {
        this.optimumShown = !this.optimumShown;
        this.renderResult();
      },
    };
    document.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action) actions[action]?.();
    });
  }
}
