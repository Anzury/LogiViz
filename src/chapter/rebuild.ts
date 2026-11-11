import { routeCost } from '../core/fleet';
import { DEPOT, UNITS_PER_KM } from '../core/instance';
import type { LnsEvent } from '../core/lns';
import type { Edge } from '../core/trace';
import type { City } from '../story/city';
import { seedsFor } from '../story/opening';
import { lnsRun, timedStudy, type TimedStudy } from '../story/timedStudy';
import { count, describeLns, dwellLns, km, percent, typo } from './format';
import type { ChapterModule, Host } from './module';
import { Player } from './player';
import { StepChart } from './stepChart';
import { showTimedPlan, timedRows, truckName, type Painted } from './timedView';
import { COLOR, all, bind, drawFleet, drawScoreboard, one, truckColor } from './ui';

const last = <T>(items: T[]) => items[items.length - 1];

/**
 * Chapter 6, "Détruire pour reconstruire": large neighbourhood search on the
 * time-window plan of chapter 5. Houses taken out of the plan are lifted off the
 * board, then put back one by one.
 */
export class Rebuild implements ChapterModule {
  /** Chapter 5 worked out again for this town: the problem, and the plan this chapter starts from. */
  private study!: TimedStudy;
  private windows: { open: number; close: number }[] = [];
  private seed = 0;
  private trace: LnsEvent[] = [];
  /** For each event of the trace, the truck number of every route in it. */
  private trucks: Map<number, number>[] = [];
  /** Events of the round used to introduce the idea: from the plan before it to its verdict. */
  private demo: number[] = [];
  private timer: number | undefined;
  private optimumShown = false;

  private readonly player: Player<LnsEvent>;
  private readonly chart: StepChart;

  readonly steps: Record<string, () => void> = {
    stuck: () => {
      this.flat();
      this.showEvent(this.trace[0], 0, true);
      this.host.hud('Après retouches', km(this.trace[0].cost));
    },
    lift: () => {
      // The same round over and over: before, houses out, back one by one, verdict.
      this.flat();
      let frame = 0;
      const show = () => {
        const index = this.demo[frame];
        this.showEvent(this.trace[index], index, false);
        bind('lnsDemo', describeLns(this.trace[index]));
        frame = (frame + 1) % this.demo.length;
      };
      show();
      this.timer = window.setInterval(show, 1700);
    },
    lns: () => {
      this.flat();
      this.player.render();
      if (this.player.atStart) this.player.play();
    },
    'lns-result': () => {
      const { scene } = this.host;
      scene.setView('time');
      scene.setWindows(this.windows);
      scene.timeline.setRaised(true);
      scene.setFleet([]);
      scene.setLifted([]);
      scene.setAccent([]);
      scene.setTruck(null);
      this.optimumShown = false;
      this.renderResult();
    },
  };

  constructor(private readonly host: Host) {
    this.player = new Player<LnsEvent>(one('[data-player="lns"]'), {
      show: (ev, index) => this.showEvent(ev, index, false),
      caption: (ev) => typo(describeLns(ev)),
      dwell: dwellLns,
      milestone: (ev) => ev.kind === 'lns-verdict' && ev.accepted,
      speed: 1,
    });
    this.chart = new StepChart(one('[data-chart="lns"]'), (index) => {
      this.host.enter('lns');
      this.player.seek(index);
    });
    document.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (button?.dataset.action === 'lns-reroll') {
        this.run(this.seed + 1);
        this.host.enter(button.closest<HTMLElement>('[data-step]')?.dataset.step ?? 'lns', true);
      } else if (button?.dataset.action === 'lns-optimum') {
        this.optimumShown = !this.optimumShown;
        this.renderResult();
      }
    });
  }

  leave(): void {
    this.player.pause();
    window.clearInterval(this.timer);
  }

  setCity(city: City): void {
    const seeds = seedsFor(city);
    this.study = timedStudy(city, seeds.windows);
    const { open, close } = this.study.problem;
    this.windows = open.map((start, node) => ({ open: start, close: close[node] }));
    this.run(seeds.lns);
  }

  // ------------------------------------------------------------------ run

  private run(seed: number): void {
    const { optimum } = this.study;
    this.seed = seed;
    this.trace = lnsRun(this.study, seed);

    // Truck numbers: a route keeps the one it had, a new route takes the lowest free.
    this.trucks = [];
    const remembered = new Map<number, number>();
    for (const ev of this.trace) {
      const numbers = new Map<number, number>();
      const pending = ev.routes.filter((route) => {
        const known = remembered.get(route.id);
        if (known === undefined || [...numbers.values()].includes(known)) return true;
        numbers.set(route.id, known);
        return false;
      });
      for (const route of pending) {
        let free = 0;
        while ([...numbers.values()].includes(free)) free++;
        numbers.set(route.id, free);
        remembered.set(route.id, free);
      }
      this.trucks.push(numbers);
    }

    // The round shown in the introduction: the first that worked, else the first.
    const verdict = this.trace.findIndex((ev) => ev.kind === 'lns-verdict' && ev.accepted);
    const end = verdict >= 0 ? verdict : this.trace.findIndex((ev) => ev.kind === 'lns-verdict');
    const round = end >= 0 ? this.trace[end].round : 0;
    this.demo = this.trace.flatMap((ev, index) => (ev.round === round && index <= end ? [index] : []));
    if (this.demo.length > 0) this.demo.unshift(this.demo[0] - 1);
    else this.demo = [0];

    this.player.load(this.trace);
    this.chart.setData({
      values: this.trace.map((ev) => ev.kept / UNITS_PER_KM),
      color: COLOR.algo,
      unit: 'km',
      format: (value) => km(value * UNITS_PER_KM),
      name: 'Longueur du plan conservé',
      reference: { value: optimum.cost / UNITS_PER_KM, label: 'Répartition optimale', color: COLOR.best },
    });
    this.renderTexts();
  }

  // --------------------------------------------------------------- scene

  /** The map view: time windows still apply, but the masts are down. */
  private flat(): void {
    const { scene } = this.host;
    scene.setView('work');
    scene.timeline.setRaised(false);
    scene.setTracks([]);
    scene.setLabels([]);
    scene.setThread(null);
    scene.setGhosts([]);
    scene.setMarked([]);
  }

  private paint(ev: LnsEvent, index: number): Painted[] {
    const numbers = this.trucks[index];
    return ev.routes.map((route) => {
      const truck = numbers.get(route.id) ?? 0;
      return { nodes: route.nodes, color: truckColor(truck), name: truckName(truck), closed: true };
    });
  }

  /** Coloured rounds on the map, with the houses currently out of the plan held in the air. */
  private showEvent(ev: LnsEvent, index: number, drive: boolean): void {
    const { scene } = this.host;
    const painted = this.paint(ev, index);
    let lifted: number[] = [];
    let accent: Edge[] = [];
    let current: number | null = null;
    if (ev.kind === 'lns-destroy') lifted = ev.removed;
    if (ev.kind === 'lns-repair') {
      lifted = ev.waiting;
      accent = ev.added;
      current = ev.node;
    }

    const { inst } = this.study.problem;
    const pins: (string | null)[] = inst.nodes.map(() => null);
    for (const route of painted) {
      for (const node of route.nodes) pins[node] = route.color;
    }
    scene.setFleet(painted);
    scene.paintPins(pins, current);
    scene.setLifted(lifted);
    scene.setAccent(accent);
    scene.setTrucks(drive || ev.kind === 'lns-done' ? painted.map((route) => ({ tour: [DEPOT, ...route.nodes], color: route.color })) : []);

    this.host.hud('Plan conservé', km(ev.kept));
    drawFleet(
      one('[data-fleet="lns"]'),
      painted
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }))
        .map((route) => ({
          name: route.name,
          color: route.color,
          cost: routeCost(inst, route.nodes),
          detail: count(route.nodes.length, 'maison', 'maisons'),
        })),
      lifted.length > 0 ? `${count(lifted.length, 'maison attend', 'maisons attendent')} d’être reposée${lifted.length > 1 ? 's' : ''}.` : '',
    );
    all('[data-code="lns"] li').forEach((line, i) => line.classList.toggle('is-current', i === ev.line));
    this.chart.setIndex(index);
  }

  // --------------------------------------------------------------- result

  private renderResult(): void {
    const { problem, optimum } = this.study;
    const done = last(this.trace);
    const painted: Painted[] = this.optimumShown
      ? optimum.routes.map((nodes, k) => ({ nodes, color: truckColor(k), name: truckName(k), closed: true }))
      : this.paint(done, this.trace.length - 1);
    showTimedPlan(this.host.scene, problem, painted, null);
    this.host.scene.setLabels([]);
    this.host.hud(this.optimumShown ? 'Répartition optimale' : 'Après grand voisinage', km(this.optimumShown ? optimum.cost : done.cost));
    drawFleet(one('[data-fleet="lns-result"]'), timedRows(problem, painted));
    one('[data-action="lns-optimum"]').textContent = this.optimumShown
      ? 'Revenir au plan trouvé'
      : 'Voir la répartition optimale';
  }

  private renderTexts(): void {
    const { inserted, moved, optimum } = this.study;
    const before = last(moved).cost;
    const done = last(this.trace);
    const startGap = before / optimum.cost - 1;
    const gap = done.cost / optimum.cost - 1;

    bind(
      'lnsStuckNote',
      startGap < 0.0005
        ? 'Dans cette ville, il se trouve déjà être le meilleur possible : la méthode qui suit n’y gagnera rien, mais on peut la regarder travailler.'
        : `Il reste pourtant ${percent(startGap)} au-dessus de la meilleure répartition.`,
    );

    drawScoreboard(
      one('[data-scoreboard="rebuild"]'),
      [
        { label: 'Insertion', cost: last(inserted).cost, color: COLOR.algo, soft: true },
        { label: 'Insertion, puis retouches', cost: before, color: COLOR.algo, soft: true },
        { label: 'Après grand voisinage', cost: done.cost, color: COLOR.algo },
        { label: 'Répartition optimale', cost: optimum.cost, color: COLOR.best },
      ],
      optimum.cost,
    );

    if (gap < 0.0005) {
      bind(
        'lnsNote',
        startGap < 0.0005
          ? 'Le plan était déjà optimal : aucun essai ne pouvait l’améliorer.'
          : `Ce tirage a trouvé la répartition optimale, là où les retouches seules restaient ${percent(startGap)} au-dessus.`,
      );
    } else if (done.cost < before - 0.05) {
      bind('lnsNote', `Ce tirage descend à ${km(done.cost)} : mieux que les retouches seules, mais encore ${percent(gap)} au-dessus de la répartition optimale.`);
    } else {
      bind('lnsNote', `Ce tirage n’a rien trouvé de mieux que les retouches : il reste ${percent(gap)} d’écart.`);
    }
    if (done.kind === 'lns-done') {
      const rounds = count(done.rounds, 'essai', 'essais');
      bind(
        'lnsStats',
        done.improvements === 0
          ? `${rounds} en tout, et aucun n’a raccourci le plan.`
          : `${rounds} en tout, dont ${count(done.improvements, 'a', 'ont')} raccourci le plan.`,
      );
    }
  }
}
