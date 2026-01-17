import { World } from './world';
import { Controller } from './controller';
import { ObservationSystem } from './observation';

export interface SimulationConfig {
  hz: number; // Frequency of simulation in steps per second
}

/**
 * Simulation Engine
 * Manages the deterministic fixed-timestep loop.
 * Decoupled from rendering.
 */
export class Simulation {
  private world: World;
  private controllers: Map<string, Controller> = new Map();
  private observationSystem: ObservationSystem;
  
  private hz: number;
  private dt: number;
  private accumulator: number = 0;
  private isPaused: boolean = true;
  private lastTime: number = 0;

  constructor(config: SimulationConfig = { hz: 60 }) {
    this.world = new World();
    this.observationSystem = new ObservationSystem(this.world);
    this.hz = config.hz;
    this.dt = 1 / config.hz;
  }

  public registerController(entityId: string, controller: Controller) {
    this.controllers.set(entityId, controller);
  }

  public start() {
    this.isPaused = false;
    this.lastTime = performance.now();
    this.loop();
  }

  public pause() {
    this.isPaused = true;
  }

  public reset() {
    this.world.reset();
    this.controllers.forEach(c => c.reset());
    this.accumulator = 0;
  }

  /**
   * Performs a single deterministic step.
   * 1. Get observations for each entity with a controller.
   * 2. Controllers compute actions based on observations.
   * 3. Apply actions to world.
   * 4. Advance world state by dt.
   */
  public step() {
    // 1. & 2. & 3. Controller Actions
    this.controllers.forEach((controller, entityId) => {
      const entity = this.world.getEntity(entityId);
      if (entity) {
        const observation = this.observationSystem.getObservation(entity);
        const action = controller.computeAction(observation);
        
        // Apply action (simplification: direct velocity/force application)
        if (action.type === 'continuous') {
          entity.velocity.x = action.values.x || 0;
          entity.velocity.z = action.values.z || 0;
        }
      }
    });

    // 4. Advance world
    this.world.advance(this.dt);
  }

  /**
   * Main loop, decoupled from browser paint frequency.
   * Uses an accumulator to ensure deterministic stepping.
   */
  private loop() {
    if (this.isPaused) return;

    const currentTime = performance.now();
    const frameTime = (currentTime - this.lastTime) / 1000;
    this.lastTime = currentTime;

    // Cap frame time to avoid "spiral of death"
    this.accumulator += Math.min(frameTime, 0.25);

    while (this.accumulator >= this.dt) {
      this.step();
      this.accumulator -= this.dt;
    }

    requestAnimationFrame(() => this.loop());
  }

  public getWorld(): World {
    return this.world;
  }

  public getHz(): number {
    return this.hz;
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }
}
