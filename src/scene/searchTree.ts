import * as THREE from 'three/webgpu';
import { PALETTE } from './parts';
import { ThreadLayer, type Segment } from './threads';

/** One family of tours in the search: how they all begin (depot first), and whether it was abandoned. */
export interface Branch {
  path: number[];
  cut: boolean;
}

/** Height of the root, just above the pin heads. */
const BASE = 1.1;
/** World height between two levels of the tree. */
const LEVEL = 1.5;
/** An abandoned branch is drawn only this far towards where it would have gone. */
const STUB = 0.45;
const { damp } = THREE.MathUtils;

const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 12);
const MAST = new THREE.MeshStandardMaterial({ color: '#9a938a', roughness: 0.6 });
const RING = new THREE.MeshStandardMaterial({ color: PALETTE.slate, roughness: 0.8 });
const POST = new THREE.MeshStandardMaterial({ color: PALETTE.kraftDark, roughness: 0.9 });

function tube(material: THREE.Material, radius: number, from: number, to: number, x: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(CYLINDER, material);
  mesh.scale.set(radius, Math.max(to - from, 1e-3), radius);
  mesh.position.set(x, (from + to) / 2, z);
  return mesh;
}

/**
 * The search tree of a branch and bound, grown above the town. Each level is
 * one more house fixed at the start of the tour: a family "depot, then a, then
 * b" is a branch from above a on the first level to above b on the second.
 * Abandoned families are stubs; the rest reach their house.
 */
export class SearchTree {
  readonly group = new THREE.Group();
  private fixtures: THREE.Group | null = null;
  private anchors: THREE.Vector3[] = [];
  private depth = 0;
  private readonly open = new ThreadLayer(0.028, PALETTE.ink);
  private readonly cut = new ThreadLayer(0.014, PALETTE.metal);
  private readonly best = new ThreadLayer(0.055, PALETTE.ink);
  private readonly focus = new ThreadLayer(0.085, '#fffdf6', { halo: true });
  private raised = false;
  /** 0 when lying flat, 1 when fully grown. */
  level = 0;

  constructor() {
    this.group.add(this.cut.group, this.open.group, this.best.group, this.focus.group);
    this.group.visible = false;
  }

  /** Colours of the families still open, and of the one leading to the best tour. */
  setColors(open: string, best: string): void {
    this.open.setColor(open);
    this.best.setColor(best);
  }

  heightOf(depth: number): number {
    return BASE + depth * LEVEL;
  }

  /** A mast above every house with a ring at each level, and a ruler naming the levels. */
  build(anchors: THREE.Vector3[], depth: number): void {
    this.clear();
    this.anchors = anchors;
    this.depth = depth;
    const top = this.heightOf(depth) + 0.15;
    const fixtures = new THREE.Group();
    const corner = this.ruler();
    for (const anchor of [...anchors, corner]) {
      const isRuler = anchor === corner;
      fixtures.add(tube(isRuler ? POST : MAST, isRuler ? 0.035 : 0.012, isRuler ? 0 : 0.95, top, anchor.x, anchor.z));
      for (let level = 0; level <= depth; level++) {
        const at = this.heightOf(level);
        fixtures.add(tube(RING, isRuler ? 0.1 : 0.04, at - 0.01, at + 0.01, anchor.x, anchor.z));
      }
    }
    this.fixtures = fixtures;
    this.group.add(fixtures);
  }

  clear(): void {
    this.fixtures?.removeFromParent();
    this.fixtures = null;
    this.anchors = [];
    this.show([], null, null);
  }

  get built(): boolean {
    return this.fixtures !== null;
  }

  private ruler(): THREE.Vector3 {
    return new THREE.Vector3(-5.2, 0, 5.2);
  }

  /** Where each level sits on the corner ruler, for the labels (heights as when fully grown). */
  levelMarks(): { at: THREE.Vector3; depth: number }[] {
    if (!this.fixtures) return [];
    return Array.from({ length: this.depth + 1 }, (_, depth) => ({ at: this.ruler().setY(this.heightOf(depth)), depth }));
  }

  /** The stretch of tree that fixes the last house of `path`, cut short for an abandoned family. */
  private segment(path: number[], fraction = 1): Segment {
    const depth = path.length - 1;
    const from = this.anchors[path[depth - 1]].clone().setY(this.heightOf(depth - 1));
    const to = this.anchors[path[depth]].clone().setY(this.heightOf(depth));
    return [from, fraction === 1 ? to : from.clone().lerp(to, fraction)];
  }

  /** Every stretch from the root to the family that begins with `path`, as far as the tree is drawn. */
  private trail(path: number[] | null): Segment[] {
    if (!path || this.anchors.length === 0) return [];
    const segments: Segment[] = [];
    for (let depth = 1; depth <= Math.min(path.length - 1, this.depth); depth++) segments.push(this.segment(path.slice(0, depth + 1)));
    return segments;
  }

  /**
   * Draws the families examined so far. `best` is the best tour known, whose
   * way through the tree is highlighted, and `focus` the family being examined.
   */
  show(branches: readonly Branch[], best: number[] | null, focus: number[] | null): void {
    const drawn = branches.filter((branch) => branch.path.length - 1 <= this.depth && branch.path.length > 1);
    this.open.set(drawn.filter((branch) => !branch.cut).map((branch) => this.segment(branch.path)));
    this.cut.set(drawn.filter((branch) => branch.cut).map((branch) => this.segment(branch.path, STUB)));
    this.best.set(this.trail(best));
    this.focus.set(this.trail(focus));
  }

  setRaised(raised: boolean): void {
    this.raised = raised;
  }

  update(dt: number): void {
    this.level = damp(this.level, this.raised && this.built ? 1 : 0, 3.2, dt);
    this.group.visible = this.level > 0.01;
    this.group.scale.y = Math.max(this.level, 1e-3);
  }
}
