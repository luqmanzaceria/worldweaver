import * as THREE from 'three';

/**
 * WorldWeaver Entity
 * The base unit of the simulation.
 * Entities represent physical or abstract objects with position, rotation, and velocity.
 */
export interface EntityState {
  id: string;
  type: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  velocity: { x: number; y: number; z: number };
  angularVelocity: { x: number; y: number; z: number };
  metadata?: Record<string, unknown>;
  sensors?: EntitySensorConfig[];
}

export interface EntitySensorConfig {
  id: string;
  kind: 'raycast';
  direction: { x: number; y: number; z: number };
  range: number;
}

export class Entity {
  public id: string;
  public type: string;
  public position: THREE.Vector3 = new THREE.Vector3();
  public rotation: THREE.Quaternion = new THREE.Quaternion();
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public angularVelocity: THREE.Vector3 = new THREE.Vector3();
  public metadata: Record<string, unknown> = {};
  public sensors: EntitySensorConfig[] = [];
  
  // Rendering-only visual object
  public visual?: THREE.Object3D;

  constructor(state: Partial<EntityState>) {
    this.id = state.id || Math.random().toString(36).substr(2, 9);
    this.type = state.type || 'generic';
    
    if (state.position) this.position.set(state.position.x, state.position.y, state.position.z);
    if (state.rotation) this.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w);
    if (state.velocity) this.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
    if (state.angularVelocity) this.angularVelocity.set(state.angularVelocity.x, state.angularVelocity.y, state.angularVelocity.z);
    if (state.metadata) this.metadata = { ...state.metadata };
    if (state.sensors) this.sensors = state.sensors.map(sensor => ({ ...sensor }));
  }

  /**
   * Captures a serializable snapshot of the entity state.
   */
  getState(): EntityState {
    return {
      id: this.id,
      type: this.type,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      rotation: { x: this.rotation.x, y: this.rotation.y, z: this.rotation.z, w: this.rotation.w },
      velocity: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z },
      angularVelocity: { x: this.angularVelocity.x, y: this.angularVelocity.y, z: this.angularVelocity.z },
      metadata: { ...this.metadata },
      sensors: this.sensors.map(sensor => ({ ...sensor })),
    };
  }

  /**
   * Applies a state to the entity.
   */
  setState(state: EntityState) {
    this.position.set(state.position.x, state.position.y, state.position.z);
    this.rotation.set(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w);
    this.velocity.set(state.velocity.x, state.velocity.y, state.velocity.z);
    this.angularVelocity.set(state.angularVelocity.x, state.angularVelocity.y, state.angularVelocity.z);
    this.metadata = state.metadata ? { ...state.metadata } : {};
    this.sensors = state.sensors ? state.sensors.map(sensor => ({ ...sensor })) : [];
  }
}
