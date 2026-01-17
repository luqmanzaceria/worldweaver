import * as THREE from 'three';
import { Entity, EntityState } from './entity';

/**
 * World State
 * Single source of truth for the entire simulation at a given timestep.
 */
export interface WorldState {
  timestamp: number;
  stepCount: number;
  entities: EntityState[];
  contacts: Contact[];
}

export interface Contact {
  a: string;
  b: string;
  normal: { x: number; y: number; z: number };
  depth: number;
}

export type ContactListener = (contact: Contact) => void;

export class World {
  private entities: Map<string, Entity> = new Map();
  private stepCount: number = 0;
  private currentTime: number = 0;
  private contacts: Contact[] = [];
  private contactListeners: Set<ContactListener> = new Set();
  private initialState: WorldState | null = null;

  constructor() {}

  addEntity(entity: Entity) {
    this.entities.set(entity.id, entity);
  }

  removeEntity(id: string) {
    this.entities.delete(id);
  }

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  getAllEntities(): Entity[] {
    return Array.from(this.entities.values());
  }

  /**
   * Captures the current world state.
   */
  getState(): WorldState {
    return {
      timestamp: this.currentTime,
      stepCount: this.stepCount,
      entities: this.getAllEntities().map(e => e.getState()),
      contacts: this.contacts.map(contact => ({ ...contact })),
    };
  }

  /**
   * Resets world to a previous state or initial state.
   */
  setState(state: WorldState, options: { createMissing?: boolean } = {}) {
    this.currentTime = state.timestamp;
    this.stepCount = state.stepCount;
    this.contacts = state.contacts.map(contact => ({ ...contact }));
    
    // Simplification: We assume entity IDs remain consistent for now
    state.entities.forEach(entityState => {
      const entity = this.entities.get(entityState.id);
      if (entity) {
        entity.setState(entityState);
      } else if (options.createMissing) {
        this.entities.set(entityState.id, new Entity(entityState));
      }
    });
  }

  advance(dt: number) {
    this.currentTime += dt;
    this.stepCount += 1;
    this.contacts = [];
    
    // Basic physics integration (Euler for simplicity in this base class)
    // In a production engine, this might involve a physics engine like Rapier or Cannon
    this.entities.forEach(entity => {
      entity.position.x += entity.velocity.x * dt;
      entity.position.y += entity.velocity.y * dt;
      entity.position.z += entity.velocity.z * dt;
      if (entity.angularVelocity.lengthSq() > 0) {
        const axis = entity.angularVelocity.clone().normalize();
        const angle = entity.angularVelocity.length() * dt;
        const deltaRotation = new THREE.Quaternion().setFromAxisAngle(axis, angle);
        entity.rotation.multiply(deltaRotation);
      }
    });
  }

  clear() {
    this.stepCount = 0;
    this.currentTime = 0;
    this.entities.clear();
    this.contacts = [];
    this.initialState = null;
  }

  captureInitialState() {
    const snapshot = this.getState();
    this.initialState = {
      timestamp: snapshot.timestamp,
      stepCount: snapshot.stepCount,
      entities: snapshot.entities.map(entity => ({ ...entity })),
      contacts: snapshot.contacts.map(contact => ({ ...contact }))
    };
  }

  resetToInitialState() {
    if (!this.initialState) {
      this.clear();
      return;
    }

    this.setState(this.initialState);
  }

  emitContact(contact: Contact) {
    this.contacts.push(contact);
    this.contactListeners.forEach(listener => listener(contact));
  }

  onContact(listener: ContactListener) {
    this.contactListeners.add(listener);
  }

  removeContactListener(listener: ContactListener) {
    this.contactListeners.delete(listener);
  }
}
