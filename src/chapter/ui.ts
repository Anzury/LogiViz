import { km, percent, typo } from './format';

/** Series colours. Red is always the reader, blue the algorithm, gold the optimum. */
export const COLOR = { user: '#d6453d', algo: '#2c6fb3', best: '#d4a017', muted: '#8f867b', ink: '#2b2622' };

/**
 * Truck colours, in the order trucks receive them. Every pair was checked for
 * colour-blind separation; from the fifth truck on, the fallback is grey, and
 * the list beside the model always names each truck as well.
 */
const TRUCK_COLORS = ['#2a78d6', '#e34948', '#eda100', '#1baf7a'];
export const truckColor = (index: number) => TRUCK_COLORS[index] ?? COLOR.muted;

/** True in the stacked layout, where the model sits above the text instead of beside it. */
export const MOBILE = window.matchMedia('(max-width: 860px)');

export const all = <T extends HTMLElement>(selector: string) => Array.from(document.querySelectorAll<T>(selector));
export const one = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

/** Writes a computed sentence or figure into every element that asks for it by name. */
export function bind(name: string, text: string): void {
  for (const el of all(`[data-bind="${name}"]`)) el.textContent = typo(text);
}

export interface TruckRow {
  name: string;
  color: string;
  cost: number;
  /** Parcels on board against capacity, drawn as a gauge. */
  load?: { parcels: number; capacity: number };
  /** Free text instead of a gauge, such as the time the truck is back. */
  detail?: string;
}

/** The fleet as a list: each truck's colour key and name, its load or a detail, and its distance. */
export function drawFleet(root: HTMLElement, rows: TruckRow[], note = ''): void {
  const items = rows.map((row) => {
    const item = document.createElement('div');
    item.className = 'truck';
    const key = document.createElement('span');
    key.className = 'truck-key';
    key.style.background = row.color;
    const name = document.createElement('span');
    name.className = 'truck-name';
    name.textContent = row.name;
    const distance = document.createElement('span');
    distance.className = 'truck-km';
    distance.textContent = km(row.cost);
    item.append(key, name);
    if (row.load) {
      const { parcels, capacity } = row.load;
      item.title = `${row.name} : ${parcels} colis sur ${capacity}, ${km(row.cost)}`;
      const meter = document.createElement('span');
      meter.className = 'truck-meter';
      const fill = document.createElement('span');
      fill.style.width = `${(parcels / capacity) * 100}%`;
      fill.style.background = row.color;
      meter.append(fill);
      const load = document.createElement('span');
      load.className = 'truck-load';
      load.textContent = `${parcels}/${capacity} colis`;
      item.append(meter, load);
    } else {
      item.classList.add('has-detail');
      item.title = `${row.name} : ${row.detail ?? ''}, ${km(row.cost)}`;
      const detail = document.createElement('span');
      detail.className = 'truck-load';
      detail.textContent = row.detail ?? '';
      item.append(detail);
    }
    item.append(distance);
    return item;
  });
  if (note) {
    const extra = document.createElement('p');
    extra.className = 'truck-note';
    extra.textContent = typo(note);
    items.push(extra);
  }
  root.replaceChildren(...items);
}

export interface Row {
  label: string;
  cost: number | null;
  color: string;
  /** Lighter bar for a starting point, full colour for its improved version. */
  soft?: boolean;
}

/** Tour lengths as labelled bars; `reference` adds each row's gap to the optimum. */
export function drawScoreboard(root: HTMLElement, rows: Row[], reference: number | null): void {
  const longest = Math.max(...rows.map((row) => row.cost ?? 0));
  root.replaceChildren(
    ...rows.map((row) => {
      const item = document.createElement('div');
      item.className = 'score';
      const label = document.createElement('span');
      label.className = 'score-label';
      label.textContent = row.label;
      const track = document.createElement('div');
      track.className = 'score-track';
      const value = document.createElement('span');
      value.className = 'score-value';
      if (row.cost === null) {
        value.textContent = 'pas encore tracée';
        value.classList.add('is-empty');
        track.append(value);
      } else {
        const bar = document.createElement('div');
        bar.className = 'score-bar';
        // Leaves room for the value and the gap beside the longest bar, even on a phone.
        bar.style.width = `${(row.cost / longest) * 60}%`;
        bar.style.background = row.color;
        if (row.soft) bar.style.opacity = '0.5';
        value.textContent = km(row.cost);
        track.append(bar, value);
        if (reference !== null) {
          const gap = document.createElement('span');
          gap.className = 'score-gap';
          const ratio = row.cost / reference - 1;
          gap.textContent = ratio < 0.0005 ? 'optimum' : `+${percent(ratio)}`;
          track.append(gap);
          item.title = `${row.label} : ${km(row.cost)}, ${ratio < 0.0005 ? 'c’est l’optimum' : `${percent(ratio)} au-dessus de l’optimum`}`;
        } else {
          item.title = `${row.label} : ${km(row.cost)}`;
        }
      }
      item.append(label, track);
      return item;
    }),
  );
}
