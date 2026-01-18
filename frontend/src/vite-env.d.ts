/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BLENDER_LOCAL?: string;
  readonly VITE_BLENDER_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
