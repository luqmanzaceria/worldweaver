import * as THREE from 'three';
import { World } from './world';

/**
 * Renderer
 * Handles Three.js visualization of the world state.
 * Interpolates between simulation steps if needed (though we keep it simple here).
 */
export class Renderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private webGLRenderer: THREE.WebGLRenderer;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x111111);

    const width = container.clientWidth;
    const height = container.clientHeight;

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.set(0, 10, 15);
    this.camera.lookAt(0, 0, 0);

    this.webGLRenderer = new THREE.WebGLRenderer({ antialias: true });
    this.webGLRenderer.setSize(width, height);
    this.webGLRenderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.webGLRenderer.domElement);

    this.addLights();
    
    window.addEventListener('resize', () => this.onWindowResize());
  }

  private addLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    this.scene.add(directionalLight);
  }

  private onWindowResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.webGLRenderer.setSize(width, height);
  }

  /**
   * Synchronizes the Three.js scene with the world state.
   */
  public sync(world: World) {
    world.getAllEntities().forEach(entity => {
      if (!entity.visual) {
        // Create a default visual if none exists
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
        const mesh = new THREE.Mesh(geometry, material);
        entity.visual = mesh;
        this.scene.add(mesh);
      } else if (!entity.visual.parent) {
        // Ensure externally provided visuals (GLB) are in the scene
        this.scene.add(entity.visual);
      }
      
      // Update visual transform from entity state
      entity.visual.position.copy(entity.position);
      entity.visual.quaternion.copy(entity.rotation);
    });
  }

  public render() {
    this.webGLRenderer.render(this.scene, this.camera);
  }

  public getScene(): THREE.Scene {
    return this.scene;
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }
}
