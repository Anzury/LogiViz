/** The chapters, in reading order: the table of contents and the links between pages are built from this. */
export interface ChapterInfo {
  number: number;
  title: string;
  /** One or two sentences: the card on the home page and the chapter's own introduction. */
  summary: string;
}

export const CHAPTERS: ChapterInfo[] = [
  {
    number: 1,
    title: 'Un seul camion',
    summary: 'Tracer une tournée à la main, voir pourquoi on ne peut pas tout essayer, puis laisser faire la règle du plus proche voisin.',
  },
  {
    number: 2,
    title: 'Améliorer la tournée',
    summary: 'Décroiser les fils : la recherche locale et le 2-opt, jusqu’au moment où plus rien ne s’améliore.',
  },
  {
    number: 3,
    title: 'Sortir du piège',
    summary: 'Un relief en carton, une bille, et le recuit simulé pour quitter les cuvettes où la recherche locale reste coincée.',
  },
  {
    number: 4,
    title: 'Plusieurs camions',
    summary: 'Des colis et une capacité : découper la grande tournée, fusionner pour économiser, changer une maison de camion.',
  },
  {
    number: 5,
    title: 'Être à l’heure',
    summary: 'Chaque client a son créneau horaire : la maquette bascule, et la hauteur devient le temps.',
  },
  {
    number: 6,
    title: 'Détruire pour reconstruire',
    summary: 'Soulever quelques maisons et les reposer autrement : la recherche à grand voisinage.',
  },
  {
    number: 7,
    title: 'Prouver qu’on ne peut pas faire mieux',
    summary: 'Un plancher sous toutes les tournées, des familles que l’on coupe par millions : la séparation et évaluation.',
  },
  {
    number: 8,
    title: 'Le monde réel',
    summary: 'De vraies rues, une rivière et deux ponts, des commandes qui arrivent pendant que le camion roule.',
  },
];

/** What comes after the last chapter written, announced at its end and on the home page. */
export const UPCOMING = {
  label: 'À venir',
  title: 'D’autres problèmes de logistique',
  summary: 'Les tournées ne sont qu’une famille de problèmes. Viendront ensuite : ranger des colis dans un camion, organiser un entrepôt, choisir où implanter un dépôt.',
};

/** Address of the home page: the site's base URL, which may or may not come with its final slash. */
export function homeHref(base: string): string {
  return base.replace(/\/?$/, '/');
}

/** Address of a chapter's page under the site's base URL. */
export function chapterHref(base: string, number: number): string {
  return `${homeHref(base)}chapitre-${number}/`;
}
