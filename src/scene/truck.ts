import * as THREE from 'three/webgpu';
import { buildTruck } from './parts';

const SPEED = 2.4;

/** A toy truck that drives round a loop of points on the board, pausing at each stop. */
export class Truck {
  readonly group: THREE.Group;
  private readonly cab: THREE.MeshStandardMaterial;
  private route: THREE.Vector3[] | null = null;
  private key = '';
  private leg = 0;
  private progress = 0;
  private pause = 0;
  private heading = 0;

  constructor() {
    const { group, cab } = buildTruck();
    this.group = group;
    this.cab = cab;
  }

  /**
   * Sends the truck round `loop` (first point: the depot), or parks it at `home`
   * when the loop is null. Being given the same loop again does not restart it.
   */
  assign(loop: THREE.Vector3[] | null, home: THREE.Vector3, color: string, delay = 0.4): void {
    this.cab.color.set(color);
    const key = loop ? loop.map((p) => `${p.x},${p.z}`).join(';') : `home:${home.x},${home.z}`;
    if (key === this.key) return;
    this.key = key;
    this.route = loop && loop.length > 1 ? loop : null;
    this.leg = 0;
    this.progress = 0;
    this.pause = delay;
    this.group.position.copy(home);
  }

  update(dt: number): void {
    if (!this.route) return;
    if (this.pause > 0) {
      this.pause -= dt;
      return;
    }
    const from = this.route[this.leg];
    const to = this.route[(this.leg + 1) % this.route.length];
    this.progress += (dt * SPEED) / Math.max(from.distanceTo(to), 1e-3);
    this.group.position.lerpVectors(from, to, Math.min(this.progress, 1));

    const wanted = Math.atan2(-(to.z - from.z), to.x - from.x);
    const turn = Math.atan2(Math.sin(wanted - this.heading), Math.cos(wanted - this.heading));
    this.heading += turn * Math.min(dt * 12, 1);
    this.group.rotation.y = this.heading;

    if (this.progress >= 1) {
      this.leg = (this.leg + 1) % this.route.length;
      this.progress = 0;
      this.pause = 0.25;
    }
  }
}
