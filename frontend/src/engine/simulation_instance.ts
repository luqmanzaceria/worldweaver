import { Simulation } from './simulation';
import { KeyboardController } from './controller';
import { Entity } from './entity';

/**
 * Global Simulation Instance
 * Orhcestrates the simulation lifecycle and makes it accessible to React.
 */
let simulation: Simulation | null = null;

export function getSimulation(): Simulation {
  if (!simulation) {
    simulation = new Simulation({ hz: 60 });
    
    // Initial entities for testing
    const player = new Entity({
      id: 'player_1',
      type: 'agent',
      position: { x: 0, y: 0.5, z: 0 }
    });
    
    simulation.getWorld().addEntity(player);
    simulation.registerController(player.id, new KeyboardController());
  }
  return simulation;
}

export function resetSimulation() {
  if (simulation) {
    simulation.reset();
  }
}

