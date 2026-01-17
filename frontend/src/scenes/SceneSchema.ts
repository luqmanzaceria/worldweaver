export interface EntityConfig {
  id: string;
  type: string;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number; w: number };
  controller?: 'keyboard' | 'script' | 'policy';
  asset?: string; // URL to GLB asset
}

export interface SceneConfig {
  name: string;
  entities: EntityConfig[];
}
