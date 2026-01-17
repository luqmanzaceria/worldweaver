import * as THREE from 'three';
import { Entity } from './entity';
import { World } from './world';
import { Sensors } from './sensors';
import type { RaycastHit } from './sensors';

/**
 * Observation System
 * Provides structured data to controllers.
 * Ensures controllers don't have direct access to the global world state.
 */
export interface Observation {
  self: {
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
  };
  environment: {
    nearbyEntities: Array<{ id: string; position: { x: number; y: number; z: number } }>;
    visibleEntities: Array<{ id: string; position: { x: number; y: number; z: number } }>;
  };
  sensors: {
    raycasts: Array<{ id: string; hit: RaycastHit }>;
  };
}

export class ObservationSystem {
  private sensors: Sensors;

  constructor(private world: World) {
    this.sensors = new Sensors(world);
  }

  /**
   * Computes an observation for a specific entity.
   */
  getObservation(entity: Entity): Observation {
    const allEntities = this.world.getAllEntities();
    
    // Simple spatial query: find entities within 10 units
    const nearby = allEntities
      .filter(e => e.id !== entity.id && e.position.distanceTo(entity.position) < 10)
      .map(e => ({
        id: e.id,
        position: { x: e.position.x, y: e.position.y, z: e.position.z }
      }));

    const visibleEntities = this.getVisibleEntities(entity, allEntities);
    const raycasts = entity.sensors
      .filter(sensor => sensor.kind === 'raycast')
      .map(sensor => ({
        id: sensor.id,
        hit: this.sensors.castRay(
          entity,
          new THREE.Vector3(sensor.direction.x, sensor.direction.y, sensor.direction.z),
          sensor.range
        )
      }));

    return {
      self: {
        position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
        velocity: { x: entity.velocity.x, y: entity.velocity.y, z: entity.velocity.z },
      },
      environment: {
        nearbyEntities: nearby,
        visibleEntities,
      },
      sensors: {
        raycasts,
      }
    };
  }

  private getVisibleEntities(entity: Entity, entities: Entity[]) {
    // Placeholder: visibility is a spatial proximity check for now.
    return entities
      .filter(e => e.id !== entity.id && e.position.distanceTo(entity.position) < 25)
      .map(e => ({
        id: e.id,
        position: { x: e.position.x, y: e.position.y, z: e.position.z }
      }));
  }
}
