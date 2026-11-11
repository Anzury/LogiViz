import * as THREE from 'three/webgpu';
import { THREAD_GEOMETRY } from './parts';

const UP = new THREE.Vector3(0, 1, 0);

export type Segment = [THREE.Vector3, THREE.Vector3];

/** A set of straight threads sharing one material, stretched between points of the model. */
export class ThreadLayer {
  readonly group = new THREE.Group();
  private readonly material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
  private readonly meshes: THREE.Mesh[] = [];
  private growing: { mesh: THREE.Mesh; segment: Segment; t: number } | null = null;

  constructor(
    private readonly radius: number,
    color: string,
    private readonly options: { opacity?: number; shadow?: boolean; halo?: boolean } = {},
  ) {
    // A halo draws only the far wall of its tube, so a thread running through
    // it stays fully visible and gets a bright outline instead of a tint.
    this.material = options.halo
      ? new THREE.MeshBasicMaterial({ color, side: THREE.BackSide })
      : new THREE.MeshStandardMaterial({
          color,
          roughness: 0.8,
          transparent: options.opacity !== undefined,
          opacity: options.opacity ?? 1,
        });
  }

  setColor(color: string): void {
    this.material.color.set(color);
  }

  set(segments: Segment[], growLast = false): void {
    while (this.meshes.length < segments.length) {
      const mesh = new THREE.Mesh(THREAD_GEOMETRY, this.material);
      mesh.castShadow = this.options.shadow ?? false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    this.meshes.forEach((mesh, i) => {
      mesh.visible = i < segments.length;
      if (mesh.visible) this.place(mesh, segments[i], 1);
    });
    this.growing = null;
    if (growLast && segments.length > 0) {
      const mesh = this.meshes[segments.length - 1];
      this.growing = { mesh, segment: segments[segments.length - 1], t: 0 };
      this.place(mesh, this.growing.segment, 0);
    }
  }

  update(dt: number): void {
    if (!this.growing) return;
    this.growing.t = Math.min(this.growing.t + dt / 0.22, 1);
    const eased = 1 - (1 - this.growing.t) ** 3;
    this.place(this.growing.mesh, this.growing.segment, eased);
    if (this.growing.t >= 1) this.growing = null;
  }

  private place(mesh: THREE.Mesh, [a, b]: Segment, fraction: number): void {
    const direction = b.clone().sub(a);
    const length = direction.length();
    if (length < 1e-6) {
      mesh.visible = false;
      return;
    }
    mesh.position.copy(a).addScaledVector(direction, fraction / 2);
    mesh.scale.set(this.radius, Math.max(length * fraction, 1e-4), this.radius);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  }
}
