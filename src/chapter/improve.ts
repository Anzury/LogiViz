import { UNITS_PER_KM } from '../core/instance';
import { tourCost } from '../core/tour';
import { record, result, type Trace, type TraceEvent } from '../core/trace';
import { twoOpt } from '../core/twoOpt';
import type { City } from '../story/city';
import { describe, dwell, km, percent, typo } from './format';
import type { ChapterModule, Host, TourStage } from './module';
import { Player } from './player';
import { session } from './session';
import { StepChart } from './stepChart';
import { clearOverlays, showTour, showTraceEvent } from './tourView';
import { COLOR, bind, drawScoreboard, one } from './ui';

/**
 * Chapter 2, "Améliorer la tournée": undoing one crossing, then 2-opt as a
 * local search, up to the local optimum it stops at.
 */
export class Improve implements ChapterModule {
  private city!: City;
  /** The tour the reader drew in chapter 1 on this town, and 2-opt run on it. */
  private user: { tour: number[]; refine: Trace } | null = null;
  private source: 'nn' | 'user' = 'nn';
  private optimumShown = false;
  private timer: number | undefined;

  private readonly player: Player<TraceEvent>;
  private readonly chart: StepChart;

  readonly steps: Record<string, () => void> = {
    cross: () => {
      // One move, over and over: the two threads to cut, then the way they are tied back.
      const { scene } = this.host;
      const before = this.city.nnResult;
      const move = this.city.showcase;
      scene.setView('work');
      scene.setTruck(null);
      let renewed = false;
      const show = () => {
        clearOverlays(scene);
        const tour = renewed ? move.after : before.tour;
        const cost = renewed ? before.cost - move.gain : before.cost;
        scene.setThread({ tour, closed: true, color: COLOR.algo });
        scene.setPins(tour, COLOR.algo);
        if (renewed) {
          scene.setAccent(move.added);
          bind('crossStatus', `Après : ${km(cost)}, soit ${km(move.gain)} de moins.`);
        } else {
          scene.setMarked(move.removed);
          scene.setGhosts(move.added);
          bind('crossStatus', `Avant : ${km(cost)}. Les fils clairs montrent l’autre façon de nouer.`);
        }
        this.host.hud(renewed ? 'Après renouage' : 'Avant renouage', km(cost));
        renewed = !renewed;
      };
      show();
      this.timer = window.setInterval(show, 2200);
    },
    twoopt: () => {
      this.host.scene.setView('work');
      this.player.render();
      if (this.player.atStart) this.player.play();
    },
    local: () => {
      this.host.scene.setView('work');
      this.optimumShown = false;
      this.renderLocal();
    },
  };

  constructor(private readonly host: Host<TourStage>) {
    this.player = new Player<TraceEvent>(one('[data-player="twoopt"]'), {
      show: (ev, index, forward) => {
        showTraceEvent(host, ev, 'twoopt', this.fromUser ? COLOR.user : COLOR.algo, forward);
        this.chart.setIndex(index);
      },
      caption: (ev) => typo(describe(ev, this.city.inst)),
      dwell,
      milestone: (ev) => ev.kind === '2opt-apply',
    });
    this.chart = new StepChart(one('[data-chart="twoopt"]'), (index) => {
      host.enter('twoopt');
      this.player.seek(index);
    });

    const actions: Record<string, () => void> = {
      'source-nn': () => this.setSource('nn'),
      'source-user': () => this.setSource('user'),
      'toggle-optimum': () => {
        this.optimumShown = !this.optimumShown;
        this.renderLocal();
      },
    };
    document.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action) actions[action]?.();
    });
  }

  leave(): void {
    this.player.pause();
    window.clearInterval(this.timer);
  }

  setCity(city: City): void {
    this.city = city;
    const tour = session.userTour(city.inst.seed);
    this.user = tour ? { tour, refine: record(twoOpt(city.inst, tour)) } : null;
    this.source = 'nn';
    this.loadTwoOpt();
    this.renderTexts();
  }

  private get fromUser(): boolean {
    return this.source === 'user' && this.user !== null;
  }

  private setSource(source: 'nn' | 'user'): void {
    if (source === 'user' && !this.user) return;
    this.source = source;
    this.loadTwoOpt();
    this.host.enter('twoopt', true);
  }

  private loadTwoOpt(): void {
    const trace = this.fromUser ? this.user!.refine : this.city.refine;
    this.player.load(trace);
    this.chart.setData({
      values: trace.map((ev) => ev.cost / UNITS_PER_KM),
      color: this.fromUser ? COLOR.user : COLOR.algo,
      unit: 'km',
      format: (value) => km(value * UNITS_PER_KM),
      name: 'Longueur de la tournée',
    });
    one('[data-action="source-nn"]').setAttribute('aria-pressed', String(!this.fromUser));
    const userButton = one<HTMLButtonElement>('[data-action="source-user"]');
    userButton.setAttribute('aria-pressed', String(this.fromUser));
    userButton.disabled = this.user === null;
    userButton.title = this.user === null ? 'Trace d’abord ta tournée, au chapitre 1' : '';
  }

  private renderLocal(): void {
    const { refined, optimum } = this.city;
    if (this.optimumShown) showTour(this.host, optimum.tour, COLOR.best, 'Tournée optimale', optimum.cost);
    else showTour(this.host, refined.tour, COLOR.algo, 'Après 2-opt', refined.cost);
    one('[data-action="toggle-optimum"]').textContent = this.optimumShown
      ? 'Revenir à la tournée du 2-opt'
      : 'Voir la tournée optimale';
  }

  private renderTexts(): void {
    const { inst, nnResult, refined, optimum, showcase } = this.city;
    const user = this.user;
    drawScoreboard(
      one('[data-scoreboard="final"]'),
      [
        { label: 'Ta tournée', cost: user ? tourCost(inst, user.tour) : null, color: COLOR.user, soft: true },
        ...(user ? [{ label: 'Ta tournée, après 2-opt', cost: result(user.refine).cost, color: COLOR.user }] : []),
        { label: 'Plus proche voisin', cost: nnResult.cost, color: COLOR.algo, soft: true },
        { label: 'Plus proche voisin, après 2-opt', cost: refined.cost, color: COLOR.algo },
        { label: 'Tournée optimale', cost: optimum.cost, color: COLOR.best },
      ],
      optimum.cost,
    );

    bind(
      'crossNote',
      showcase.crossing
        ? 'Regarde les deux fils surlignés en noir : ils se croisent.'
        : 'Regarde les deux fils surlignés en noir : ils ne se croisent pas franchement, et pourtant on peut faire mieux.',
    );
    const gap = refined.cost / optimum.cost - 1;
    bind(
      'gapNote',
      gap < 0.0005
        ? 'Dans cette ville, le 2-opt est tombé pile sur la tournée optimale. Rien ne le garantit : essaie une nouvelle ville.'
        : `Ici, le 2-opt s’arrête à ${percent(gap)} au-dessus de la tournée optimale. Aucun renouage de deux fils ne franchit ce dernier écart : il faudrait accepter de défaire davantage.`,
    );
  }
}
