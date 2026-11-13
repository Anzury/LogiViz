import { Maquette } from '../scene/maquette';
import { buildCity, nextCity, type City } from '../story/city';
import { OPENING } from '../story/opening';
import { typo } from './format';
import { bindLook, pixelChapter, pixelWanted } from './look';
import type { ChapterModule, Host, PageStage, TourStage } from './module';
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
function followLayout(scene: PageStage, onChange?: () => void): void {
  const story = one('#story');
  const layout = () => scene.setShift(MOBILE.matches ? 0 : story.getBoundingClientRect().right / 2);
  layout();
  window.addEventListener('resize', layout);
  MOBILE.addEventListener('change', () => {
    layout();
    onChange?.();
  });
}

/** The chapter menu of the console: opens under its button, closes on a choice, on Escape or on a click elsewhere. */
function bindMenu(): void {
  const toggle = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const menu = document.querySelector<HTMLElement>('#chapter-menu');
  if (!toggle || !menu) return;
  const set = (open: boolean) => {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => set(Boolean(menu.hidden)));
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !(e.target as HTMLElement).closest('.console-menu')) set(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || menu.hidden) return;
    set(false);
    toggle.focus();
  });
}

/**
 * The round button under a card: it brings the next card to where a card is
 * read, beside the model on a wide screen and just under it on a narrow one.
 */
function bindStepCues(): void {
  document.addEventListener('click', (e) => {
    const cue = (e.target as HTMLElement).closest<HTMLElement>('[data-step-next]');
    const here = cue?.closest<HTMLElement>('.step, .hero');
    let next = here?.nextElementSibling ?? null;
    while (next && !next.matches('.step, .onward')) next = next.nextElementSibling;
    if (!next) return;
    const stage = one('#stage');
    const offset = MOBILE.matches ? stage.getBoundingClientRect().height + 16 : window.innerHeight * 0.3;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: next.getBoundingClientRect().top + window.scrollY - offset, behavior: calm ? 'auto' : 'smooth' });
  });
}

/** The line of segments along the top of the window: one per step, filled up to the step being read. */
function progressBar(steps: number): (reached: number) => void {
  const bar = document.querySelector<HTMLElement>('.progress');
  if (!bar) return () => {};
  bar.replaceChildren(...Array.from({ length: steps }, () => document.createElement('i')));
  bar.setAttribute('aria-valuemax', String(steps));
  return (reached) => {
    [...bar.children].forEach((segment, i) => segment.classList.toggle('is-reached', i <= reached));
    bar.setAttribute('aria-valuenow', String(reached + 1));
    bar.setAttribute('aria-valuetext', `Étape ${reached + 1} sur ${steps}`);
  };
}

function failed(error: unknown): void {
  console.error(error);
  // The pixel-art look needs neither: the switch stays within reach.
  bind('stageStatus', 'Impossible d’afficher la maquette : ce navigateur ne propose ni WebGPU ni WebGL 2. Le rendu « Pixel », en haut à droite, fonctionne sans.');
}

function ready(scene: { backend: string }): void {
  // Development aid, absent from the published site: the name of what draws the scene.
  if (import.meta.env.DEV) bind('backend', scene.backend);
  one('#stage').classList.add('is-ready');
}

/**
 * A chapter page: ties scrolling to the chapter's steps, owns the town, and
 * gives the chapter what it needs from the page.
 */
class Page<S extends PageStage> {
  readonly host: Host<S>;
  private module!: ChapterModule;
  private city!: City;
  private active = '';
  private showProgress: (reached: number) => void = () => {};

  constructor(private readonly scene: S) {
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
    this.showProgress = progressBar(steps.length);
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
    all('[data-step]').forEach((el, i) => {
      el.classList.toggle('is-active', el.dataset.step === step);
      if (el.dataset.step === step) this.showProgress(i);
    });
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
  bindMenu();
  bindStepCues();
  bindLook(chapter);
  try {
    // The reader may have chosen the pixel-art stage: it is loaded only then.
    const pixel = pixelChapter(chapter);
    if (pixel) {
      const { PixelStage } = await import('../pixel/stage');
      const scene = await PixelStage.create(one('#stage-canvas'));
      const page = new Page(scene);
      page.start(await pixel(page.host));
      ready(scene);
      return;
    }
    const scene = await Maquette.create(one('#stage-canvas'));
    const page = new Page(scene);
    page.start(await CHAPTERS[chapter](page.host));
    ready(scene);
  } catch (error) {
    failed(error);
  }
}

/** The home page's picture: the opening town, its best tour, and a truck driving round it. */
function showOpening(scene: TourStage): void {
  const { inst, optimum } = buildCity(OPENING.city)!;
  scene.setInstance(inst);
  scene.setView('intro');
  scene.setThread({ tour: optimum.tour, closed: true, color: COLOR.algo });
  scene.setPins(optimum.tour, COLOR.algo);
  scene.setTruck(optimum.tour);
  followLayout(scene);
}

/** Starts the home page. */
export async function bootHome(): Promise<void> {
  polishTypography(one('#story'));
  bindMenu();
  bindLook(0);
  // Coming back to the table of contents is a fresh start: the chapters open on the first town again.
  session.seed = null;
  try {
    if (pixelWanted()) {
      const { PixelStage } = await import('../pixel/stage');
      const scene = await PixelStage.create(one('#stage-canvas'));
      showOpening(scene);
      ready(scene);
      return;
    }
    const scene = await Maquette.create(one('#stage-canvas'));
    showOpening(scene);
    ready(scene);
  } catch (error) {
    failed(error);
  }
}
