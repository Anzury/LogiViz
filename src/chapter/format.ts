import type { BranchEvent } from '../core/branchBound';
import type { FleetEvent, FleetProblem, MoveEvent } from '../core/fleet';
import type { DynamicEvent } from '../core/dynamic';
import type { LnsEvent } from '../core/lns';
import type { RoadEvent } from '../core/roads';
import type { TimedEvent, TimedProblem } from '../core/timeWindows';
import { UNITS_PER_KM, type Instance } from '../core/instance';
import { nearestMinimum, type Landscape, type WalkEvent } from '../core/landscape';
import type { TraceEvent } from '../core/trace';

const NBSP = ' ';

/** French typography: a narrow no-break space before ; : ? ! so they never start a line. */
export function typo(text: string): string {
  return text.replace(/ ([;:?!])/g, ' $1');
}

/** A board distance as kilometres, French formatting: "34,2 km". */
export function km(cost: number): string {
  const value = (cost / UNITS_PER_KM).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${value}${NBSP}km`;
}

export function percent(ratio: number): string {
  const value = (ratio * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return `${value}${NBSP}%`;
}

export function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString('fr-FR')}${NBSP}${n > 1 ? many : one}`;
}

/** Number of distinct round trips through `houses` houses and one depot: n! / 2. */
export function tourCount(houses: number): bigint {
  let product = 1n;
  for (let k = 2n; k <= BigInt(houses); k++) product *= k;
  return houses < 3 ? 1n : product / 2n;
}

const UNIVERSE_AGE_YEARS = 13.8e9;

/** A duration in seconds, in whichever unit a person would use. */
export function duration(seconds: number): string {
  const round = (value: number) => Number(value.toPrecision(2));
  if (seconds < 1) return 'moins d’une seconde';
  if (seconds < 60) return count(Math.round(seconds), 'seconde', 'secondes');
  if (seconds < 3600) return count(Math.round(seconds / 60), 'minute', 'minutes');
  if (seconds < 86400) return count(Math.round(seconds / 3600), 'heure', 'heures');
  const days = seconds / 86400;
  if (days < 365) return count(Math.round(days), 'jour', 'jours');
  const years = days / 365.25;
  if (years < 1e6) return count(round(years), 'an', 'ans');
  if (years < 1e9) return `${count(round(years / 1e6), 'million', 'millions')} d’années`;
  const text = `${count(round(years / 1e9), 'milliard', 'milliards')} d’années`;
  const universes = Math.round(years / UNIVERSE_AGE_YEARS);
  return universes >= 2 ? `${text}, soit ${universes.toLocaleString('fr-FR')} fois l’âge de l’Univers` : text;
}

/** One sentence saying what the algorithm just did. */
export function describe(ev: TraceEvent, inst: Instance): string {
  const houses = inst.nodes.length - 1;
  switch (ev.kind) {
    case 'nn-start':
      return 'Le camion est au dépôt, aucune maison n’est livrée.';
    case 'nn-consider': {
      const measured = count(ev.candidates.length, 'maison mesurée', 'maisons mesurées');
      return `${measured} : la plus proche est à ${km(inst.dist[ev.from][ev.nearest])}.`;
    }
    case 'nn-extend':
      return `Le camion y va. ${ev.tour.length - 1} sur ${houses} livrées, ${km(ev.cost)} parcourus.`;
    case 'nn-close':
      return `Tout est livré : retour au dépôt. La tournée mesure ${km(ev.cost)}.`;
    case '2opt-start':
      return `Tournée de départ : ${km(ev.cost)}.`;
    case '2opt-examine':
      return ev.gain > 1e-9
        ? `Renouer ces deux fils ferait gagner ${km(ev.gain)}.`
        : `Renouer ces deux fils rallongerait de ${km(-ev.gain)} : on les laisse.`;
    case '2opt-apply':
      return `Renoués : ${km(ev.gain)} de moins. La tournée passe à ${km(ev.cost)}.`;
    case '2opt-done':
      return ev.moves === 0
        ? `Aucune paire n’améliore cette tournée : elle était déjà un optimum local.`
        : `Plus aucune paire n’améliore : optimum local à ${km(ev.cost)}, après ${count(ev.moves, 'renouage', 'renouages')}.`;
    case 'sa-start':
      return `Départ sur l’optimum local du 2-opt : ${km(ev.cost)}. La température est haute.`;
    case 'sa-propose':
      if (!ev.accepted) return `Renouer rallongerait de ${km(ev.delta)} : refusé (${percent(ev.probability)} de chances).`;
      if (ev.delta > 0) {
        return `Accepté malgré ${km(ev.delta)} de plus (${percent(ev.probability)} de chances). La tournée remonte à ${km(ev.cost)}.`;
      }
      return ev.record ? `Nouveau record : ${km(ev.cost)}.` : `${km(-ev.delta)} de moins : accepté. Tournée à ${km(ev.cost)}.`;
    case 'sa-done':
      return `Refroidi. Meilleure tournée rencontrée : ${km(ev.cost)}.`;
  }
}

export const parcels = (n: number) => count(n, 'colis', 'colis');
const trucks = (n: number) => count(n, 'camion', 'camions');

/** One sentence saying what a fleet algorithm just did. */
export function describeFleet(ev: FleetEvent, problem: FleetProblem): string {
  const { demand, capacity } = problem;
  const fleet = ev.routes.filter((route) => route.nodes.length > 0).length;
  switch (ev.kind) {
    case 'cut-start':
      return 'On suit la meilleure tournée unique. Le premier camion part du dépôt.';
    case 'cut-load':
      return `${parcels(demand[ev.node])} pour cette maison : le camion en transporte ${ev.load} sur ${capacity}.`;
    case 'cut-full':
      return `La maison suivante attend ${parcels(demand[ev.node])}, il ne reste que ${count(capacity - ev.load, 'place', 'places')} : le camion rentre, un autre repart.`;
    case 'cut-done':
      return `Découpage terminé : ${trucks(fleet)}, ${km(ev.cost)} en tout.`;
    case 'cw-start':
      return `Un camion par maison : ${trucks(fleet)}, ${km(ev.cost)}.`;
    case 'cw-consider': {
      const saving = `Relier ces deux maisons économiserait ${km(ev.saving)}`;
      if (ev.verdict === 'merge') return `${saving}, pour ${ev.load} colis sur ${capacity} : on fusionne.`;
      if (ev.verdict === 'same-route') return `${saving}, mais elles sont déjà dans la même tournée.`;
      if (ev.verdict === 'interior') return `${saving}, mais l’une des deux est au milieu de sa tournée.`;
      return `${saving}, mais il faudrait porter ${ev.load} colis pour ${count(capacity, 'place', 'places')}.`;
    }
    case 'cw-merge':
      return `Fusionnées. Il reste ${trucks(fleet)}, pour ${km(ev.cost)}.`;
    case 'cw-done':
      return `Plus aucune fusion possible : ${trucks(fleet)}, ${km(ev.cost)}.`;
    case 'move-start':
    case 'move-pick':
    case 'move-apply':
    case 'move-done':
      return describeMove(ev);
  }
}

/** The relocation search reads the same whatever constraint it works under. */
function describeMove(ev: MoveEvent): string {
  switch (ev.kind) {
    case 'move-start':
      return `Point de départ : ${km(ev.cost)}.`;
    case 'move-pick':
      return `Déplacer cette maison ${ev.from === ev.to ? 'dans sa tournée' : 'vers un autre camion'} ferait gagner ${km(ev.gain)}.`;
    case 'move-apply':
      return `Déplacée : ${km(ev.gain)} de moins. Total : ${km(ev.cost)}.`;
    case 'move-done':
      return ev.moves === 0
        ? 'Aucun déplacement ne fait gagner : il n’y a rien à retoucher ici.'
        : `Plus aucun déplacement ne fait gagner : ${km(ev.cost)}, après ${count(ev.moves, 'déplacement', 'déplacements')}.`;
  }
}

/** A time of day in words: "9 h 30". */
export function hour(minutes: number): string {
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h}${NBSP}h` : `${h}${NBSP}h${NBSP}${String(m).padStart(2, '0')}`;
}

/** A time window, compact enough for a label on the model: "9h–10h30". */
export function span(open: number, close: number): string {
  const short = (minutes: number) => hour(minutes).replaceAll(NBSP, '');
  return `${short(open)}–${short(close)}`;
}

const minutes = (n: number) => `${Math.max(1, Math.round(n))}${NBSP}min`;

/** One sentence saying what just happened in a time-window algorithm. */
export function describeTimed(ev: TimedEvent, problem: TimedProblem): string {
  const fleet = ev.routes.filter((route) => route.nodes.length > 0).length;
  const houses = problem.inst.nodes.length - 1;
  switch (ev.kind) {
    case 'clock-start':
      return `Le camion quitte le dépôt à ${hour(problem.open[0])}.`;
    case 'clock-visit': {
      const { node, arrive, wait, late } = ev.stop;
      if (late > 0) return `Arrivée à ${hour(arrive)} : le créneau a fermé à ${hour(problem.close[node])}. ${minutes(late)} de retard.`;
      if (wait >= 1) return `Arrivée à ${hour(arrive)}, mais le créneau n’ouvre qu’à ${hour(problem.open[node])} : ${minutes(wait)} d’attente.`;
      return `Arrivée à ${hour(arrive)}, dans le créneau : livré.`;
    }
    case 'clock-done':
      return ev.late === 0
        ? `Retour au dépôt à ${hour(ev.back)} : tout le monde est livré à l’heure.`
        : `Retour au dépôt à ${hour(ev.back)}. ${count(ev.late, 'livraison', 'livraisons')} en retard sur ${houses}.`;
    case 'ins-start':
      return 'Aucun camion n’est encore sorti. On commence par la maison la plus pressée.';
    case 'ins-consider':
      if (ev.route !== null) {
        const refused = ev.refused > 0 ? `, ${ev.refused} écartées pour retard` : '';
        return `${count(ev.fits, 'place possible', 'places possibles')}${refused} : la meilleure rallonge de ${km(ev.detour)}.`;
      }
      if (ev.fits > 0) return 'Un camion de plus coûte ici moins cher que la meilleure place.';
      return ev.refused === 0
        ? 'Aucune tournée n’existe encore : un camion sort pour cette maison.'
        : `${count(ev.refused, 'place essayée', 'places essayées')}, toutes en retard : il faut un camion de plus.`;
    case 'ins-place':
      return ev.fresh
        ? `Un camion sort : ${km(ev.detour)} d’aller-retour. Total : ${km(ev.cost)}.`
        : `Insérée : ${km(ev.detour)} de plus. Total : ${km(ev.cost)}.`;
    case 'ins-done':
      return `Tout le monde est placé : ${trucks(fleet)}, ${km(ev.cost)}, personne en retard.`;
    case 'move-start':
    case 'move-pick':
    case 'move-apply':
    case 'move-done':
      return describeMove(ev);
  }
}

/** How long a time-window event stays on screen at normal speed, in milliseconds. */
export function dwellTimed(ev: TimedEvent): number {
  switch (ev.kind) {
    case 'clock-visit':
      return ev.stop.late > 0 ? 1500 : 900;
    case 'ins-consider':
      return 1000;
    case 'ins-place':
      return 800;
    case 'move-pick':
      return 1400;
    case 'move-apply':
      return 1100;
    default:
      return 800;
  }
}

export { minutes };

/** One sentence saying what the shortest-way search just did. */
export function describeRoad(ev: RoadEvent): string {
  const tally = `${count(ev.reached.length, 'carrefour traité', 'carrefours traités')}, ${ev.frontier.length} en attente`;
  switch (ev.kind) {
    case 'dj-start':
      return 'Le départ est à distance zéro. Tout le reste est encore inconnu.';
    case 'dj-settle':
      return `Le plus proche des carrefours en attente est à ${km(ev.dist)} du départ : traité. ${tally}.`;
    case 'dj-done':
      return `L’arrivée est atteinte : ${km(ev.dist)} par la route, après ${count(ev.reached.length, 'carrefour traité', 'carrefours traités')}.`;
  }
}

export function dwellRoad(ev: RoadEvent): number {
  return ev.kind === 'dj-settle' ? 170 : 1200;
}

/** One sentence saying what just happened on a morning where orders keep coming in. */
export function describeDynamic(ev: DynamicEvent, dayStart: number): string {
  const now = hour(dayStart + ev.clock);
  switch (ev.kind) {
    case 'dyn-start':
      return `${hour(dayStart)} : ${count(ev.plan.length, 'commande connue', 'commandes connues')}. Le camion part sur la meilleure tournée pour celles-là.`;
    case 'dyn-order':
      return `Une commande est arrivée à ${hour(dayStart + ev.release)} : glissée dans la suite de la tournée, pour ${km(ev.detour)} de plus.`;
    case 'dyn-drive':
      return ev.to === 0
        ? `Retour au dépôt à ${now}, après ${km(ev.driven)}.`
        : `Livrée à ${now}. Il reste ${count(ev.plan.length, 'arrêt prévu', 'arrêts prévus')}.`;
    case 'dyn-wait':
      return `Plus rien à livrer : le camion attend au dépôt jusqu’à ${now}.`;
    case 'dyn-done':
      return `Journée finie à ${now} : ${km(ev.driven)} roulés.`;
  }
}

export function dwellDynamic(ev: DynamicEvent): number {
  return ev.kind === 'dyn-order' ? 1700 : 1000;
}

/** One sentence saying what the branch and bound just did. */
export function describeBranch(ev: BranchEvent): string {
  switch (ev.kind) {
    case 'bb-start':
      return `Meilleure tournée connue : ${km(ev.best)}. Aucune ne peut faire moins de ${km(ev.bound)}.`;
    case 'bb-node': {
      const total = `${km(ev.driven)} déjà fixés, au moins ${km(ev.bound - ev.driven)} pour le reste : ${km(ev.bound)} au mieux`;
      return ev.pruned
        ? `${total}. Pas moins que ${km(ev.best)} : famille abandonnée.`
        : `${total}. Cela pourrait battre ${km(ev.best)} : on regarde de plus près.`;
    }
    case 'bb-below': {
      const found = ev.improved ? ' Une meilleure tournée y a été trouvée.' : '';
      return `${count(ev.examinedBelow, 'famille examinée', 'familles examinées')} plus bas dans cette branche, dont ${ev.cutBelow.toLocaleString('fr-FR')} abandonnées.${found}`;
    }
    case 'bb-best':
      return `Tournée complète de ${km(ev.best)} : elle bat les ${km(ev.previous)} connus et prend leur place.`;
    case 'bb-done':
      return `Plus aucune famille à examiner : ${km(ev.best)} est la meilleure tournée possible.`;
  }
}

/** How long a branch-and-bound event stays on screen at normal speed, in milliseconds. */
export function dwellBranch(ev: BranchEvent): number {
  switch (ev.kind) {
    case 'bb-node':
      return ev.pruned ? 320 : 520;
    case 'bb-below':
      return 520;
    case 'bb-best':
      return 1500;
    default:
      return 900;
  }
}

/** One sentence saying what the large neighbourhood search just did. */
export function describeLns(ev: LnsEvent): string {
  switch (ev.kind) {
    case 'lns-start':
      return `Plan de départ : ${km(ev.cost)}, à l’heure partout.`;
    case 'lns-destroy':
      return `Essai ${ev.round} : ${count(ev.removed.length, 'maison retirée', 'maisons retirées')}. Les fils se referment sans elles.`;
    case 'lns-repair': {
      const left = ev.waiting.length > 0 ? ` Encore ${ev.waiting.length} à reposer.` : '';
      return ev.fresh
        ? `Reposée dans un camion de plus : aucune place à l’heure ne coûtait moins.${left}`
        : `Reposée à sa meilleure place à l’heure : ${km(ev.detour)} de détour.${left}`;
    }
    case 'lns-polish':
      return `${count(ev.moves, 'retouche', 'retouches')} sur le plan reconstruit : ${km(ev.gain)} de moins.`;
    case 'lns-verdict':
      if (ev.accepted) return `Plus court : ${km(ev.after)} au lieu de ${km(ev.before)}. On garde ce plan.`;
      return ev.after > ev.before + 0.05
        ? `Plus long : ${km(ev.after)} contre ${km(ev.before)}. On revient au plan précédent.`
        : `Même longueur qu’avant : rien de gagné, on revient au plan précédent.`;
    case 'lns-done': {
      const tally = `${count(ev.rounds, 'essai', 'essais')}, dont ${count(ev.improvements, 'réussi', 'réussis')}`;
      return ev.exhausted
        ? `Dix essais de suite sans progrès : on s’arrête à ${km(ev.cost)}. ${tally}.`
        : `Limite d’essais atteinte : on s’arrête à ${km(ev.cost)}. ${tally}.`;
    }
  }
}

/** How long an event of the large neighbourhood search stays on screen at normal speed. */
export function dwellLns(ev: LnsEvent): number {
  switch (ev.kind) {
    case 'lns-destroy':
      return 1300;
    case 'lns-repair':
      return 650;
    case 'lns-polish':
      return 900;
    case 'lns-verdict':
      return ev.accepted ? 1600 : 800;
    default:
      return 900;
  }
}

/** How long a fleet event stays on screen at normal speed, in milliseconds. */
export function dwellFleet(ev: FleetEvent): number {
  switch (ev.kind) {
    case 'cut-load':
      return 450;
    case 'cut-full':
      return 1100;
    case 'cw-consider':
      return ev.verdict === 'merge' ? 900 : ev.verdict === 'overload' ? 600 : 240;
    case 'cw-merge':
      return 800;
    case 'move-pick':
      return 1400;
    case 'move-apply':
      return 1100;
    default:
      return 700;
  }
}

/** A landscape height on the 0 to 100 scale used in the text. */
export function altitude(height: number): string {
  return String(Math.round(height * 100));
}

/** One sentence saying what the marble just did on the relief. */
export function describeWalk(ev: WalkEvent, land: Landscape): string {
  const hot = ev.temperature > 0;
  const deepest = land.minima[0];
  switch (ev.kind) {
    case 'start':
      return `La bille est posée à l’altitude ${altitude(ev.at.height)}.`;
    case 'step': {
      const amount = Math.round(Math.abs(ev.delta) * 100);
      const by = amount >= 1 ? `de ${amount}` : 'à peine';
      if (ev.delta <= 0) return `Ce pas descend ${by} : accepté. Altitude ${altitude(ev.at.height)}.`;
      if (!hot) return `Ce pas monterait ${by} : refusé.`;
      return ev.accepted
        ? `Ce pas monte ${by} : accepté quand même (${percent(ev.probability)} de chances).`
        : `Ce pas monterait ${by} : refusé (${percent(ev.probability)} de chances).`;
    }
    case 'end': {
      const found = nearestMinimum(land, hot ? ev.best : ev.at) === deepest;
      if (!hot) {
        return found
          ? `La bille ne peut plus descendre : altitude ${altitude(ev.at.height)}. Cette fois, c’est bien la cuvette la plus profonde.`
          : `La bille ne peut plus descendre : altitude ${altitude(ev.at.height)}. La cuvette la plus profonde, elle, descend à ${altitude(deepest.height)}.`;
      }
      return found
        ? `Le plateau s’est calmé. La bille a trouvé la cuvette la plus profonde, à l’altitude ${altitude(ev.best.height)}.`
        : `Le plateau s’est calmé. Meilleur point visité : altitude ${altitude(ev.best.height)}, alors que la cuvette la plus profonde descend à ${altitude(deepest.height)}.`;
    }
  }
}

/** How long a step of the marble stays on screen at normal speed, in milliseconds. */
export function dwellWalk(ev: WalkEvent): number {
  if (ev.kind !== 'step') return 700;
  // A shaken walk has many more steps than a plain descent, so it plays faster.
  if (ev.temperature > 0) return ev.accepted ? 55 : 30;
  return ev.accepted ? 110 : 45;
}

/** How long an event stays on screen at normal speed, in milliseconds. */
export function dwell(ev: TraceEvent): number {
  switch (ev.kind) {
    case 'nn-consider':
      return 800;
    case 'nn-extend':
      return 500;
    case '2opt-examine':
      return ev.gain > 1e-9 ? 600 : 90;
    case '2opt-apply':
      return 800;
    case 'sa-propose':
      if (!ev.accepted) return 25;
      return ev.record ? 450 : ev.delta > 0 ? 220 : 140;
    default:
      return 600;
  }
}
