import { DEPOT } from '../core/instance';
import { mulberry32 } from '../core/rng';
import { randomTour, tourCost } from '../core/tour';
import type { TraceEvent } from '../core/trace';
import { HOUSES, longestEdge, type City } from '../story/city';
import { count, describe, duration, dwell, km, tourCount, typo } from './format';
import type { ChapterModule, Host } from './module';
import { Player } from './player';
import { session } from './session';
import { showTour, showTraceEvent } from './tourView';
import { COLOR, bind, drawScoreboard, one } from './ui';

/**
 * Chapter 1, "Un seul camion": the reader draws a tour by hand, sees why trying
 * every order is hopeless, then watches the nearest-neighbour rule build one.
 */
export class Tour implements ChapterModule {
  private city!: City;
  private user: { tour: number[]; closed: boolean } = { tour: [DEPOT], closed: false };
  private timer: number | undefined;
  private readonly player: Player<TraceEvent>;

  readonly steps: Record<string, () => void> = {
    intro: () => {
      const { scene } = this.host;
      scene.setView('intro');
      scene.setThread(null);
      scene.setPins([], COLOR.user);
      scene.setTruck(null);
      this.host.hud('Longueur du fil', '—');
    },
    draw: () => {
      this.host.scene.setView('draw');
      this.renderUser(false);
      this.host.scene.setPicking({ pick: (node) => this.pick(node), hover: (node) => this.previewPick(node) });
    },
    explosion: () => {
      const { scene } = this.host;
      const { inst } = this.city;
      scene.setView('work');
      scene.setPins([], COLOR.user);
      scene.setTruck(null);
      const rng = mulberry32(inst.seed + 99);
      const flick = () => {
        const tour = randomTour(inst, rng);
        scene.setThread({ tour, closed: true, color: COLOR.muted });
        this.host.hud('Une tournée au hasard', km(tourCost(inst, tour)));
      };
      flick();
      this.timer = window.setInterval(flick, 150);
    },
    nn: () => {
      this.host.scene.setView('work');
      this.player.render();
      if (this.player.atStart) this.player.play();
    },
    'nn-result': () => {
      const { tour, cost } = this.city.nnResult;
      this.host.scene.setView('work');
      showTour(this.host, tour, COLOR.algo, 'Plus proche voisin', cost);
      this.host.scene.setMarked([longestEdge(this.city.inst, tour)]);
    },
  };

  constructor(private readonly host: Host) {
    this.player = new Player<TraceEvent>(one('[data-player="nn"]'), {
      show: (ev, _index, forward) => showTraceEvent(host, ev, 'nn', COLOR.algo, forward),
      caption: (ev) => typo(describe(ev, this.city.inst)),
      dwell,
    });
    this.bindActions();
    this.bindExplosion();
  }

  leave(): void {
    this.player.pause();
    window.clearInterval(this.timer);
  }

  setCity(city: City): void {
    this.city = city;
    // A tour drawn earlier on this town, in this tab, is picked up again.
    const saved = session.userTour(city.inst.seed);
    this.user = saved ? { tour: saved, closed: true } : { tour: [DEPOT], closed: false };
    this.player.load(city.nn);
    this.renderTexts();
  }

  /** The comparison with the reader's tour, and the sentences that depend on the town. */
  private renderTexts(): void {
    const { inst, nnResult } = this.city;
    const userCost = this.user.closed ? tourCost(inst, this.user.tour) : null;
    drawScoreboard(
      one('[data-scoreboard="first"]'),
      [
        { label: 'Ta tournée', cost: userCost, color: COLOR.user, soft: true },
        { label: 'Plus proche voisin', cost: nnResult.cost, color: COLOR.algo, soft: true },
      ],
      null,
    );

    if (userCost === null) {
      bind('verdict', 'Tu n’as pas encore tracé ta tournée : remonte d’un cran pour te mesurer à l’algorithme.');
    } else if (Math.abs(userCost - nnResult.cost) < 0.05) {
      bind('verdict', 'Égalité parfaite entre toi et l’algorithme.');
    } else if (userCost < nnResult.cost) {
      bind('verdict', `Bien joué : ta tournée est plus courte de ${km(nnResult.cost - userCost)}. Sur une petite ville, l’œil humain est redoutable.`);
    } else {
      bind('verdict', `L’algorithme fait ${km(userCost - nnResult.cost)} de moins que toi, sans jamais regarder plus loin que la maison suivante.`);
    }

    const [from, to] = longestEdge(inst, nnResult.tour);
    bind('longest', km(inst.dist[from][to]));
  }

  // ---------------------------------------------------------- hand drawing

  private renderUser(grow: boolean): void {
    const { scene } = this.host;
    const { tour, closed } = this.user;
    const cost = tourCost(this.city.inst, tour, closed);
    scene.setGhosts([]);
    scene.setThread({ tour, closed, color: COLOR.user, growLast: grow });
    scene.setPins(tour, COLOR.user, closed ? null : tour[tour.length - 1]);
    scene.setTruck(closed ? tour : null);
    this.host.hud('Ta tournée', tour.length > 1 ? km(cost) : '—');

    const delivered = tour.length - 1;
    bind(
      'drawStatus',
      closed
        ? `Tournée bouclée : ${km(cost)}. Garde ce chiffre en tête.`
        : delivered === 0
          ? 'Le camion attend au dépôt. Clique une première maison.'
          : `${count(delivered, 'maison livrée', 'maisons livrées')} sur ${HOUSES}, ${km(cost)} parcourus.`,
    );
    one<HTMLButtonElement>('[data-action="undo"]').disabled = delivered === 0;
    one<HTMLButtonElement>('[data-action="reset"]').disabled = delivered === 0;
  }

  private previewPick(node: number | null): void {
    const { tour, closed } = this.user;
    const free = node !== null && !closed && !tour.includes(node);
    this.host.scene.setGhosts(free ? [[tour[tour.length - 1], node]] : []);
  }

  private pick(node: number): void {
    const { tour, closed } = this.user;
    if (closed || tour.includes(node)) return;
    tour.push(node);
    this.userChanged(true);
  }

  private userChanged(grow: boolean): void {
    const { inst } = this.city;
    this.user.closed = this.user.tour.length === inst.nodes.length;
    // Chapter 2 offers to improve this tour, so it travels with the reader.
    session.saveUserTour(inst.seed, this.user.closed ? this.user.tour : null);
    this.renderTexts();
    if (this.host.active() === 'draw') this.renderUser(grow);
  }

  private bindActions(): void {
    const actions: Record<string, () => void> = {
      undo: () => {
        this.user.tour.pop();
        this.userChanged(false);
      },
      reset: () => {
        this.user.tour = [DEPOT];
        this.userChanged(false);
      },
      random: () => {
        this.user.tour = randomTour(this.city.inst, mulberry32(Date.now()));
        this.userChanged(false);
      },
    };
    document.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action) actions[action]?.();
    });
  }

  /** The slider of the "try everything" step: how many tours, and how long to test them all. */
  private bindExplosion(): void {
    const input = one<HTMLInputElement>('[data-input="houses"]');
    const update = () => {
      const houses = Number(input.value);
      const tours = tourCount(houses);
      bind('houses', String(houses));
      bind('tourCount', tours.toLocaleString('fr-FR'));
      bind('tourTime', duration(Number(tours) / 1e6));
    };
    input.addEventListener('input', update);
    update();
  }
}
