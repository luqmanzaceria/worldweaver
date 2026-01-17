import React, { Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, KeyboardControls, PointerLockControls, Box, Text, useKeyboardControls } from '@react-three/drei';
import * as THREE from 'three';

// Controls mapping
const controls = [
  { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
  { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
  { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
];

function AsyncModel({ url }: { url: string }) {
    // This will suspend until loaded, or throw if failed
    const { scene } = useGLTF(url);
    return <primitive object={scene} />;
}

function Placeholder() {
    return (
        <group>
            <Box args={[1, 1, 1]} position={[0, 0.5, 0]}>
                <meshStandardMaterial color="orange" wireframe />
            </Box>
            <Text position={[0, 1.5, 0]} color="white" fontSize={0.3} anchorX="center" anchorY="middle">
                Loading / Placeholder
            </Text>
        </group>
    )
}

function WasdControls() {
  const { camera } = useThree();
  const [, get] = useKeyboardControls();
  
  useFrame((state, delta) => {
    const speed = 10 * delta;
    const { forward, backward, left, right } = get();
    
    // Move camera relative to its local orientation
    if (forward) camera.translateZ(-speed);
    if (backward) camera.translateZ(speed);
    if (left) camera.translateX(-speed);
    if (right) camera.translateX(speed);
  });
  
  return null;
}

// Simple Error Boundary for the model
class ModelErrorBoundary extends React.Component<{ fallback: React.ReactNode, children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: any) { console.error("Model load error:", error); }
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function ErrorFallback() {
    return (
        <group>
            <Box args={[1, 1, 1]} position={[0, 0.5, 0]}>
                <meshStandardMaterial color="red" />
            </Box>
            <Text position={[0, 1.5, 0]} color="red" fontSize={0.3} anchorX="center" anchorY="middle">
                Failed to load GLB
            </Text>
        </group>
    )
}

const GlbViewer: React.FC = () => {
  return (
    <div className="w-full h-full bg-gray-900 relative">
        <KeyboardControls map={controls}>
            <Canvas camera={{ position: [0, 2, 5], fov: 75 }}>
                <ambientLight intensity={0.5} />
                <directionalLight position={[10, 10, 5]} intensity={1} />
                
                <Suspense fallback={<Placeholder />}>
                    <ModelErrorBoundary fallback={<ErrorFallback />}>
                       <AsyncModel url="/worlds/dummy.glb" />
                    </ModelErrorBoundary>
                </Suspense>
                
                <PointerLockControls />
                <WasdControls />
                
                <gridHelper args={[20, 20]} />
            </Canvas>
            <div className="absolute top-4 left-4 text-white bg-black/50 p-4 rounded pointer-events-none select-none">
                <h2 className="font-bold mb-2">GLB Viewer</h2>
                <p>WASD to Move</p>
                <p>Click to capture mouse (Look around)</p>
                <p>ESC to release mouse</p>
                <p className="text-xs mt-2 opacity-70">Loading: /worlds/dummy.glb</p>
            </div>
        </KeyboardControls>
    </div>
  );
}

export default GlbViewer;
