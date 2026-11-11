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
];

/** The next chapter to be written, announced at the end of the last one. */
export const UPCOMING: ChapterInfo = {
  number: 7,
  title: 'Prouver qu’on ne peut pas faire mieux',
  summary: 'Toutes ces méthodes cherchent de bons plans sans jamais prouver qu’ils sont les meilleurs. Pour cela, il faut des bornes, et une façon d’explorer sans tout essayer.',
};

/** Address of a chapter's page under the site's base URL. */
export function chapterHref(base: string, number: number): string {
  return `${base.replace(/\/?$/, '/')}chapitre-${number}/`;
}
