# LogiViz

Un site éducatif sur les algorithmes de la logistique : des guides visuels, pas à pas, qui expliquent les problèmes de tournées de véhicules et les méthodes pour les résoudre, sur une maquette en 3D que l'on peut manipuler.

Six chapitres sont écrits :

1. **Un seul camion** : tracer une tournée, l'explosion combinatoire, le plus proche voisin.
2. **Améliorer la tournée** : la recherche locale et le 2-opt.
3. **Sortir du piège** : les optimums locaux et le recuit simulé.
4. **Plusieurs camions** : la capacité, les économies de Clarke et Wright, les déplacements.
5. **Être à l'heure** : les créneaux horaires, où la hauteur de la maquette devient le temps.
6. **Détruire pour reconstruire** : la recherche à grand voisinage.

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

Le rendu utilise WebGPU quand le navigateur le propose et se replie sur WebGL 2 sinon. Ajouter `?webgl` à l'adresse force le repli.

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
