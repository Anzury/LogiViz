import * as THREE from 'three/webgpu';
import { pass, uniform } from 'three/tsl';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { DEPOT, type Instance } from '../core/instance';
import type { Landscape, Spot } from '../core/landscape';
import { mulberry32, type Rng } from '../core/rng';
import type { Edge } from '../core/trace';
import {
  PALETTE,
  buildBoard,
  buildDepot,
  buildHouse,
  buildPickTarget,
  buildPin,
  buildTable,
  buildTree,
  buildParcels,
} from './parts';
import { buildMarble, buildRelief, surfaceY } from './relief';
import { ThreadLayer, type Segment } from './threads';
import { Timeline } from './timeline';
import { Truck } from './truck';

/** Instance units to world units: the 100-unit board becomes a 10-unit model. */
const WORLD_PER_UNIT = 0.1;
const BOARD_SIDE = 10;
const BOARD_RADIUS = 7.2;
const PIN_HEIGHT = 0.95;
const THREAD_Y = 0.86;
const TARGET_Y = 0.2;
/** The relief model sits on the same table, to the right of the town. */
const RELIEF_X = 16;
const MARBLE_RADIUS = 0.2;
/** How high a house is held when it is taken out of the plan. */
const LIFT = 1.3;
const TRAIL_LENGTH = 90;
const HALO = { pale: '#fffdf6', warm: '#ff9650' };
const SUN_OFFSET = new THREE.Vector3(5, 12, 3);

const { damp, clamp } = THREE.MathUtils;

export type ViewName = 'intro' | 'draw' | 'work' | 'relief' | 'time' | 'timeDraw';
export type StageName = 'town' | 'relief';

/**
 * Camera set-ups. `zoom` scales the fitted distance (the slowly turning intro
 * needs room for the board's diagonal) and `height` is how far above the table
 * the camera aims.
 */
const VIEWS: Record<ViewName, { azimuth: number; elevation: number; spin: number; zoom: number; height: number }> = {
  intro: { azimuth: 0.55, elevation: 0.62, spin: 0.045, zoom: 1.1, height: TARGET_Y },
  draw: { azimuth: 0, elevation: 1.2, spin: 0, zoom: 0.92, height: TARGET_Y },
  work: { azimuth: 0.25, elevation: 0.92, spin: 0, zoom: 1, height: TARGET_Y },
  // Lower and slowly turning: parallax is what makes the heights readable.
  relief: { azimuth: 0.6, elevation: 0.7, spin: 0.035, zoom: 1.08, height: 0.7 },
  // Lower still, aimed at mid-morning: the day rises five units above the board.
  time: { azimuth: 0.6, elevation: 0.34, spin: 0.03, zoom: 1.06, height: 2.5 },
  // Steadier and from higher up, so houses stay easy to click while the paths climb.
  timeDraw: { azimuth: 0.4, elevation: 0.72, spin: 0, zoom: 1.15, height: 1.9 },
};

export interface ThreadSpec {
  tour: number[];
  closed: boolean;
  color: string;
  /** Animate the newest stretch of thread being pulled taut. */
  growLast?: boolean;
}

export interface PickHandlers {
  pick(node: number): void;
  hover?(node: number | null): void;
}

/**
 * The tabletop model: a board, a paper town generated from an instance, pins
 * and threads. It knows nothing about algorithms; the chapter tells it which
 * threads to stretch and which pins to colour.
 */
export class Maquette {
  static async create(host: HTMLElement): Promise<Maquette> {
    const forceWebGL = new URLSearchParams(location.search).has('webgl');
    const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
    await renderer.init();
    return new Maquette(host, renderer);
  }

  readonly backend: 'WebGPU' | 'WebGL2';

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.5, 200);
  private readonly pipeline: THREE.RenderPipeline;
  private readonly focus = uniform(20);
  private readonly raycaster = new THREE.Raycaster();

  private readonly thread = new ThreadLayer(0.042, PALETTE.ink, { shadow: true });
  private readonly ghosts = new ThreadLayer(0.026, PALETTE.paper, { opacity: 0.9 });
  private readonly accent = new ThreadLayer(0.085, '#fffdf6', { halo: true });
  private readonly marked = new ThreadLayer(0.072, PALETTE.ink, { shadow: true });
  private readonly trucks: Truck[] = [];
  private readonly fleet: ThreadLayer[] = [];
  private parcels: THREE.Group | null = null;
  private parcelsFor: readonly number[] | null = null;
  private parcelSpots: THREE.Vector3[] = [];
  private parcelsShown = false;
  private parcelScale = 0;

  /** Each node's building and pin, so that a house can be picked up off the board. */
  private houses: THREE.Object3D[] = [];
  private pinGroups: THREE.Object3D[] = [];
  private lifted = new Set<number>();

  /** Time as the third dimension, used from the time-windows chapter on. */
  readonly timeline = new Timeline();
  private windowsFor: readonly { open: number; close: number }[] | null = null;
  private readonly tracks: ThreadLayer[] = [];
  private readonly labelLayer = document.createElement('div');
  private labels: { el: HTMLElement; node: number; time: number | null }[] = [];
  private hourLabels: { el: HTMLElement; at: THREE.Vector3 }[] = [];
  private readonly sun = new THREE.DirectionalLight('#fff0dc', 3);

  private readonly relief = new THREE.Group();
  private reliefModel: THREE.Group | null = null;
  private readonly marble = buildMarble(MARBLE_RADIUS, PALETTE.ink);
  private readonly marbleGoal = new THREE.Vector3();
  private readonly candidate = buildMarble(0.1, PALETTE.paper, 0.8);
  private readonly flag = buildPin(0.8, 0.09, '#d4a017');
  private readonly trail: THREE.Mesh[] = [];
  private shake = 0;
  private readonly calm = window.matchMedia('(prefers-reduced-motion: reduce)');
  private stage: StageName = 'town';
  private readonly aim = new THREE.Vector3(0, TARGET_Y, 0);

  private town: THREE.Group | null = null;
  private anchors: THREE.Vector3[] = [];
  private heads: THREE.Mesh[] = [];
  private headRadius: number[] = [];
  private pickTargets: THREE.Mesh[] = [];
  private pops: { object: THREE.Object3D; delay: number; base: number }[] = [];
  private popTime = 0;

  private view: ViewName = 'intro';
  private azimuth = VIEWS.intro.azimuth - 0.5;
  private elevation = VIEWS.intro.elevation;
  private distance = 0;
  private fit = 22;
  private spin = 0;
  private dragAzimuth = 0;
  private dragElevation = 0;
  private shift = 0;
  private lastTime = 0;

  private pointer: { x: number; y: number; travelled: number } | null = null;
  private handlers: PickHandlers | null = null;
  private hovered: number | null = null;
  private current: number | null = null;


  private constructor(
    private readonly host: HTMLElement,
    private readonly renderer: THREE.WebGPURenderer,
  ) {
    const backend = renderer.backend as { isWebGPUBackend?: boolean };
    this.backend = backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.NeutralToneMapping;
    host.appendChild(renderer.domElement);
    this.labelLayer.className = 'stage-labels';
    host.appendChild(this.labelLayer);
    this.scene.add(this.timeline.group);

    this.scene.background = new THREE.Color(PALETTE.table);
    this.scene.fog = new THREE.Fog(PALETTE.table, 36, 80);

    const sky = new THREE.HemisphereLight('#ffffff', '#cdbfa8', 1.15);
    const sun = this.sun;
    sun.position.copy(SUN_OFFSET);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 40 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 5;

    this.relief.position.x = RELIEF_X;
    this.flag.group.visible = false;
    this.relief.add(this.marble, this.candidate, this.flag.group);

    this.scene.add(
      sky,
      sun,
      sun.target,
      this.relief,
      buildTable(),
      buildBoard(BOARD_SIDE),
      this.thread.group,
      this.ghosts.group,
      this.accent.group,
      this.marked.group,
    );

    // Shallow depth of field is what makes a scene read as a miniature.
    const scenePass = pass(this.scene, this.camera);
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputNode = dof(scenePass.getTextureNode(), scenePass.getViewZNode(), this.focus, 9, 2);

    this.bindPointer(renderer.domElement);
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.distance = this.fit * 1.25;
    renderer.setAnimationLoop((time: number) => this.frame(time));
  }

  // ---------------------------------------------------------------- town

  setInstance(inst: Instance): void {
    this.town?.removeFromParent();
    for (const head of this.heads) (head.material as THREE.Material).dispose();

    const town = new THREE.Group();
    const rng = mulberry32(Math.imul(inst.seed, 2654435761) >>> 0);
    const half = inst.size / 2;
    this.anchors = inst.nodes.map(
      (p) => new THREE.Vector3((p.x - half) * WORLD_PER_UNIT, 0, (p.y - half) * WORLD_PER_UNIT),
    );
    this.heads = [];
    this.headRadius = [];
    this.pickTargets = [];
    this.parcelSpots = [];
    this.pinGroups = [];
    this.houses = [];
    this.lifted = new Set();
    this.pops = [];
    const buildings: THREE.Vector3[] = [];

    this.anchors.forEach((anchor, node) => {
      const isDepot = node === DEPOT;
      const radius = isDepot ? 0.1 : 0.07;
      const pin = buildPin(PIN_HEIGHT, radius, isDepot ? PALETTE.ink : PALETTE.pinIdle);
      pin.group.position.copy(anchor);
      town.add(pin.group);
      this.pinGroups.push(pin.group);
      this.heads.push(pin.head);
      this.headRadius.push(radius);

      const building = isDepot ? buildDepot() : buildHouse(rng);
      const offset = this.clearOffset(anchor, node, isDepot ? 0.74 : 0.47, buildings, rng);
      building.position.copy(anchor).add(offset);
      building.rotation.y = Math.atan2(-offset.x, -offset.z);
      buildings.push(building.position);
      // Parcels wait beside the pin, clear of both the house and the thread's path.
      const along = offset.lengthSq() > 0 ? offset.clone().normalize() : new THREE.Vector3(1, 0, 0);
      this.parcelSpots.push(anchor.clone().add(new THREE.Vector3(-along.z, 0, along.x).multiplyScalar(0.4)));
      town.add(building);
      this.houses.push(building);
      this.pops.push({ object: building, delay: 0.1 + rng() * 0.5, base: 1 });

      const target = buildPickTarget();
      target.position.x = anchor.x + offset.x * 0.5;
      target.position.z = anchor.z + offset.z * 0.5;
      target.userData.node = node;
      town.add(target);
      this.pickTargets.push(target);
    });

    const trees: THREE.Vector3[] = [];
    for (let tries = 0; trees.length < 22 && tries < 600; tries++) {
      const spot = new THREE.Vector3((rng() - 0.5) * 9.3, 0, (rng() - 0.5) * 9.3);
      const crowded =
        this.anchors.some((a) => a.distanceTo(spot) < 0.7) ||
        buildings.some((b) => b.distanceTo(spot) < 0.9) ||
        trees.some((t) => t.distanceTo(spot) < 0.45);
      if (crowded) continue;
      const tree = buildTree(rng);
      tree.position.copy(spot);
      trees.push(spot);
      town.add(tree);
      this.pops.push({ object: tree, delay: 0.3 + rng() * 0.6, base: tree.scale.x });
    }

    for (const pop of this.pops) pop.object.scale.setScalar(1e-4);
    this.popTime = 0;
    this.town = town;
    this.scene.add(town);

    this.setThread(null);
    this.setGhosts([]);
    this.setAccent([]);
    this.setMarked([]);
    this.setFleet([]);
    this.setTracks([]);
    this.setLabels([]);
    this.setWindows(null);
    this.timeline.setRaised(false);
    this.parcels?.removeFromParent();
    this.parcels = null;
    this.parcelsFor = null;
    this.current = null;
    this.hovered = null;
    this.setTruck(null);
  }

  /** Where to put a building next to its pin: the first direction with room around it. */
  private clearOffset(
    anchor: THREE.Vector3,
    node: number,
    reach: number,
    buildings: THREE.Vector3[],
    rng: Rng,
  ): THREE.Vector3 {
    let best = new THREE.Vector3();
    let bestClearance = -Infinity;
    const start = rng() * Math.PI * 2;
    const limit = BOARD_SIDE / 2 - 0.45;
    for (let k = 0; k < 8; k++) {
      const angle = start + (k * Math.PI) / 4;
      const offset = new THREE.Vector3(Math.cos(angle) * reach, 0, Math.sin(angle) * reach);
      const spot = offset.clone().add(anchor);
      if (Math.abs(spot.x) > limit || Math.abs(spot.z) > limit) continue;
      let clearance = Infinity;
      this.anchors.forEach((other, i) => {
        if (i !== node) clearance = Math.min(clearance, other.distanceTo(spot));
      });
      for (const other of buildings) clearance = Math.min(clearance, other.distanceTo(spot) - 0.25);
      if (clearance > 0.95) return offset;
      if (clearance > bestClearance) {
        bestClearance = clearance;
        best = offset;
      }
    }
    return best;
  }

  // ------------------------------------------------------------- threads

  private segments(edges: readonly Edge[]): Segment[] {
    return edges.map(([a, b]) => [this.anchors[a].clone().setY(THREAD_Y), this.anchors[b].clone().setY(THREAD_Y)]);
  }

  /** The tour itself. */
  setThread(spec: ThreadSpec | null): void {
    if (!spec) {
      this.thread.set([]);
      return;
    }
    const edges: Edge[] = [];
    for (let i = 0; i + 1 < spec.tour.length; i++) edges.push([spec.tour[i], spec.tour[i + 1]]);
    if (spec.closed && spec.tour.length > 1) edges.push([spec.tour[spec.tour.length - 1], spec.tour[0]]);
    this.thread.setColor(spec.color);
    this.thread.set(this.segments(edges), spec.growLast);
  }

  /** Thin pale threads: options the algorithm is measuring. */
  setGhosts(edges: readonly Edge[]): void {
    this.ghosts.set(this.segments(edges));
  }

  /** A bright halo: the option that was picked, or a thread that was just tied. */
  setAccent(edges: readonly Edge[], warm = false): void {
    this.accent.setColor(warm ? HALO.warm : HALO.pale);
    this.accent.set(this.segments(edges));
  }

  /** Thick dark sleeves over existing threads: the ones under examination. */
  setMarked(edges: readonly Edge[]): void {
    this.marked.set(this.segments(edges));
  }

  /** Colours the pins of visited houses and enlarges the current one. */
  setPins(visited: Iterable<number>, color: string, current: number | null = null): void {
    const done = new Set(visited);
    this.paintPins(this.heads.map((_, node) => (done.has(node) ? color : null)), current);
  }

  /** Gives each house's pin its own colour (null: not delivered yet) and enlarges the current one. */
  paintPins(colors: readonly (string | null)[], current: number | null = null): void {
    this.heads.forEach((head, node) => {
      if (node === DEPOT) return;
      (head.material as THREE.MeshStandardMaterial).color.set(colors[node] ?? PALETTE.pinIdle);
    });
    this.current = current;
  }

  // --------------------------------------------------------------- fleet

  /** Several tours at once, one colour per truck; an open route has not driven back yet. */
  setFleet(routes: readonly { nodes: number[]; color: string; closed: boolean }[]): void {
    while (this.fleet.length < routes.length) {
      const layer = new ThreadLayer(0.042, PALETTE.ink, { shadow: true });
      this.fleet.push(layer);
      this.scene.add(layer.group);
    }
    this.fleet.forEach((layer, i) => {
      const route = routes[i];
      if (!route || route.nodes.length === 0) {
        layer.set([]);
        return;
      }
      const stops = [DEPOT, ...route.nodes, ...(route.closed ? [DEPOT] : [])];
      layer.setColor(route.color);
      layer.set(this.segments(stops.slice(1).map((to, k): Edge => [stops[k], to])));
    });
  }

  /** Piles of parcels beside the houses, one box per parcel ordered; null puts them away. */
  setParcels(demand: readonly number[] | null): void {
    this.parcelsShown = demand !== null;
    if (!demand || demand === this.parcelsFor) return;
    this.parcels?.removeFromParent();
    const rng = mulberry32(demand.length * 977 + 13);
    const piles = new THREE.Group();
    demand.forEach((count, node) => {
      if (count === 0) return;
      const pile = buildParcels(count, rng);
      pile.position.copy(this.parcelSpots[node]);
      pile.rotation.y = rng() * Math.PI;
      piles.add(pile);
    });
    this.parcels = piles;
    this.parcelsFor = demand;
    this.parcelScale = 0;
    this.scene.add(piles);
  }

  /** Houses held above the board with their pins: taken out of the plan, waiting to be put back. */
  setLifted(nodes: Iterable<number>): void {
    this.lifted = new Set(nodes);
  }

  // ---------------------------------------------------------------- time

  /**
   * Stands a time axis over the town: a graduated mast per house carrying its
   * time window (`windows[0]` is the depot's day). Null takes it down. It lies
   * flat until `timeline.setRaised(true)`.
   */
  setWindows(windows: readonly { open: number; close: number }[] | null): void {
    if (windows === this.windowsFor) return;
    this.windowsFor = windows;
    for (const mark of this.hourLabels) mark.el.remove();
    this.hourLabels = [];
    if (!windows) {
      this.timeline.clear();
      return;
    }
    this.timeline.build(this.anchors, [...windows]);
    this.hourLabels = this.timeline.hourMarks().map(({ at, hour }) => {
      const el = document.createElement('span');
      el.className = 'stage-label is-hour';
      el.textContent = `${hour} h`;
      this.labelLayer.append(el);
      return { el, at };
    });
  }

  /** Routes drawn flat on the board, thin and shadowless: the map view of the paths climbing above. */
  setTracks(routes: readonly { nodes: number[]; color: string; closed: boolean }[]): void {
    while (this.tracks.length < routes.length) {
      const layer = new ThreadLayer(0.03, PALETTE.ink, { opacity: 0.7 });
      this.tracks.push(layer);
      this.scene.add(layer.group);
    }
    this.tracks.forEach((layer, i) => {
      const route = routes[i];
      if (!route || route.nodes.length === 0) {
        layer.set([]);
        return;
      }
      const stops = [DEPOT, ...route.nodes, ...(route.closed ? [DEPOT] : [])];
      layer.setColor(route.color);
      layer.set(
        stops.slice(1).map((to, k): Segment => [this.anchors[stops[k]].clone().setY(0.04), this.anchors[to].clone().setY(0.04)]),
      );
    });
  }

  /** Small text labels floating above houses; `time` pins one to a moment on the house's mast. */
  setLabels(labels: readonly { node: number; time: number | null; text: string }[]): void {
    while (this.labels.length < labels.length) {
      const el = document.createElement('span');
      el.className = 'stage-label';
      this.labelLayer.append(el);
      this.labels.push({ el, node: 0, time: null });
    }
    this.labels.forEach((label, i) => {
      const spec = labels[i];
      label.el.hidden = spec === undefined;
      if (!spec) return;
      label.node = spec.node;
      label.time = spec.time;
      label.el.textContent = spec.text;
    });
  }

  // --------------------------------------------------------------- truck

  /** Sends one truck round a closed tour, or parks it at the depot when given null. */
  setTruck(tour: number[] | null): void {
    this.setTrucks(tour && tour.length > 1 ? [{ tour, color: PALETTE.truck }] : []);
  }

  /** One truck per tour, in that tour's colour. With no tour, a single truck waits at the depot. */
  setTrucks(routes: readonly { tour: number[]; color: string }[]): void {
    if (this.anchors.length === 0) return;
    const home = this.anchors[DEPOT];
    const wanted = Math.max(routes.length, 1);
    while (this.trucks.length < wanted) {
      const truck = new Truck();
      this.trucks.push(truck);
      this.scene.add(truck.group);
    }
    this.trucks.forEach((truck, i) => {
      truck.group.visible = i < wanted;
      if (i < routes.length) {
        // Staggered departures, so the trucks do not leave the depot in a pack.
        truck.assign(routes[i].tour.map((node) => this.anchors[node]), home, routes[i].color, 0.4 + i * 0.6);
      } else if (i === 0) {
        truck.assign(null, home, PALETTE.truck);
      }
    });
  }

  // -------------------------------------------------------------- relief

  /** Builds the contour model of a landscape; `color` is the marble's. */
  setRelief(land: Landscape, color: string): void {
    this.reliefModel?.removeFromParent();
    this.reliefModel = buildRelief(land.height, BOARD_SIDE);
    this.relief.add(this.reliefModel);
    (this.marble.material as THREE.MeshStandardMaterial).color.set(color);
    for (const dot of this.trail) dot.removeFromParent();
    this.trail.length = 0;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const dot = buildMarble(0.05, color);
      dot.castShadow = false;
      this.trail.push(dot);
      this.relief.add(dot);
    }
  }

  /** Position on the relief, in the relief's own frame, `lift` above the cardboard. */
  private onRelief(spot: Spot, lift: number): THREE.Vector3 {
    return new THREE.Vector3((spot.x - 0.5) * BOARD_SIDE, surfaceY(spot.height) + lift, (spot.y - 0.5) * BOARD_SIDE);
  }

  /** Where the marble is; it glides there rather than jumping. */
  setMarble(spot: Spot | null): void {
    if (!spot) {
      this.marble.visible = false;
      return;
    }
    this.marbleGoal.copy(this.onRelief(spot, MARBLE_RADIUS));
    if (!this.marble.visible) this.marble.position.copy(this.marbleGoal);
    this.marble.visible = true;
  }

  /** A pale ghost marble: the step being considered. */
  setCandidate(spot: Spot | null): void {
    this.candidate.visible = spot !== null;
    if (spot) this.candidate.position.copy(this.onRelief(spot, 0.1));
  }

  /** Dots left where the marble has been, most recent last; older ones shrink. */
  setTrail(spots: readonly Spot[]): void {
    const recent = spots.slice(-TRAIL_LENGTH);
    this.trail.forEach((dot, i) => {
      dot.visible = i < recent.length;
      if (!dot.visible) return;
      dot.position.copy(this.onRelief(recent[i], 0.03));
      dot.scale.setScalar(0.03 + 0.04 * ((i + 1) / recent.length));
    });
  }

  /** A gold pin on the lowest spot found so far. */
  setFlag(spot: Spot | null): void {
    this.flag.group.visible = spot !== null;
    if (spot) this.flag.group.position.copy(this.onRelief(spot, 0));
  }

  /** How hard the relief's board trembles, 0 to 1: temperature made visible. */
  setShake(amount: number): void {
    this.shake = Math.min(Math.max(amount, 0), 1);
  }

  // -------------------------------------------------------------- camera

  /** Which model the camera looks at; it travels along the table to get there. */
  setStage(stage: StageName): void {
    this.stage = stage;
  }

  setView(view: ViewName): void {
    if (view === this.view) return;
    this.view = view;
    this.dragAzimuth = 0;
    this.dragElevation = 0;
    // Still views square the board up with the screen: settle on the nearest
    // quarter turn rather than wherever the intro's rotation happened to be.
    if (VIEWS[view].spin === 0) this.spin = Math.round(this.spin / (Math.PI / 2)) * (Math.PI / 2);
  }

  /** Shifts the model right by `px` pixels to leave room for the text column. */
  setShift(px: number): void {
    this.shift = px;
    this.resize();
  }

  private resize(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    if (this.shift) this.camera.setViewOffset(width, height, -this.shift, 0, width, height);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();

    // Back the camera off until the board fits in the area left free by the text.
    const verticalHalf = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const free = Math.max(width - 2 * this.shift, width * 0.35);
    const horizontalHalf = Math.atan((Math.tan(verticalHalf) * free) / height);
    this.fit = BOARD_RADIUS / Math.sin(Math.min(verticalHalf, horizontalHalf));
  }

  // ------------------------------------------------------------- picking

  /** Lets the reader click houses; pass null to turn picking off. */
  setPicking(handlers: PickHandlers | null): void {
    this.handlers = handlers;
    if (!handlers) this.setHovered(null);
  }

  private bindPointer(canvas: HTMLCanvasElement): void {
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', (e) => {
      this.pointer = { x: e.clientX, y: e.clientY, travelled: 0 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.pointer) {
        this.setHovered(this.handlers ? this.nodeAt(e) : null);
        return;
      }
      const dx = e.clientX - this.pointer.x;
      const dy = e.clientY - this.pointer.y;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.travelled += Math.abs(dx) + Math.abs(dy);
      if (this.pointer.travelled > 6) {
        this.dragAzimuth -= dx * 0.006;
        this.dragElevation = clamp(this.dragElevation + dy * 0.005, -0.7, 0.7);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      const wasClick = this.pointer !== null && this.pointer.travelled <= 6;
      this.pointer = null;
      if (wasClick && this.handlers) {
        const node = this.nodeAt(e);
        if (node !== null) this.handlers.pick(node);
      }
    });
    canvas.addEventListener('pointercancel', () => (this.pointer = null));
    canvas.addEventListener('pointerleave', () => this.setHovered(null));
  }

  private nodeAt(e: PointerEvent): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickTargets, false)[0];
    return hit ? (hit.object.userData.node as number) : null;
  }

  private setHovered(node: number | null): void {
    if (node === this.hovered) return;
    this.hovered = node;
    this.renderer.domElement.style.cursor = node === null ? '' : 'pointer';
    this.handlers?.hover?.(node);
  }

  // --------------------------------------------------------------- frame

  private frame(time: number): void {
    const dt = Math.min((time - this.lastTime) / 1000, 0.25);
    this.lastTime = time;

    const view = VIEWS[this.view];
    this.spin += view.spin * dt;
    const elevation = clamp(view.elevation + this.dragElevation, 0.3, 1.45);
    this.azimuth = damp(this.azimuth, view.azimuth + this.spin + this.dragAzimuth, 3.5, dt);
    this.elevation = damp(this.elevation, elevation, 3.5, dt);
    this.distance = damp(this.distance, this.fit * view.zoom, 3, dt);
    const flat = Math.cos(this.elevation) * this.distance;
    const onRelief = this.stage === 'relief';
    this.aim.x = damp(this.aim.x, onRelief ? RELIEF_X : 0, 2.4, dt);
    this.aim.y = damp(this.aim.y, view.height, 2.4, dt);
    this.camera.position.set(
      this.aim.x + Math.sin(this.azimuth) * flat,
      this.aim.y + Math.sin(this.elevation) * this.distance,
      Math.cos(this.azimuth) * flat,
    );
    this.camera.lookAt(this.aim);
    // The light travels with the camera so the shadow map always covers what is in view.
    this.sun.position.set(this.aim.x, 0, 0).add(SUN_OFFSET);
    this.sun.target.position.set(this.aim.x, 0, 0);
    this.sun.target.updateMatrixWorld();

    this.marble.position.lerp(this.marbleGoal, 1 - Math.exp(-20 * dt));
    const tremble = this.calm.matches ? 0 : this.shake * 0.04;
    this.relief.position.set(RELIEF_X + (Math.random() - 0.5) * tremble, 0, (Math.random() - 0.5) * tremble);
    // Out of the way while the camera is on the town: low, wide views would catch a corner of it.
    this.relief.visible = this.aim.x > 1;
    this.camera.updateMatrixWorld();
    this.focus.value = this.distance;

    if (this.pops.length > 0 && this.popTime < 2) {
      this.popTime += dt;
      for (const pop of this.pops) {
        const t = clamp((this.popTime - pop.delay) / 0.45, 0, 1);
        const overshoot = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
        pop.object.scale.setScalar(Math.max(overshoot * pop.base, 1e-4));
      }
    }

    this.heads.forEach((head, node) => {
      const emphasis = node === this.current ? 1.6 : node === this.hovered ? 1.4 : 1;
      head.scale.setScalar(damp(head.scale.x, this.headRadius[node] * emphasis, 14, dt));
    });

    this.thread.update(dt);
    for (const truck of this.trucks) truck.update(dt);
    if (this.parcels) {
      this.parcelScale = damp(this.parcelScale, this.parcelsShown ? 1 : 0, 9, dt);
      this.parcels.visible = this.parcelScale > 0.01;
      for (const pile of this.parcels.children) pile.scale.setScalar(Math.max(this.parcelScale, 1e-4));
    }
    this.houses.forEach((house, node) => {
      const up = this.lifted.has(node) ? LIFT : 0;
      house.position.y = damp(house.position.y, up, 7, dt);
      house.rotation.z = damp(house.rotation.z, up > 0 ? 0.14 : 0, 7, dt);
      this.pinGroups[node].position.y = house.position.y;
    });
    this.timeline.update(dt);
    this.placeLabels();
    this.pipeline.render();
  }

  /** Moves the HTML labels to where their 3D anchors currently appear on screen. */
  private placeLabels(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const level = this.timeline.level;
    const put = (el: HTMLElement, world: THREE.Vector3, shown: boolean) => {
      const p = world.project(this.camera);
      const visible = shown && p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      el.style.visibility = visible ? 'visible' : 'hidden';
      if (visible) {
        el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -100%)`;
      }
    };
    for (const label of this.labels) {
      const anchor = this.anchors[label.node];
      if (label.el.hidden || !anchor) continue;
      // Above the pin when everything is flat; at its moment on the mast once time is raised.
      const y = label.time === null ? 1.4 : Math.max(1.4, this.timeline.heightOf(label.time) * level + 0.22);
      put(label.el, new THREE.Vector3(anchor.x, y, anchor.z), true);
    }
    for (const mark of this.hourLabels) {
      put(mark.el, new THREE.Vector3(mark.at.x, mark.at.y * level + 0.08, mark.at.z), level > 0.6);
    }
  }
}
