import { planCost, type Route } from '../core/fleet';
import { DEPOT } from '../core/instance';
import { schedule, type TimedEvent, type TimedProblem } from '../core/timeWindows';
import { showTimedPlan, timedRows, truckName, type Painted } from './timedView';
import type { City } from '../story/city';
import { seedsFor } from '../story/opening';
import { timedStudy, type TimedStudy } from '../story/timedStudy';
import { count, describeTimed, dwellTimed, hour, km, minutes, percent, span, typo } from './format';
import type { ChapterModule, Host } from './module';
import { Player } from './player';
import { COLOR, all, bind, drawFleet, drawScoreboard, one, truckColor } from './ui';


type Algo = 'clock' | 'insertion' | 'tw-relocate';
const LABEL: Record<Algo, string> = {
  clock: 'Horloge',
  insertion: 'Insertion',
  'tw-relocate': 'Après retouches',
};

const last = <T>(items: T[]) => items[items.length - 1];

/**
 * Chapter 5, "Être à l'heure": time windows. The model tilts and height becomes
 * time, so a round turns into a path climbing through each house's window.
 */
export class Hours implements ChapterModule {
  private city!: City;
  private data!: TimedStudy;
  private user: { routes: number[][]; done: boolean; message: string } = { routes: [[]], done: false, message: '' };
  private optimumShown = false;

  private readonly players: Record<Algo, Player<TimedEvent>>;

  readonly steps: Record<string, () => void> = {
    hours: () => {
      // Seen from above: the windows exist, but nothing shows whether a tour respects them.
      const { scene } = this.host;
      this.stage('draw', false);
      scene.setTracks([]);
      scene.setThread({ tour: this.city.optimum.tour, closed: true, color: COLOR.muted });
      scene.paintPins([]);
      this.clearPaths();
      scene.setLabels(this.windowLabels());
      this.host.hud('Départ du dépôt', hour(this.data.problem.open[DEPOT]));
    },
    tilt: () => {
      const { scene } = this.host;
      const { problem } = this.data;
      this.stage('time', true);
      scene.setThread(null);
      scene.setTracks([{ nodes: this.city.optimum.tour.slice(1), color: COLOR.muted, closed: true }]);
      scene.paintPins([]);
      this.clearPaths();
      scene.setLabels(this.windowLabels());
      this.host.hud('Matinée', `${hour(problem.open[DEPOT])} – ${hour(problem.close[DEPOT])}`);
    },
    late: () => this.play('clock'),
    'tw-draw': () => {
      this.stage('timeDraw', true);
      this.renderUser();
      this.host.scene.setPicking({ pick: (node) => this.pick(node), hover: (node) => this.previewPick(node) });
    },
    insertion: () => this.play('insertion'),
    'tw-relocate': () => this.play('tw-relocate'),
    'tw-result': () => {
      this.stage('time', true);
      this.optimumShown = false;
      this.renderResult();
    },
  };

  constructor(private readonly host: Host) {
    const player = (algo: Algo) =>
      new Player<TimedEvent>(one(`[data-player="${algo}"]`), {
        show: (ev) => this.showEvent(ev, algo),
        caption: (ev) => typo(describeTimed(ev, this.data.problem)),
        dwell: dwellTimed,
      });
    this.players = { clock: player('clock'), insertion: player('insertion'), 'tw-relocate': player('tw-relocate') };
    this.bindActions();
  }

  leave(): void {
    for (const player of Object.values(this.players)) player.pause();
  }

  setCity(city: City): void {
    this.city = city;
    this.data = timedStudy(city, seedsFor(city).windows);
    this.user = { routes: [[]], done: false, message: '' };
    this.players.clock.load(this.data.clock);
    this.players.insertion.load(this.data.inserted);
    this.players['tw-relocate'].load(this.data.moved);
    this.renderTexts();
  }

  // --------------------------------------------------------------- scene

  /** Common set-up of the chapter's steps: the camera, the masts, flat or raised. */
  private stage(view: 'draw' | 'time' | 'timeDraw', raised: boolean): void {
    const { scene } = this.host;
    const { problem } = this.data;
    scene.setView(view);
    scene.setWindows(this.windows(problem));
    scene.timeline.setRaised(raised);
    scene.setFleet([]);
    scene.setTruck(null);
  }

  /** The same array for the same problem, so the scene only rebuilds its masts when the town changes. */
  private windowsFor: { problem: TimedProblem; list: { open: number; close: number }[] } | null = null;
  private windows(problem: TimedProblem): { open: number; close: number }[] {
    if (this.windowsFor?.problem !== problem) {
      this.windowsFor = { problem, list: problem.open.map((open, node) => ({ open, close: problem.close[node] })) };
    }
    return this.windowsFor.list;
  }

  private windowLabels(only?: number): { node: number; time: number; text: string }[] {
    const { open, close } = this.data.problem;
    return open
      .map((start, node) => ({ node, time: close[node], text: span(start, close[node]) }))
      .filter(({ node }) => node !== DEPOT && (only === undefined || node === only));
  }

  private clearPaths(): void {
    const { timeline } = this.host.scene;
    timeline.setPaths([]);
    timeline.setWaits([]);
    timeline.setLate([]);
    timeline.setBeads([]);
  }

  private show(painted: Painted[], current: number | null): void {
    showTimedPlan(this.host.scene, this.data.problem, painted, current);
  }

  private paint(routes: Route[], open: number | null = null): Painted[] {
    return routes.map((route) => ({
      nodes: route.nodes,
      color: truckColor(route.id),
      name: truckName(route.id),
      closed: route.id !== open,
    }));
  }

  /** The truck list beside the model: when each truck is back, and how long it waited. */
  private list(name: string, painted: Painted[]): void {
    drawFleet(one(`[data-fleet="${name}"]`), timedRows(this.data.problem, painted));
  }

  private play(algo: Algo): void {
    this.stage('time', true);
    this.players[algo].render();
    if (this.players[algo].atStart) this.players[algo].play();
  }

  private showEvent(ev: TimedEvent, algo: Algo): void {
    const painted = this.paint(ev.routes, ev.open);
    let current: number | null = null;
    let readout = km(ev.cost);
    switch (ev.kind) {
      case 'clock-visit':
        current = ev.stop.node;
        readout = hour(ev.stop.arrive);
        break;
      case 'clock-done':
        readout = hour(ev.back);
        break;
      case 'clock-start':
        readout = hour(this.data.problem.open[DEPOT]);
        break;
      case 'ins-consider':
      case 'ins-place':
      case 'move-pick':
      case 'move-apply':
        current = ev.node;
        break;
    }
    this.show(painted, current);
    // Only the house being dealt with keeps its label, so the paths stay readable.
    this.host.scene.setLabels(current === null ? [] : this.windowLabels(current));
    this.host.hud(LABEL[algo], readout);
    if (algo !== 'clock') this.list(algo, painted);
    all(`[data-code="${algo}"] li`).forEach((line, i) => line.classList.toggle('is-current', i === ev.line));
  }

  // --------------------------------------------------------------- result

  private renderResult(): void {
    const { moved, optimum } = this.data;
    const painted: Painted[] = this.optimumShown
      ? optimum.routes.map((nodes, k) => ({ nodes, color: truckColor(k), name: truckName(k), closed: true }))
      : this.paint(last(moved).routes);
    this.show(painted, null);
    this.host.scene.setLabels([]);
    this.host.hud(this.optimumShown ? 'Répartition optimale' : LABEL['tw-relocate'], km(this.optimumShown ? optimum.cost : last(moved).cost));
    this.list('tw-result', painted);
    one('[data-action="tw-optimum"]').textContent = this.optimumShown
      ? 'Revenir au résultat des retouches'
      : 'Voir la répartition optimale';
  }

  private renderTexts(): void {
    const { problem, clock, inserted, moved, optimum } = this.data;
    const houses = problem.inst.nodes.length - 1;
    const done = last(clock);
    const late = done.kind === 'clock-done' ? done.late : 0;
    bind(
      'twLateNote',
      late === 0
        ? 'Dans cette ville, les créneaux sont assez larges : la tournée la plus courte est à l’heure partout.'
        : `La tournée la plus courte arrive trop tard chez ${count(late, 'client', 'clients')} sur ${houses}.`,
    );

    const before = last(inserted).cost;
    const after = last(moved).cost;
    bind(
      'twRelocateNote',
      after < before - 0.05
        ? `Ici, les retouches font passer le total de ${km(before)} à ${km(after)}, sans mettre personne en retard.`
        : 'Dans cette ville, aucune retouche ne raccourcit le plan sans mettre quelqu’un en retard.',
    );

    const userCost = this.user.done ? planCost(problem.inst, this.user.routes) : null;
    drawScoreboard(
      one('[data-scoreboard="hours"]'),
      [
        { label: 'Ta répartition', cost: userCost, color: COLOR.user, soft: true },
        { label: 'Insertion', cost: before, color: COLOR.algo, soft: true },
        { label: 'Insertion, puis retouches', cost: after, color: COLOR.algo },
        { label: 'Répartition optimale', cost: optimum.cost, color: COLOR.best },
      ],
      optimum.cost,
    );

    const gap = after / optimum.cost - 1;
    const fleet = `Elle utilise ${count(optimum.routes.length, 'camion', 'camions')}.`;
    bind(
      'twNote',
      gap < 0.0005
        ? `Les retouches ont trouvé la répartition optimale. ${fleet}`
        : `Après retouches, il reste ${percent(gap)} d’écart avec la répartition optimale. ${fleet}`,
    );
    if (userCost === null) {
      bind('twVerdict', 'Tu n’as pas encore fini ta répartition : remonte la terminer pour te mesurer aux algorithmes.');
    } else if (userCost < after - 0.05) {
      bind('twVerdict', `Ta répartition fait ${km(after - userCost)} de moins que les algorithmes, à l’heure partout : bien vu.`);
    } else if (userCost > after + 0.05) {
      bind('twVerdict', `Les algorithmes font ${km(userCost - after)} de moins que ta répartition.`);
    } else {
      bind('twVerdict', 'Ta répartition fait jeu égal avec les algorithmes.');
    }
  }

  // ---------------------------------------------------------- hand drawing

  private get loading(): number[] {
    return last(this.user.routes);
  }

  /** What would happen at `node` if the truck now loading went there next. */
  private visit(node: number) {
    return last(schedule(this.data.problem, [...this.loading, node]).stops);
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
    const here = done ? null : this.loading.length > 0 ? last(this.loading) : DEPOT;
    this.show(painted, here);
    this.host.scene.setLabels(this.windowLabels());
    const cost = painted.reduce(
      (sum, route) => sum + planCost(problem.inst, [route.nodes]) - (route.closed || route.nodes.length === 0 ? 0 : problem.inst.dist[last(route.nodes)][DEPOT]),
      0,
    );
    this.host.hud('Ta répartition', cost > 0 ? km(cost) : '—');
    this.list('tw-draw', painted);

    const delivered = routes.flat().length;
    const left = count(problem.inst.nodes.length - 1 - delivered, 'maison', 'maisons');
    const fleet = routes.filter((nodes) => nodes.length > 0).length;
    let status = message;
    if (!status) {
      if (done) status = `Tout le monde est livré à l’heure : ${count(fleet, 'camion', 'camions')}, ${km(cost)}.`;
      else if (delivered === 0) status = `Un camion attend au dépôt, il est ${hour(problem.open[DEPOT])}. Clique une première maison.`;
      else if (this.loading.length === 0) status = `Le camion est rentré. Un autre part à ${hour(problem.open[DEPOT])} : il reste ${left}.`;
      else {
        const clock = last(schedule(problem, this.loading).stops).leave;
        status = `${truckName(routes.length - 1)} : il est ${hour(clock)}. Il reste ${left}.`;
      }
    }
    bind('twStatus', status);
    one<HTMLButtonElement>('[data-action="tw-undo"]').disabled = delivered === 0;
    one<HTMLButtonElement>('[data-action="tw-reset"]').disabled = delivered === 0;
  }

  private previewPick(node: number | null): void {
    const { problem } = this.data;
    if (node === null || node === DEPOT || this.user.done || this.user.routes.flat().includes(node)) {
      bind('twHint', 'Survole une maison pour voir quand ce camion y serait.');
      return;
    }
    const stop = this.visit(node);
    const outcome = stop.late > 0 ? ' : trop tard.' : stop.wait >= 1 ? `, et attendrait ${minutes(stop.wait)}.` : '.';
    bind('twHint', `Créneau ${span(problem.open[node], problem.close[node])}. Ce camion y serait à ${hour(stop.arrive)}${outcome}`);
  }

  private pick(node: number): void {
    const { problem } = this.data;
    const user = this.user;
    if (user.done) return;
    user.message = '';
    if (node === DEPOT) {
      // Clicking the depot sends the truck home; the next one starts the day afresh.
      if (this.loading.length > 0) user.routes.push([]);
    } else if (user.routes.flat().includes(node)) {
      return;
    } else {
      const stop = this.visit(node);
      if (stop.late > 0) {
        user.message = `Ce camion y serait à ${hour(stop.arrive)}, mais le créneau ferme à ${hour(problem.close[node])}. Choisis une autre maison, ou clique le dépôt pour sortir un autre camion.`;
      } else {
        this.loading.push(node);
        user.done = user.routes.flat().length === problem.inst.nodes.length - 1;
      }
    }
    this.userChanged();
  }

  private userChanged(): void {
    this.renderTexts();
    if (this.host.active() === 'tw-draw') this.renderUser();
  }

  // ------------------------------------------------------------- actions

  private bindActions(): void {
    const actions: Record<string, () => void> = {
      'tw-undo': () => {
        const user = this.user;
        user.done = false;
        user.message = '';
        if (this.loading.length === 0 && user.routes.length > 1) user.routes.pop();
        this.loading.pop();
        this.userChanged();
      },
      'tw-reset': () => {
        this.user = { routes: [[]], done: false, message: '' };
        this.userChanged();
      },
      'tw-optimum': () => {
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
