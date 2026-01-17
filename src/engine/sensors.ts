import * as THREE from 'three';
import { World } from './world';
import { Entity } from './entity';

export interface RaycastHit {
  distance: number;
  hit: string | null;
}

export interface RaycastRequest {
  direction: THREE.Vector3;
  range: number;
}

/**
 * Sensor System
 * Implements physical sensors for entities (raycasting, etc.)
 */
export class Sensors {
  private raycaster: THREE.Raycaster = new THREE.Raycaster();

  constructor(private world: World) {}

  /**
   * Performs a raycast from an entity's position in its forward direction.
   */
  public castRay(entity: Entity, direction: THREE.Vector3, range: number = 10): RaycastHit {
    // We need the visual meshes for raycasting
    const objects = this.world.getAllEntities()
      .filter(e => e.id !== entity.id && e.visual)
      .map(e => e.visual!);

    if (objects.length === 0) return { distance: range, hit: null };

    // Update raycaster
    const worldDir = direction.clone().applyQuaternion(entity.rotation).normalize();
    this.raycaster.set(entity.position, worldDir);
    this.raycaster.far = range;

    const intersections = this.raycaster.intersectObjects(objects, true);

    if (intersections.length > 0) {
      const hit = intersections[0];
      // Find the entity ID associated with this visual object
      const hitEntity = this.world.getAllEntities().find(e => e.visual === hit.object || hit.object.uuid === e.visual?.uuid);
      
      return {
        distance: hit.distance,
        hit: hitEntity ? hitEntity.id : 'unknown'
      };
    }

    return { distance: range, hit: null };
  }
}
