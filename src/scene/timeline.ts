import * as THREE from 'three/webgpu';
import { PALETTE } from './parts';
import { buildMarble } from './relief';
import { ThreadLayer, type Segment } from './threads';

/** A place and a moment: a node of the town at a time of day, in minutes. */
export interface Moment {
  node: number;
  time: number;
}
export type Span = [Moment, Moment];

/** Height of the start of the day, just above the pin heads. */
const BASE = 1.1;
/** World height of the whole day. */
const RISE = 5;
const SLEEVE_RADIUS = 0.11;
const BEADS = 48;
const { damp } = THREE.MathUtils;

const CYLINDER = new THREE.CylinderGeometry(1, 1, 1, 12);
const MAST = new THREE.MeshStandardMaterial({ color: '#9a938a', roughness: 0.6 });
const TICK = new THREE.MeshStandardMaterial({ color: PALETTE.slate, roughness: 0.8 });
const POST = new THREE.MeshStandardMaterial({ color: PALETTE.kraftDark, roughness: 0.9 });
// The window sleeve is a see-through cardboard tube, so the thread passing inside it stays visible.
const SLEEVE = new THREE.MeshStandardMaterial({
  color: PALETTE.kraft,
  roughness: 1,
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
});

function tube(material: THREE.Material, radius: number, from: number, to: number, x: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(CYLINDER, material);
  mesh.scale.set(radius, Math.max(to - from, 1e-3), radius);
  mesh.position.set(x, (from + to) / 2, z);
  return mesh;
}

/**
 * Time as the third dimension. Above every house stands a graduated mast; the
 * pale sleeve on it is the house's time window, and a route becomes a path that
 * climbs as the day goes by. The whole thing can lie flat (invisible from
 * above) and be raised.
 */
export class Timeline {
  readonly group = new THREE.Group();
  private fixtures: THREE.Group | null = null;
  private anchors: THREE.Vector3[] = [];
  private start = 0;
  private end = 1;
  private readonly paths: ThreadLayer[] = [];
  private readonly waits = new ThreadLayer(0.02, '#fffdf6');
  private readonly late = new ThreadLayer(0.06, PALETTE.ink);
  private readonly beads: THREE.Mesh[] = [];
  private raised = false;
  /** 0 when lying flat, 1 when fully raised. */
  level = 0;

  constructor() {
    this.group.add(this.waits.group, this.late.group);
    this.group.visible = false;
  }

  /** Height of a time of day when the timeline is fully raised. */
  heightOf(time: number): number {
    return BASE + ((time - this.start) / (this.end - this.start)) * RISE;
  }

  /** Masts, hour ticks and window sleeves for a town; `windows[0]` is the depot's day. */
  build(anchors: THREE.Vector3[], windows: { open: number; close: number }[]): void {
    this.clear();
    this.anchors = anchors;
    this.start = windows[0].open;
    this.end = windows[0].close;
    const top = this.heightOf(this.end) + 0.2;
    const fixtures = new THREE.Group();
    const hours: number[] = [];
    for (let hour = Math.ceil(this.start / 60) * 60; hour <= this.end; hour += 60) hours.push(hour);

    anchors.forEach((anchor, node) => {
      fixtures.add(tube(MAST, 0.012, 0.95, top, anchor.x, anchor.z));
      for (const hour of hours) {
        const at = this.heightOf(hour);
        fixtures.add(tube(TICK, 0.04, at - 0.008, at + 0.008, anchor.x, anchor.z));
      }
      if (node > 0) {
        const { open, close } = windows[node];
        fixtures.add(tube(SLEEVE, SLEEVE_RADIUS, this.heightOf(open), this.heightOf(close), anchor.x, anchor.z));
      }
    });

    // A ruler at the corner of the board carries the hour labels.
    const corner = this.ruler();
    fixtures.add(tube(POST, 0.035, 0, top, corner.x, corner.z));
    for (const hour of hours) {
      const at = this.heightOf(hour);
      fixtures.add(tube(TICK, 0.1, at - 0.012, at + 0.012, corner.x, corner.z));
    }

    this.fixtures = fixtures;
    this.group.add(fixtures);
  }

  clear(): void {
    this.fixtures?.removeFromParent();
    this.fixtures = null;
    this.anchors = [];
    this.setPaths([]);
    this.setWaits([]);
    this.setLate([]);
    this.setBeads([]);
  }

  get built(): boolean {
    return this.fixtures !== null;
  }

  private ruler(): THREE.Vector3 {
    return new THREE.Vector3(-5.2, 0, 5.2);
  }

  /** Where each full hour sits on the corner ruler, for the labels (heights as when fully raised). */
  hourMarks(): { at: THREE.Vector3; hour: number }[] {
    if (!this.fixtures) return [];
    const marks: { at: THREE.Vector3; hour: number }[] = [];
    for (let time = Math.ceil(this.start / 60) * 60; time <= this.end; time += 60) {
      marks.push({ at: this.ruler().setY(this.heightOf(time)), hour: time / 60 });
    }
    return marks;
  }

  private point(moment: Moment): THREE.Vector3 {
    const anchor = this.anchors[moment.node];
    return new THREE.Vector3(anchor.x, this.heightOf(moment.time), anchor.z);
  }

  private segments(spans: readonly Span[]): Segment[] {
    return spans.map(([from, to]) => [this.point(from), this.point(to)]);
  }

  /** One climbing path per truck. */
  setPaths(paths: readonly { color: string; spans: Span[] }[]): void {
    while (this.paths.length < paths.length) {
      const layer = new ThreadLayer(0.042, PALETTE.ink);
      this.paths.push(layer);
      this.group.add(layer.group);
    }
    this.paths.forEach((layer, i) => {
      const path = paths[i];
      if (!path) {
        layer.set([]);
        return;
      }
      layer.setColor(path.color);
      layer.set(this.segments(path.spans));
    });
  }

  /** Pale vertical stretches: a truck waiting for a window to open. */
  setWaits(spans: readonly Span[]): void {
    this.waits.set(this.segments(spans));
  }

  /** Thick dark stretches above a sleeve: how late a delivery is. */
  setLate(spans: readonly Span[]): void {
    this.late.set(this.segments(spans));
  }

  /** A bead where each delivery starts; `big` marks the ones that failed. */
  setBeads(beads: readonly { node: number; time: number; color: string; big?: boolean }[]): void {
    while (this.beads.length < Math.min(beads.length, BEADS)) {
      const bead = buildMarble(0.085, PALETTE.ink);
      bead.castShadow = false;
      this.beads.push(bead);
      this.group.add(bead);
    }
    this.beads.forEach((bead, i) => {
      const spec = beads[i];
      bead.visible = spec !== undefined;
      if (!spec) return;
      bead.position.copy(this.point(spec));
      bead.scale.setScalar(spec.big ? 0.12 : 0.085);
      (bead.material as THREE.MeshStandardMaterial).color.set(spec.color);
    });
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
