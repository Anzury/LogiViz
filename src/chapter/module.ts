import type { Stop } from '../core/timeWindows';
import type { Maquette, StageName } from '../scene/maquette';
import type { SearchTree } from '../scene/searchTree';
import type { Timeline } from '../scene/timeline';
import type { City } from '../story/city';

/** What the page itself asks of a scene, whatever draws it. */
export type PageStage = Pick<Maquette, 'setInstance' | 'setStage' | 'setShift' | 'setPicking' | 'setGhosts' | 'setAccent' | 'setMarked'>;

/**
 * What the single-truck chapters ask of a scene. Small enough for a second
 * way of drawing the town to answer it: see src/pixel/stage.ts.
 */
export type TourStage = PageStage & Pick<Maquette, 'setThread' | 'setPins' | 'setTruck' | 'setView'>;

/** What the fleet chapter asks of a scene: parcels at the houses, one round and one truck per colour. */
export type FleetStage = TourStage & Pick<Maquette, 'setFleet' | 'setParcels' | 'setTrucks' | 'paintPins'>;

/** What the streets chapter asks of a scene: a road map, lines along the streets, a truck that follows them. */
export type WorldStage = TourStage &
  Pick<Maquette, 'setRoadMap' | 'setGroundLines' | 'driveAlong' | 'parkTruck' | 'setParcels' | 'paintPins'>;

/** Rounds with their timetable worked out: all a scene needs to show them its own way. */
export interface TimedPicture {
  routes: { color: string; closed: boolean; stops: Stop[]; back: number }[];
  /** The house being dealt with right now, if any. */
  current: number | null;
}

/**
 * What the time-window chapter asks of a scene. The 3D model is given paths
 * through its time axis; a scene with another way of showing a timetable
 * takes it whole through `setTimedPlan`.
 */
export type TimedStage = TourStage &
  Pick<Maquette, 'setWindows' | 'setTracks' | 'setFleet' | 'paintPins' | 'setLabels'> & {
    timeline: Pick<Timeline, 'setRaised' | 'setPaths' | 'setWaits' | 'setLate' | 'setBeads'>;
    setTimedPlan?(picture: TimedPicture): void;
  };

/** What the large-neighbourhood chapter adds: houses lifted out of the plan, and a truck per round. */
export type RebuildStage = TimedStage & Pick<Maquette, 'setLifted' | 'setTrucks'>;

/** What the proof chapter asks of a scene: the bound's network, and a search tree it can show its own way. */
export type ProveStage = TourStage &
  Pick<Maquette, 'paintPins' | 'setNetwork' | 'setSearchTree'> & {
    tree: Pick<SearchTree, 'show' | 'setColors' | 'setRaised'>;
  };

/** What the annealing chapter adds: a landscape, a marble rolling on it, its trail, a flag, and heat. */
export type EscapeStage = TourStage & Pick<Maquette, 'setRelief' | 'setMarble' | 'setCandidate' | 'setTrail' | 'setFlag' | 'setShake'>;

/** What a chapter needs from the page it lives in. */
export interface Host<S extends PageStage = Maquette> {
  scene: S;
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
