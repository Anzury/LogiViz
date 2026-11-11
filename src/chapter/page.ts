import { Maquette } from '../scene/maquette';
import { buildCity, nextCity, type City } from '../story/city';
import { OPENING } from '../story/opening';
import { typo } from './format';
import type { ChapterModule, Host } from './module';
import { session } from './session';
import { COLOR, MOBILE, all, bind, one } from './ui';

/** Each chapter's code, loaded on demand so that a page only ships its own chapter. */
const CHAPTERS: Record<number, (host: Host) => Promise<ChapterModule>> = {
  1: async (host) => new (await import('./tour')).Tour(host),
  2: async (host) => new (await import('./improve')).Improve(host),
  3: async (host) => new (await import('./escape')).Escape(host),
  4: async (host) => new (await import('./fleet')).Fleet(host),
  5: async (host) => new (await import('./hours')).Hours(host),
  6: async (host) => new (await import('./rebuild')).Rebuild(host),
  7: async (host) => new (await import('./prove')).Prove(host),
  8: async (host) => new (await import('./world')).World(host),
};

/** The town a page opens on: the one the reader moved to in this tab, else the curated one. */
function startingCity(): City {
  const seed = session.seed;
  return (seed === null ? null : buildCity(seed)) ?? buildCity(OPENING.city)!;
}

/**
 * Applies French spacing to the page's prose. Done here rather than at build
 * time so it does not depend on which Markdown processor Astro is running.
 */
function polishTypography(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('code')) continue;
    node.nodeValue = typo(node.nodeValue ?? '');
  }
}

/** Keeps the model clear of the text column: beside it on desktop, above it on mobile. */
function followLayout(scene: Maquette, onChange?: () => void): void {
  const story = one('#story');
  const layout = () => scene.setShift(MOBILE.matches ? 0 : story.getBoundingClientRect().right / 2);
  layout();
  window.addEventListener('resize', layout);
  MOBILE.addEventListener('change', () => {
    layout();
    onChange?.();
  });
}

function failed(error: unknown): void {
  console.error(error);
  bind('stageStatus', 'Impossible d’afficher la maquette : ce navigateur ne propose ni WebGPU ni WebGL 2.');
}

function ready(scene: Maquette): void {
  // The badge naming the renderer is a development aid, absent from the published site.
  if (import.meta.env.DEV) bind('backend', scene.backend);
  one('#stage').classList.add('is-ready');
}

/**
 * A chapter page: ties scrolling to the chapter's steps, owns the town, and
 * gives the chapter what it needs from the page.
 */
class Page {
  readonly host: Host;
  private module!: ChapterModule;
  private city!: City;
  private active = '';

  constructor(private readonly scene: Maquette) {
    this.host = {
      scene,
      hud: (label, value) => {
        bind('hudLabel', label);
        bind('hudValue', value);
      },
      enter: (step, force) => this.enter(step, force),
      active: () => this.active,
    };
  }

  start(module: ChapterModule): void {
    this.module = module;
    this.setCity(startingCity());
    this.bindScroll();
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('[data-action="new-city"]')) return;
      this.setCity(nextCity(this.city.inst.seed + 1));
      session.seed = this.city.inst.seed;
      this.enter(this.active, true);
    });
  }

  private setCity(city: City): void {
    this.city = city;
    this.scene.setInstance(city.inst);
    this.module.setCity(city);
  }

  private bindScroll(): void {
    // The step in charge is the last one whose top has passed a line: mid-screen
    // on desktop, lower on mobile where the model occupies the top half. Reading
    // positions, rather than waiting for a card to cross the line, also gets it
    // right after a jump (Home key, restored scroll position on reload).
    const steps = all('[data-step]');
    let reached: HTMLElement | null = null;
    let queued = false;
    const update = () => {
      queued = false;
      const line = window.innerHeight * (MOBILE.matches ? 0.72 : 0.5);
      let current = steps[0];
      for (const step of steps) {
        if (step.getBoundingClientRect().top <= line) current = step;
      }
      // Only a change of step takes over, so a card activated by hand keeps the
      // scene until the reader actually scrolls on to another one.
      if (current !== reached) {
        reached = current;
        this.enter(current.dataset.step!);
      }
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    followLayout(this.scene, schedule);
    update();

    // Touching a card's controls makes that card the active step, even off-centre.
    for (const step of steps) {
      const activate = () => this.enter(step.dataset.step!);
      step.addEventListener('pointerdown', activate, true);
      step.addEventListener('focusin', activate);
    }
  }

  private enter(step: string, force = false): void {
    if (step === this.active && !force) return;
    this.leave();
    this.active = step;
    for (const el of all('[data-step]')) el.classList.toggle('is-active', el.dataset.step === step);
    this.scene.setStage(this.module.stageOf?.(step) ?? 'town');
    this.module.steps[step]?.();
  }

  private leave(): void {
    this.module.leave();
    this.scene.setPicking(null);
    this.scene.setGhosts([]);
    this.scene.setAccent([]);
    this.scene.setMarked([]);
  }
}

/** Starts a chapter page. */
export async function boot(chapter: number): Promise<void> {
  polishTypography(one('#story'));
  try {
    const scene = await Maquette.create(one('#stage-canvas'));
    const page = new Page(scene);
    page.start(await CHAPTERS[chapter](page.host));
    ready(scene);
  } catch (error) {
    failed(error);
  }
}

/** Starts the home page: the opening town, its best tour, and a truck driving round it. */
export async function bootHome(): Promise<void> {
  polishTypography(one('#story'));
  // Coming back to the table of contents is a fresh start: the chapters open on the first town again.
  session.seed = null;
  try {
    const scene = await Maquette.create(one('#stage-canvas'));
    const { inst, optimum } = buildCity(OPENING.city)!;
    scene.setInstance(inst);
    scene.setView('intro');
    scene.setThread({ tour: optimum.tour, closed: true, color: COLOR.algo });
    scene.setPins(optimum.tour, COLOR.algo);
    scene.setTruck(optimum.tour);
    followLayout(scene);
    ready(scene);
  } catch (error) {
    failed(error);
  }
}
