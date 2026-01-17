import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { World } from './world';
import { Entity } from './entity';
import { SceneConfig } from '../scenes/SceneSchema';
import { Simulation } from './simulation';
import { KeyboardController } from './controller';

/**
 * Scene Loader
 * Responsible for instantiating the world from JSON configuration and loading assets.
 */
export class SceneLoader {
  private gltfLoader: GLTFLoader;

  constructor() {
    this.gltfLoader = new GLTFLoader();
  }

  /**
   * Loads a scene configuration into a simulation.
   */
  public async load(config: SceneConfig, simulation: Simulation): Promise<void> {
    const world = simulation.getWorld();
    world.reset();

    for (const entityConfig of config.entities) {
      const entity = new Entity({
        id: entityConfig.id,
        type: entityConfig.type,
        position: entityConfig.position,
        rotation: entityConfig.rotation,
      });

      if (entityConfig.asset) {
        try {
          const gltf = await this.loadAsset(entityConfig.asset);
          entity.visual = gltf.scene;
          // Apply initial transform to visual
          entity.visual.position.copy(entity.position);
          if (entityConfig.rotation) {
            entity.visual.quaternion.set(
              entityConfig.rotation.x,
              entityConfig.rotation.y,
              entityConfig.rotation.z,
              entityConfig.rotation.w
            );
          }
        } catch (error) {
          console.error(`Failed to load asset for entity ${entity.id}:`, error);
        }
      }

      world.addEntity(entity);

      // Attach controller if specified
      if (entityConfig.controller === 'keyboard') {
        simulation.registerController(entity.id, new KeyboardController());
      }
    }
  }

  /**
   * Loads a single GLB asset into the world as a new entity.
   * Useful for importing generated assets at runtime.
   */
  public async loadGeneratedAsset(
    assetUrl: string,
    simulation: Simulation,
    options: { position?: { x: number; y: number; z: number } } = {}
  ): Promise<string> {
    const world = simulation.getWorld();
    const gltf = await this.loadAsset(assetUrl);
    const entityId = `generated_${crypto.randomUUID?.() ?? Date.now().toString(36)}`;
    const position = options.position ?? { x: 0, y: 0, z: 0 };

    const entity = new Entity({
      id: entityId,
      type: 'generated',
      position,
    });

    entity.visual = gltf.scene;
    entity.visual.position.copy(entity.position);
    world.addEntity(entity);

    return entityId;
  }

  private loadAsset(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => resolve(gltf),
        undefined,
        (error) => reject(error)
      );
    });
  }
}
