import type { PixelStage } from '../pixel/stage';
import { typo } from './format';
import type { ChapterModule, Host } from './module';

/**
 * Development aid: a switch between the 3D model and the pixel-art stage, on
 * the chapters that stage can already play. The choice is remembered for the
 * tab, so it holds from one chapter to the next. Absent from the published site.
 */
type Look = 'maquette' | 'pixel';

const KEY = 'logiviz-look';

/** The chapters the pixel-art stage can play. */
const PIXEL_CHAPTERS: Record<number, (host: Host<PixelStage>) => Promise<ChapterModule>> = {
  1: async (host) => new (await import('./tour')).Tour(host),
  2: async (host) => new (await import('./improve')).Improve(host),
  3: async (host) => new (await import('./escape')).Escape(host),
  4: async (host) => new (await import('./fleet')).Fleet(host),
  5: async (host) => new (await import('./hours')).Hours(host),
  6: async (host) => new (await import('./rebuild')).Rebuild(host),
  7: async (host) => new (await import('./prove')).Prove(host),
  8: async (host) => new (await import('./world')).World(host),
};

/**
 * Where a chapter's text describes how the 3D model shows something, what it
 * says instead on the pixel-art stage: a title, and paragraphs by their rank
 * in the step's card.
 */
const PIXEL_TEXTS: Record<number, { step: string; title?: string; paragraphs?: Record<number, string>; swaps?: [string, string][] }[]> = {
  5: [
    {
      step: 'hours',
      paragraphs: {
        0: 'Laissons les colis de côté. Cette fois, chaque client a donné un <strong>créneau</strong> : la jauge au-dessus de sa maison représente la matinée, de 8 h à 13 h, et sa partie claire les heures où il peut recevoir le livreur.',
        2: 'La meilleure tournée du chapitre 3 est là, en gris. Est-elle à l’heure ? Sur la carte seule, impossible à dire : il manque l’heure à laquelle le camion passe chez chacun.',
      },
    },
    {
      step: 'tilt',
      title: 'Le tableau des horaires',
      paragraphs: {
        0: 'Posons un tableau à côté de la ville. Chaque ligne est une maison, dans l’ordre de la tournée, et le temps s’y lit de gauche à droite, de 8 h à 13 h.',
        1: 'Sur chaque ligne, la <strong>bande claire</strong> est le créneau du client. Une tournée y dessine un escalier : un trait qui descend pendant que le camion roule, un bloc pendant qu’il livre.',
        2: 'Être à l’heure, c’est poser chaque bloc sur sa bande claire. Le numéro d’un arrêt, sur la carte, est celui de sa ligne dans le tableau.',
      },
    },
    {
      step: 'late',
      paragraphs: {
        0: 'Suivons cette tournée, montre en main. Un bloc de couleur sur la bande claire : livré à temps. Des pointillés avant la bande : le livreur attend. Des hachures, puis un bloc noir après la bande : trop tard.',
      },
    },
    {
      step: 'tw-draw',
      paragraphs: {
        0: 'Clique les maisons dans l’ordre de ta tournée : chaque livraison s’ajoute au tableau. Un clic est refusé s’il fait arriver trop tard. Clique le <strong>dépôt</strong> pour faire rentrer le camion et en sortir un autre, qui repart à 8 h.',
      },
    },
  ],
};

PIXEL_TEXTS[6] = [
  {
    step: 'lns-result',
    paragraphs: { 0: 'Reprenons le tableau des horaires pour relire le résultat avec la montre.' },
  },
];

// Further down a card, a paragraph is found by a few of its words rather than by its rank.
PIXEL_TEXTS[7] = [
  {
    step: 'branch',
    swaps: [
      [
        'cela dessine un arbre',
        'Sur le tableau, cela dessine un arbre : le dépôt en haut, une colonne par première maison, et sous chaque colonne une case par deuxième maison. Les numéros sont ceux que portent les maisons sur la carte.',
      ],
    ],
  },
  {
    step: 'prune',
    swaps: [
      [
        'reste un moignon',
        'Sur le tableau, une famille abandonnée se réduit à un petit carré gris ; une famille gardée est un carré plein. Sur le plateau, le fil bleu est le début fixé et le réseau gris ce qui borne le reste.',
      ],
    ],
  },
];

PIXEL_TEXTS[3] = [
  {
    step: 'shake',
    swaps: [
      [
        'épingle dorée',
        'Une cuvette profonde est plus difficile à quitter qu’une petite : en refroidissant lentement, la bille a de bonnes chances de finir dans la plus profonde. Le drapeau doré marque le point le plus bas qu’elle a visité.',
      ],
    ],
  },
];

/** The same for a chapter's summary under its title. */
const PIXEL_SUMMARIES: Record<number, string> = {
  5: 'Chaque client a son créneau horaire : un tableau des horaires vient se poser à côté de la ville.',
};

function recall(): Look {
  try {
    return sessionStorage.getItem(KEY) === 'pixel' ? 'pixel' : 'maquette';
  } catch {
    return 'maquette';
  }
}

/** Whether the reader chose the pixel-art stage; the home page asks before picking what draws its town. */
export const pixelWanted = () => recall() === 'pixel';

/** The home page counts as chapter 0: it has both looks too. */
const HOME = 0;

/** How to start a chapter on the pixel-art stage, when the reader chose it and the chapter can be. */
export function pixelChapter(chapter: number): ((host: Host<PixelStage>) => Promise<ChapterModule>) | null {
  return recall() === 'pixel' ? (PIXEL_CHAPTERS[chapter] ?? null) : null;
}

function rewordForPixels(chapter: number): void {
  // The pixel-art picture has no camera to turn: the invitation to drag it goes.
  const hint = document.querySelector<HTMLElement>('.hero .hint');
  if (hint && chapter === HOME) hint.hidden = true;
  else if (hint) hint.textContent = 'Fais défiler pour avancer.';
  const summary = document.querySelector('.hero .lede');
  if (summary && PIXEL_SUMMARIES[chapter]) summary.textContent = typo(PIXEL_SUMMARIES[chapter]);
  for (const { step, title, paragraphs = {}, swaps = [] } of PIXEL_TEXTS[chapter] ?? []) {
    const card = document.querySelector(`[data-step="${step}"] > .card`);
    if (!card) continue;
    const heading = card.querySelector(':scope > h3');
    if (title && heading) heading.textContent = title;
    const own = card.querySelectorAll(':scope > p');
    for (const [rank, html] of Object.entries(paragraphs)) {
      const paragraph = own[Number(rank)];
      if (paragraph) paragraph.innerHTML = typo(html);
    }
    for (const [words, html] of swaps) {
      const paragraph = [...own].find((candidate) => candidate.textContent?.includes(words));
      if (paragraph) paragraph.innerHTML = typo(html);
    }
  }
}

/** Shows the switch on the chapters that have both looks. Changing look starts the page again. */
export function bindLook(chapter?: number): void {
  const panel = document.querySelector<HTMLElement>('.console-look');
  if (!panel || chapter === undefined || (chapter !== HOME && !PIXEL_CHAPTERS[chapter])) return;
  panel.hidden = false;
  const look = recall();
  for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-look]')) {
    button.setAttribute('aria-pressed', String(button.dataset.look === look));
  }
  if (look === 'pixel') rewordForPixels(chapter);
  panel.addEventListener('click', (e) => {
    const chosen = (e.target as HTMLElement).closest<HTMLElement>('[data-look]')?.dataset.look;
    if ((chosen !== 'maquette' && chosen !== 'pixel') || chosen === look) return;
    try {
      sessionStorage.setItem(KEY, chosen);
    } catch {
      return;
    }
    location.reload();
  });
}
