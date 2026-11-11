import { anneal } from '../core/annealing';
import { UNITS_PER_KM } from '../core/instance';
import { generateLandscape, nearestMinimum, wander, type Landscape, type Spot, type WalkEvent } from '../core/landscape';
import { mulberry32 } from '../core/rng';
import { record, result, type Trace, type TraceEvent } from '../core/trace';
import type { Maquette } from '../scene/maquette';
import type { StageName } from '../scene/maquette';
import type { City, Solution } from '../story/city';
import type { ChapterModule, Host } from './module';
import { altitude, count, describe, describeWalk, dwell, dwellWalk, km, percent, typo } from './format';
import { Player } from './player';
import { StepChart } from './stepChart';
import { COLOR, all, bind, drawScoreboard, one } from './ui';

/** Start temperature at the top of the slider, in landscape height units. */
const MAX_HEAT = 0.3;
const HEAT_COLOR = '#d9772f';
const RELIEF_STEPS = new Set(['landscape', 'descent', 'shake']);


/** A landscape with one clearly deepest pit and well separated basins. */
function pickLandscape(): Landscape {
  for (let seed = 1; ; seed++) {
    const land = generateLandscape(seed);
    const [deepest, second] = land.minima;
    const separated = land.minima.every((a, i) =>
      land.minima.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) > 0.18),
    );
    if (separated && second.height - deepest.height >= 0.15) return land;
  }
}

/**
 * Chapter 3, "Sortir du piège": a marble on a toy landscape shows why descent
 * gets stuck and how shaking helps, then the same idea runs on the real tour.
 */
export class Escape implements ChapterModule {
  private readonly land = pickLandscape();
  private start = { x: 0.5, y: 0.5 };
  private startSeed = 0;
  private heat = MAX_HEAT / 2;
  private hotSeed = 0;
  private cold: WalkEvent[] = [];
  private hot: WalkEvent[] = [];

  private city!: City;
  private saSeed = 0;
  private saTrace: Trace = [];
  private annealed!: Solution;

  private readonly coldPlayer: Player<WalkEvent>;
  private readonly hotPlayer: Player<WalkEvent>;
  private readonly saPlayer: Player<TraceEvent>;
  private readonly lengthChart: StepChart;
  private readonly heatChart: StepChart;

  readonly steps: Record<string, () => void> = {
    landscape: () => {
      const { scene } = this.host;
      const start = this.cold[0].at;
      scene.setView('relief');
      scene.setMarble(start);
      scene.setCandidate(null);
      scene.setTrail([]);
      scene.setFlag(null);
      this.host.hud('Altitude de la bille', altitude(start.height));
    },
    descent: () => {
      this.host.scene.setView('relief');
      this.coldPlayer.render();
      if (this.coldPlayer.atStart) this.coldPlayer.play();
    },
    shake: () => {
      this.host.scene.setView('relief');
      this.hotPlayer.render();
      if (this.hotPlayer.atStart) this.hotPlayer.play();
    },
    sa: () => {
      this.host.scene.setView('work');
      this.saPlayer.render();
      if (this.saPlayer.atStart) this.saPlayer.play();
    },
    'sa-result': () => {
      const { scene } = this.host;
      const { tour, cost } = this.annealed;
      scene.setView('work');
      scene.setThread({ tour, closed: true, color: COLOR.algo });
      scene.setPins(tour, COLOR.algo);
      scene.setTruck(tour);
      this.host.hud('Après recuit simulé', km(cost));
    },
  };

  constructor(private readonly host: Host) {
    host.scene.setRelief(this.land, COLOR.algo);

    this.coldPlayer = new Player<WalkEvent>(one('[data-player="descent"]'), {
      show: (ev, index) => this.showWalk(this.cold, ev, index),
      caption: (ev) => typo(describeWalk(ev, this.land)),
      dwell: dwellWalk,
    });
    this.hotPlayer = new Player<WalkEvent>(one('[data-player="shake"]'), {
      show: (ev, index) => this.showWalk(this.hot, ev, index),
      caption: (ev) => typo(describeWalk(ev, this.land)),
      dwell: dwellWalk,
      speed: 1,
    });
    this.saPlayer = new Player<TraceEvent>(one('[data-player="sa"]'), {
      show: (ev, index) => this.showAnneal(ev, index),
      caption: (ev) => typo(describe(ev, this.city.inst)),
      dwell,
      milestone: (ev) => ev.kind === 'sa-propose' && ev.record,
      speed: 1,
    });
    const seek = (index: number) => {
      this.host.enter('sa');
      this.saPlayer.seek(index);
    };
    this.lengthChart = new StepChart(one('[data-chart="sa-length"]'), seek);
    this.heatChart = new StepChart(one('[data-chart="sa-heat"]'), seek, 104);

    this.pickStart(1, true);
    this.rollHot(1, true);
    this.bindControls();
  }

  /** The first steps happen on the relief, the rest back on the town. */
  stageOf(step: string): StageName {
    return RELIEF_STEPS.has(step) ? 'relief' : 'town';
  }

  leave(): void {
    this.coldPlayer.pause();
    this.hotPlayer.pause();
    this.saPlayer.pause();
    this.host.scene.setShake(0);
    this.host.scene.setCandidate(null);
  }

  setCity(city: City): void {
    this.city = city;
    this.setAnneal(city.inst.seed, city.anneal);
  }

  // --------------------------------------------------------------- relief

  /**
   * Chooses where the marble is dropped. The opening start (`strict`) is one
   * from which plain descent misses the deepest pit; later ones are any high spot.
   */
  private pickStart(from: number, strict: boolean): void {
    for (let seed = from; ; seed++) {
      const rng = mulberry32(Math.imul(seed, 7919));
      const start = { x: 0.08 + rng() * 0.84, y: 0.08 + rng() * 0.84 };
      if (this.land.height(start.x, start.y) < 0.5) continue;
      const cold = Array.from(wander(this.land, start, { seed, startTemperature: 0 }));
      const missed = nearestMinimum(this.land, cold[cold.length - 1].at) !== this.land.minima[0];
      if (strict && !missed) continue;
      this.startSeed = seed;
      this.start = start;
      this.cold = cold;
      this.coldPlayer.load(cold);
      return;
    }
  }

  /** Records a shaken walk at the current temperature; the opening one must find the deepest pit. */
  private rollHot(from: number, strict: boolean): void {
    for (let seed = from; ; seed++) {
      const hot = Array.from(wander(this.land, this.start, { seed, startTemperature: this.heat }));
      const found = nearestMinimum(this.land, hot[hot.length - 1].best) === this.land.minima[0];
      if (strict && !found && seed < from + 200) continue;
      this.hotSeed = seed;
      this.hot = hot;
      this.hotPlayer.load(hot);
      return;
    }
  }

  private showWalk(trace: WalkEvent[], ev: WalkEvent, index: number): void {
    const { scene } = this.host;
    const hot = trace[0].temperature > 0;
    const visited: Spot[] = [];
    for (let i = 0; i < index; i++) {
      if (visited[visited.length - 1] !== trace[i].at) visited.push(trace[i].at);
    }
    scene.setMarble(ev.at);
    scene.setCandidate(ev.kind === 'step' && !ev.accepted ? ev.candidate : null);
    scene.setTrail(visited);
    scene.setFlag(hot && ev.kind !== 'start' ? ev.best : null);
    scene.setShake(hot && ev.kind !== 'end' ? ev.temperature / MAX_HEAT : 0);
    this.host.hud('Altitude de la bille', altitude(ev.at.height));
    if (trace === this.hot) {
      const level = ev.kind === 'end' ? 0 : ev.temperature / MAX_HEAT;
      one('[data-meter="heat"]').style.setProperty('--level', `${Math.round(level * 100)}%`);
      bind('heatNow', percent(level));
    }
  }

  // ----------------------------------------------------------------- tour

  private setAnneal(seed: number, trace: Trace): void {
    this.saSeed = seed;
    this.saTrace = trace;
    this.annealed = result(trace);
    this.saPlayer.load(trace);

    const heat = (ev: TraceEvent) => ('temperature' in ev ? ev.temperature : 0);
    const startHeat = heat(trace[0]);
    this.lengthChart.setData({
      values: trace.map((ev) => ev.cost / UNITS_PER_KM),
      color: COLOR.algo,
      unit: 'km',
      format: (value) => km(value * UNITS_PER_KM),
      name: 'Longueur de la tournée',
      reference: { value: this.city.optimum.cost / UNITS_PER_KM, label: 'Tournée optimale', color: COLOR.best },
    });
    this.heatChart.setData({
      values: trace.map((ev) => (heat(ev) / startHeat) * 100),
      color: HEAT_COLOR,
      unit: '%',
      format: (value) => percent(value / 100),
      name: 'Température',
    });
    this.renderTexts();
  }

  private showAnneal(ev: TraceEvent, index: number): void {
    const { scene } = this.host;
    scene.setGhosts([]);
    scene.setAccent([]);
    scene.setMarked([]);
    scene.setThread({ tour: ev.tour, closed: true, color: COLOR.algo });
    scene.setPins(ev.tour, COLOR.algo);
    if (ev.kind === 'sa-propose') {
      // A refused idea only flickers as pale threads; an accepted one glows,
      // warm when it made the tour longer.
      if (ev.accepted) scene.setAccent(ev.added, ev.delta > 0);
      else scene.setGhosts(ev.added);
    }
    scene.setTruck(ev.kind === 'sa-done' ? ev.tour : null);
    this.host.hud('Recuit simulé', km(ev.cost));
    all('[data-code="sa"] li').forEach((line, i) => line.classList.toggle('is-current', i === ev.line));
    this.lengthChart.setIndex(index);
    this.heatChart.setIndex(index);
  }

  private renderTexts(): void {
    const { refined, optimum } = this.city;
    const best = this.annealed;
    drawScoreboard(
      one('[data-scoreboard="escape"]'),
      [
        { label: 'Plus proche voisin, après 2-opt', cost: refined.cost, color: COLOR.algo, soft: true },
        { label: 'Après recuit simulé', cost: best.cost, color: COLOR.algo },
        { label: 'Tournée optimale', cost: optimum.cost, color: COLOR.best },
      ],
      optimum.cost,
    );

    const gap = best.cost / optimum.cost - 1;
    const before = refined.cost / optimum.cost - 1;
    if (gap < 0.0005) {
      bind(
        'saNote',
        before < 0.0005
          ? 'Le recuit retrouve la tournée optimale, que le 2-opt avait déjà atteinte dans cette ville.'
          : `Ce tirage a trouvé la tournée optimale, là où le 2-opt restait bloqué ${percent(before)} au-dessus.`,
      );
    } else if (best.cost < refined.cost - 0.05) {
      bind('saNote', `Ce tirage descend à ${km(best.cost)} : mieux que le 2-opt, mais encore ${percent(gap)} au-dessus de la tournée optimale.`);
    } else {
      bind('saNote', 'Ce tirage n’a rien trouvé de mieux que le 2-opt.');
    }

    const done = this.saTrace[this.saTrace.length - 1];
    if (done?.kind === 'sa-done') {
      bind(
        'saStats',
        `Sur ${count(done.proposals, 'renouage proposé', 'renouages proposés')}, ${done.accepted} ont été acceptés, dont ${done.uphill} qui rallongeaient la tournée.`,
      );
    }
  }

  // ------------------------------------------------------------- controls

  private bindControls(): void {
    const slider = one<HTMLInputElement>('[data-input="heat"]');
    const describeHeat = () => {
      const value = Number(slider.value);
      bind('heatLabel', value === 0 ? 'nulle' : value < 34 ? 'basse' : value < 67 ? 'moyenne' : 'haute');
    };
    slider.addEventListener('input', () => {
      this.heat = (Number(slider.value) / 100) * MAX_HEAT;
      describeHeat();
      this.rollHot(this.hotSeed, false);
      this.host.enter('shake', true);
    });
    describeHeat();

    const actions: Record<string, (step: string) => void> = {
      'walk-restart': () => {
        this.pickStart(this.startSeed + 1, false);
        this.rollHot(this.hotSeed, false);
        this.host.enter('descent', true);
      },
      'walk-reroll': () => {
        this.rollHot(this.hotSeed + 1, false);
        this.host.enter('shake', true);
      },
      'sa-reroll': (step) => {
        const { inst, refined } = this.city;
        const seed = this.saSeed + 1;
        this.setAnneal(seed, record(anneal(inst, refined.tour, { seed })));
        this.host.enter(step, true);
      },
    };
    document.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      const action = button?.dataset.action;
      if (button && action && actions[action]) actions[action](button.closest<HTMLElement>('[data-step]')?.dataset.step ?? 'sa');
    });
  }
}
