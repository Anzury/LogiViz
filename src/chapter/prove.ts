import { branchAndBound, type BranchEvent } from '../core/branchBound';
import type { Branch } from '../scene/searchTree';
import type { City, Solution } from '../story/city';
import { count, describeBranch, dwellBranch, km, percent, typo } from './format';
import type { ChapterModule, Host } from './module';
import { Player } from './player';
import { StepChart } from './stepChart';
import { showTour } from './tourView';
import { COLOR, all, bind, drawScoreboard, one } from './ui';

/** How many houses deep the search is narrated and its tree drawn; it goes much deeper. */
const DETAIL = 2;
/** The bound's network of threads: a dark warm grey that no tour wears. */
const NETWORK = '#6b6257';

const last = <T>(items: T[]) => items[items.length - 1];
const whole = (n: number) => n.toLocaleString('fr-FR');

function factorial(n: number): number {
  let product = 1;
  for (let k = 2; k <= n; k++) product *= k;
  return product;
}

/**
 * Chapter 7, "Prouver qu'on ne peut pas faire mieux": a lower bound, families
 * of tours, and a branch and bound whose search tree grows above the town.
 */
export class Prove implements ChapterModule {
  private city!: City;
  /** Which tour the search starts from: the best one known, or the nearest-neighbour one. */
  private source: 'best' | 'nn' = 'best';
  private trace: BranchEvent[] = [];
  /** The families drawn in the tree, each with the index of the event that examined it. */
  private branches: (Branch & { at: number })[] = [];
  /** Index of the event used to show one cut on its own. */
  private example = 0;
  private timer: number | undefined;

  private readonly player: Player<BranchEvent>;
  private readonly chart: StepChart;

  readonly steps: Record<string, () => void> = {
    doubt: () => {
      const { tour, cost } = this.start;
      this.map();
      showTour(this.host, tour, COLOR.algo, 'Meilleure connue', cost);
    },
    bound: () => {
      // The tour, then the shortest network: same houses, fewer rules, shorter.
      const { scene } = this.host;
      const root = this.trace[0];
      const { tour, cost } = this.start;
      this.map();
      scene.setTruck(null);
      scene.paintPins([]);
      let network = false;
      const show = () => {
        if (root.kind !== 'bb-start') return;
        scene.setThread(network ? null : { tour, closed: true, color: COLOR.algo });
        scene.setNetwork(network ? root.tree : [], NETWORK);
        this.host.hud(network ? 'Plus court réseau' : 'Meilleure connue', km(network ? root.bound : cost));
        bind(
          'bbBoundStatus',
          network
            ? `Le plus court réseau : ${km(root.bound)}. Fourches et bouts de fil y sont permis.`
            : `Une tournée : ${km(cost)}. Chaque maison y a exactement deux fils.`,
        );
        network = !network;
      };
      show();
      this.timer = window.setInterval(show, 2600);
    },
    branch: () => {
      // The first level only: one family per first house, none judged yet.
      const { scene } = this.host;
      this.tilt();
      scene.setThread(null);
      scene.setNetwork([], NETWORK);
      scene.paintPins([]);
      scene.setTruck(null);
      scene.tree.show(
        this.branches.filter((branch) => branch.path.length === 2).map((branch) => ({ ...branch, cut: false })),
        null,
        null,
      );
      this.host.hud('Meilleure connue', km(this.start.cost));
    },
    prune: () => {
      this.tilt();
      this.showEvent(this.trace[this.example], this.example);
    },
    bnb: () => {
      this.tilt();
      this.player.render();
      if (this.player.atStart) this.player.play();
    },
    proof: () => {
      const done = last(this.trace);
      this.map();
      showTour(this.host, done.bestTour, COLOR.best, 'Tournée optimale', done.best);
    },
  };

  constructor(private readonly host: Host) {
    this.player = new Player<BranchEvent>(one('[data-player="bb"]'), {
      show: (ev, index) => this.showEvent(ev, index),
      caption: (ev) => typo(describeBranch(ev)),
      dwell: dwellBranch,
      milestone: (ev) => ev.kind === 'bb-best',
      speed: 1,
    });
    this.chart = new StepChart(
      one('[data-chart="bb"]'),
      (index) => {
        host.enter('bnb');
        this.player.seek(index);
      },
      112,
    );
    document.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'bb-source-best' || action === 'bb-source-nn') {
        this.source = action === 'bb-source-nn' ? 'nn' : 'best';
        this.run();
        host.enter('bnb', true);
      }
    });
  }

  leave(): void {
    this.player.pause();
    window.clearInterval(this.timer);
  }

  setCity(city: City): void {
    this.city = city;
    this.source = 'best';
    this.run();
  }

  /** The tour the search starts from. */
  private get start(): Solution {
    return this.source === 'nn' ? this.city.nnResult : this.city.annealed;
  }

  private run(): void {
    this.trace = Array.from(branchAndBound(this.city.inst, this.start, DETAIL));
    this.branches = this.trace.flatMap((ev, at) =>
      ev.kind === 'bb-node' && ev.path.length > 1 ? [{ at, path: ev.path, cut: ev.pruned }] : [],
    );
    // The cut shown on its own: the first family abandoned with two houses fixed, else the first abandoned.
    const cuts = this.trace.flatMap((ev, at) => (ev.kind === 'bb-node' && ev.pruned ? [{ at, depth: ev.path.length - 1 }] : []));
    this.example = (cuts.find((c) => c.depth === DETAIL) ?? cuts[0])?.at ?? 0;

    this.player.load(this.trace);
    const done = last(this.trace);
    const orders = done.kind === 'bb-done' ? done.orders : 1;
    this.chart.setData({
      values: this.trace.map((ev) => (ev.ruledOut / orders) * 100),
      color: COLOR.algo,
      unit: '%',
      format: (value) => percent(value / 100),
      name: 'Part des ordres de visite écartés',
    });
    one('[data-action="bb-source-best"]').setAttribute('aria-pressed', String(this.source === 'best'));
    one('[data-action="bb-source-nn"]').setAttribute('aria-pressed', String(this.source === 'nn'));
    this.renderTexts();
  }

  // --------------------------------------------------------------- scene

  /** The map view, tree folded away. */
  private map(): void {
    const { scene } = this.host;
    scene.setView('work');
    scene.tree.setRaised(false);
    scene.setNetwork([], NETWORK);
  }

  /** The low view, with the search tree standing above the town. */
  private tilt(): void {
    const { scene } = this.host;
    scene.setView('time');
    scene.setSearchTree(DETAIL);
    scene.tree.setColors(COLOR.algo, COLOR.best);
    scene.tree.setRaised(true);
  }

  /**
   * The tree as it stands after an event, and on the map below it what the
   * event is about: the fixed start of a family in blue, and the network that
   * bounds the rest of it in grey.
   */
  private showEvent(ev: BranchEvent, index: number): void {
    const { scene } = this.host;
    const path = 'path' in ev ? ev.path : null;
    scene.tree.show(
      this.branches.filter((branch) => branch.at <= index),
      ev.bestTour,
      path,
    );

    if (ev.kind === 'bb-node' || ev.kind === 'bb-below') {
      scene.setThread({ tour: ev.path, closed: false, color: COLOR.algo });
      scene.setPins(ev.path, COLOR.algo, last(ev.path));
      scene.setNetwork(ev.kind === 'bb-node' ? ev.tree : [], NETWORK);
      scene.setTruck(null);
    } else {
      // A complete tour: the best known, in gold once it has been proven or just found.
      const proven = ev.kind !== 'bb-start';
      scene.setThread({ tour: ev.bestTour, closed: true, color: proven ? COLOR.best : COLOR.algo });
      scene.setPins(ev.bestTour, proven ? COLOR.best : COLOR.algo);
      scene.setNetwork([], NETWORK);
      scene.setTruck(ev.kind === 'bb-done' ? ev.bestTour : null);
    }

    this.host.hud('Meilleure connue', km(ev.best));
    const done = last(this.trace);
    const orders = done.kind === 'bb-done' ? done.orders : 1;
    bind('bbExamined', whole(ev.examined));
    bind('bbCut', whole(ev.cut));
    bind('bbRuledOut', percent(ev.ruledOut / orders));
    if (ev.kind === 'bb-node' && index === this.example) {
      const family = factorial(this.city.inst.nodes.length - ev.path.length);
      bind(
        'bbPruneStatus',
        `Trajet déjà fixé : ${km(ev.driven)}. Plus court réseau pour le reste : ${km(ev.bound - ev.driven)}. Au mieux ${km(ev.bound)}, alors qu’on connaît déjà ${km(ev.best)} : ${count(family, 'ordre de visite écarté', 'ordres de visite écartés')} d’un coup.`,
      );
    }
    all('[data-code="bb"] li').forEach((line, i) => line.classList.toggle('is-current', i === ev.line));
    this.chart.setIndex(index);
  }

  private renderTexts(): void {
    const root = this.trace[0];
    const done = last(this.trace);
    const start = this.start;
    const houses = this.city.inst.nodes.length - 1;
    if (root.kind !== 'bb-start' || done.kind !== 'bb-done') return;

    bind('bbOrders', whole(done.orders));
    bind(
      'bbRootNote',
      `Ici, il mesure ${km(root.bound)}, contre ${km(start.cost)} pour notre meilleure tournée.`,
    );
    bind('bbFamilies', count(houses, 'famille', 'familles'));

    drawScoreboard(
      one('[data-scoreboard="proof"]'),
      [
        { label: 'Plus court réseau : le plancher de départ', cost: root.bound, color: NETWORK, soft: true },
        { label: 'Tournée de départ', cost: start.cost, color: COLOR.algo, soft: true },
        { label: 'Tournée prouvée optimale', cost: done.best, color: COLOR.best },
      ],
      null,
    );

    const improved = done.best < start.cost - 0.05;
    bind(
      'bbProof',
      improved
        ? `La recherche a trouvé mieux en chemin, ${km(done.best)} au lieu de ${km(start.cost)}, puis a prouvé qu’on ne peut pas descendre plus bas.`
        : `Aucune tournée ne fait moins de ${km(done.best)} : celle que nous avions était bien la meilleure.`,
    );
    const built = this.trace.filter((ev) => ev.kind === 'bb-best').length;
    const spared = built === 0 ? 'sans en construire une seule' : `en n’en construisant que ${built}`;
    bind(
      'bbStats',
      `${count(done.examined, 'famille examinée', 'familles examinées')}, dont ${whole(done.cut)} abandonnées sur leur borne. Les ${whole(done.orders)} ordres de visite sont tous couverts, ${spared}. En moyenne, une famille examinée règle le sort de ${whole(Math.round(done.orders / done.examined))} ordres.`,
    );
  }
}
