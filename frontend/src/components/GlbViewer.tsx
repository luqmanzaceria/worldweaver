import React, { Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, KeyboardControls, PointerLockControls, Box, Text, useKeyboardControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
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

function BlenderAxes() {
    return (
        <group>
            {/* X Axis - Red */}
            <line>
                <bufferGeometry attach="geometry" {...new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1000, 0, 0), new THREE.Vector3(1000, 0, 0)])} />
                <lineBasicMaterial attach="material" color="#ff3333" opacity={0.6} transparent linewidth={2} />
            </line>
            {/* Z Axis (acting as Y in Blender's visual style) - Green */}
            <line>
                <bufferGeometry attach="geometry" {...new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -1000), new THREE.Vector3(0, 0, 1000)])} />
                <lineBasicMaterial attach="material" color="#55ff55" opacity={0.6} transparent linewidth={2} />
            </line>
        </group>
    );
}

const GlbViewer: React.FC = () => {
  return (
    <div className="w-full h-full relative" style={{ backgroundColor: '#e5e5e5' }}>
        <KeyboardControls map={controls}>
            <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
                {/* Blender Default Background Color */}
                <color attach="background" args={['#e5e5e5']} />
                
                <ambientLight intensity={0.5} />
                <directionalLight position={[10, 10, 5]} intensity={1} />
                <hemisphereLight intensity={0.3} groundColor="#e5e5e5" />
                
                <Suspense fallback={<Placeholder />}>
                    <ModelErrorBoundary fallback={<ErrorFallback />}>
                       <AsyncModel url="/worlds/dummy.glb" />
                    </ModelErrorBoundary>
                </Suspense>
                
                <PointerLockControls />
                <WasdControls />
                
                {/* Blender-like Grid */}
                <Grid 
                    infiniteGrid 
                    fadeDistance={50} 
                    sectionColor="#888888" 
                    cellColor="#bbbbbb" 
                    sectionSize={10}
                    cellSize={1}
                    position={[0, -0.01, 0]} 
                />
                <BlenderAxes />

                {/* Blender Gizmo - customized to mimic Z-up look (Blue=Up) */}
                <GizmoHelper alignment="top-right" margin={[80, 80]}>
                    <GizmoViewport 
                        axisColors={['#ff3333', '#3333ff', '#55ff55']} 
                        labelColor="black" 
                        labels={['X', 'Z', 'Y']}
                    />
                </GizmoHelper>

            </Canvas>
            
            {/* UI Overlay - Minimal to match Blender's clean look */}
            <div className="absolute top-4 left-4 text-black/80 font-sans text-sm select-none pointer-events-none">
                <div className="bg-[#f0f0f0]/80 p-3 rounded border border-black/10 backdrop-blur-sm shadow-sm">
                    <h2 className="font-bold mb-2 text-gray-800">GLB Viewer</h2>
                    <ul className="space-y-1 text-xs text-gray-600">
                        <li><span className="font-mono text-gray-700">WASD</span> Move</li>
                        <li><span className="font-mono text-gray-700">Click</span> Look</li>
                        <li><span className="font-mono text-gray-700">ESC</span> Release</li>
                    </ul>
                </div>
            </div>
        </KeyboardControls>
    </div>
  );
}

export default GlbViewer;
