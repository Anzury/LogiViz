# LogiViz

Un site éducatif sur les algorithmes de la logistique : des guides visuels, pas à pas, qui expliquent les problèmes de tournées de véhicules et les méthodes pour les résoudre, sur une maquette en 3D que l'on peut manipuler.

Huit chapitres sont écrits :

1. **Un seul camion** : tracer une tournée, l'explosion combinatoire, le plus proche voisin.
2. **Améliorer la tournée** : la recherche locale et le 2-opt.
3. **Sortir du piège** : les optimums locaux et le recuit simulé.
4. **Plusieurs camions** : la capacité, les économies de Clarke et Wright, les déplacements.
5. **Être à l'heure** : les créneaux horaires, où la hauteur de la maquette devient le temps.
6. **Détruire pour reconstruire** : la recherche à grand voisinage.
7. **Prouver qu'on ne peut pas faire mieux** : les bornes, la séparation et évaluation.
8. **Le monde réel** : un réseau de rues, le plus court chemin, des commandes qui arrivent en cours de tournée.

## Lancer le site

Il faut Node.js 22 ou plus récent.

```bash
npm install
npm run dev
```

Le site est alors servi sur `http://localhost:4321`. Les autres commandes :

| Commande | Effet |
|---|---|
| `npm test` | lance les tests des algorithmes |
| `npm run build` | construit le site statique dans `dist/` |
| `npm run preview` | sert le site construit |

Le rendu utilise WebGPU quand le navigateur le propose et se replie sur WebGL 2 sinon.

Quatre aides n'existent qu'avec `npm run dev` et sont absentes du site construit :

- dans la console en haut à droite, le nom de ce qui dessine la scène (WebGPU, WebGL2 ou pixel) ;
- le paramètre `?webgl`, qui force le repli quand on l'ajoute à l'adresse ;
- le commutateur « Maquette / Pixel », dans la même console, sur l'accueil et les huit chapitres : il rejoue le chapitre sur une scène en pixel art (`src/pixel/stage.ts`) au lieu de la maquette 3D. C'est un essai : cette scène répond aux mêmes demandes que la maquette (les types `…Stage` de `src/chapter/module.ts` disent lesquelles, chapitre par chapitre), et le choix est retenu d'un chapitre à l'autre. Les phrases qui décrivent la maquette 3D y sont remplacées par celles de `src/chapter/devLook.ts`. ;
- la page `/etude-pixel/`, une planche d'étude : deux scènes de la ville d'ouverture redessinées élément par élément pour le pixel art (`src/etudes/`), dont les créneaux horaires du chapitre 5. Elle est ajoutée aux routes par `astro.config.mjs` en développement seulement.

Le dessin en pixels vit dans `src/pixel/` : `kit.ts` (palette par rôle, police, éléments), `town.ts` (la ville, ses rues et l'empilement des couches), `timed.ts` (jauges de créneaux et tableau des horaires), `tree.ts` (l'arbre de recherche à plat), `relief.ts` (le paysage en terrasses) et `stage.ts` (la scène animée).

## Mise en ligne

Le site est entièrement statique : `npm run build` produit dans `dist/` tout ce qu'il faut servir.

Le dépôt contient de quoi le publier sur GitHub Pages. À chaque push sur `main`, le workflow `.github/workflows/deploy.yml` construit le site et le met en ligne à l'adresse `https://<compte>.github.io/<dépôt>/`. Il suffit de l'autoriser une fois : dans le dépôt, *Settings* > *Pages* > *Source* : « GitHub Actions ».

Comme le site est alors servi dans un sous-dossier, `astro.config.mjs` lit deux variables d'environnement, `SITE_URL` et `BASE_PATH`, que le workflow renseigne. Sans elles, le site se construit pour la racine d'un domaine, ce qui convient à la plupart des autres hébergeurs.

Pour essayer le site tel qu'il sera publié, depuis PowerShell :

```bash
npx astro build --base /LogiViz
npx astro preview --base /LogiViz
```

Dans Git Bash, `/LogiViz` serait transformé en chemin Windows : y faire précéder chaque commande de `MSYS_NO_PATHCONV=1`.

## Organisation du code

| Dossier | Contenu |
|---|---|
| `src/core/` | Les algorithmes, en TypeScript pur, sans rendu ni DOM. Chacun est un générateur qui émet une *trace* : un événement par étape, avec un instantané complet de la solution. |
| `src/story/` | Ce que les chapitres calculent pour une ville donnée, et les tirages figés de la ville d'ouverture. |
| `src/scene/` | La maquette Three.js. Elle ne connaît aucun algorithme : on lui dit quels fils tendre, quelles maisons soulever. |
| `src/chapter/` | Un module par chapitre, qui traduit les événements d'une trace en état de la scène, plus ce qu'ils partagent (lecteur pas à pas, courbes, listes). |
| `src/pages/` | Le texte : une page MDX par chapitre, et la page d'accueil. |
| `src/chapters.ts` | La liste des chapitres, d'où viennent le sommaire et les liens entre pages. |

Comme une trace porte un instantané à chaque événement, le lecteur peut avancer, reculer ou sauter n'importe où sans relancer l'algorithme, et la scène, le pseudo-code et les courbes lisent tous le même événement.

## La ville d'ouverture

Chaque chapitre s'ouvre sur la même ville, choisie pour que toute l'histoire s'y raconte : un vrai croisement à défaire, un optimum local que le recuit franchit, des créneaux que la tournée la plus courte ne respecte pas. Chercher cette ville et ces tirages prend un moment, donc leur résultat est figé dans `src/story/opening.ts`.

Un test compare ces valeurs à ce que la recherche trouve. S'il échoue après la modification d'un algorithme, il affiche les nouvelles valeurs à recopier.

## Ajouter un chapitre

1. Écrire l'algorithme dans `src/core/`, avec ses tests et son pseudo-code.
2. Écrire le module du chapitre dans `src/chapter/` (interface `ChapterModule`) et l'enregistrer dans `src/chapter/page.ts`.
3. Ajouter le chapitre à `src/chapters.ts` et écrire sa page `src/pages/chapitre-N.mdx`.
