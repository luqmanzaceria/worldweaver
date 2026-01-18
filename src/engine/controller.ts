/**
 * Controller Interface
 * Unifies humans, scripts, and AI policies.
 */
export interface Action {
  type: 'continuous' | 'discrete';
  values: Record<string, number>;
}

export interface Controller {
  computeAction(observation: any): Action;
  reset(): void;
}

/**
 * Keyboard Controller
 * Translates user input into the standard Action interface.
 */
export class KeyboardController implements Controller {
  private keys: Set<string> = new Set();
  private speed: number = 5;

  constructor() {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  computeAction(_observation: any): Action {
    const action: Action = {
      type: 'continuous',
      values: { x: 0, y: 0, z: 0 }
    };

    if (this.keys.has('KeyW')) action.values.z = -this.speed;
    if (this.keys.has('KeyS')) action.values.z = this.speed;
    if (this.keys.has('KeyA')) action.values.x = -this.speed;
    if (this.keys.has('KeyD')) action.values.x = this.speed;

    return action;
  }

  reset() {
    this.keys.clear();
  }
}
