I have analyzed the current project structure and your requirements. The project root currently contains the frontend application. I will restructure it to create a dedicated `frontend` folder as requested, and then implement the GLB viewer with WASD controls.

### Plan:
1.  **Restructure Project**:
    *   Create a `frontend` directory.
    *   Move all frontend-related files (`src`, `public`, `index.html`, `package.json`, `vite.config.ts`, etc.) into `frontend/`.
    *   Update `package.json` scripts to correctly point to the `tools` folder (which will remain in the root).

2.  **Dependencies**:
    *   Install `@react-three/fiber` and `@react-three/drei` in the `frontend` project to enable easy 3D rendering and camera controls.

3.  **Implement GLB Viewer**:
    *   Create `frontend/public/worlds/` directory and a placeholder `dummy.glb` file.
    *   Create a new component `frontend/src/components/GlbViewer.tsx`.
    *   Implement a 3D scene with:
        *   `KeyboardControls` for WASD input.
        *   `PointerLockControls` or similar for looking around (mouse).
        *   A movement logic hook to update camera position based on WASD keys.
        *   `useGLTF` to load the hardcoded model path (`/worlds/dummy.glb`).
        *   `Suspense` to handle loading states.

4.  **Integration**:
    *   Update `frontend/src/App.tsx` to display the new `GlbViewer` component.

### Outcome:
You will have a webapp in `./frontend` that attempts to load a GLB file from `./worlds` (served via `public/worlds`) and allows navigating the scene using WASD keys and the mouse.
