import type { Maquette, StageName } from '../scene/maquette';
import type { City } from '../story/city';

/** What a chapter needs from the page it lives in. */
export interface Host {
  scene: Maquette;
  hud(label: string, value: string): void;
  /** Makes a step the active one; `force` re-enters it even if it already is. */
  enter(step: string, force?: boolean): void;
  active(): string;
}

/** A chapter: the scene state behind each step of its page. */
export interface ChapterModule {
  /** Scene state for each of the chapter's steps, keyed by the step's id in the page. */
  readonly steps: Record<string, () => void>;
  /** Called whenever a step is left: stop playback and timers. */
  leave(): void;
  /** A town was drawn: the page's first, or a new one asked for by the reader. */
  setCity(city: City): void;
  /** Which model a step happens on; the town unless the chapter says otherwise. */
  stageOf?(step: string): StageName;
}
