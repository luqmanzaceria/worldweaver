import React, { Suspense, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, KeyboardControls, PointerLockControls, Box, Text, useKeyboardControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { PLAYER_HEIGHT, PLAYER_RADIUS, JUMP_FORCE, GRAVITY, MOVE_SPEED, FLY_SPEED } from '../constants/camera';

// Controls mapping
const controls = [
  { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
  { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
  { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'down', keys: ['ShiftLeft', 'ShiftRight'] },
];

function AsyncModel({ url }: { url: string }) {
    const { scene } = useGLTF(url);
    const { camera } = useThree();
    const lastUrl = React.useRef<string | null>(null);

    React.useEffect(() => {
        if (scene && lastUrl.current !== url) {
            lastUrl.current = url;
            
            // Calculate bounding box of the loaded scene
            const box = new THREE.Box3().setFromObject(scene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            // Position camera above the model at z=0 as requested
            const spawnX = center.x;
            const spawnY = box.max.y + 20;
            const spawnZ = 0;
            
            camera.position.set(spawnX, spawnY, spawnZ);
            
            // Look at the center of the structure at eye level
            camera.lookAt(center.x, center.y, center.z);
        }
    }, [scene, url, camera]);

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

function WasdControls({ isFlying }: { isFlying: boolean }) {
  const { camera, scene } = useThree();
  const [, get] = useKeyboardControls();
  const raycaster = React.useMemo(() => new THREE.Raycaster(), []);
  
  // Physics state
  const velocity = React.useRef(new THREE.Vector3());
  const isGrounded = React.useRef(false);
  
  // Memoize meshes to avoid traversing the whole scene every frame
  const collidableObjectsRef = React.useRef<THREE.Object3D[]>([]);
  const lastUpdateRef = React.useRef(0);

  useFrame((state, delta) => {
    const { forward, backward, left, right, jump, down } = get();

    if (isFlying) {
      const speed = FLY_SPEED * delta;
      // Fly relative to camera direction
      if (forward) camera.translateZ(-speed);
      if (backward) camera.translateZ(speed);
      if (left) camera.translateX(-speed);
      if (right) camera.translateX(speed);
      
      // Global Up/Down
      if (jump) camera.position.y += speed;
      if (down) camera.position.y -= speed;
      
      // Reset physics state so we don't carry momentum/falling when switching back
      velocity.current.set(0, 0, 0);
      isGrounded.current = false;
      return;
    }
    
    // 1. Update collidable objects list (Throttle to avoid heavy traverse)
    const now = state.clock.getElapsedTime();
    if (collidableObjectsRef.current.length === 0 || now - lastUpdateRef.current > 1) {
      const meshes: THREE.Object3D[] = [];
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh && object.visible && !object.name.includes('grid') && !object.name.includes('Helper')) {
          meshes.push(object);
        }
      });
      collidableObjectsRef.current = meshes;
      lastUpdateRef.current = now;
    }

    const collidableObjects = collidableObjectsRef.current;
    if (collidableObjects.length === 0) return;

    // 2. Anti-Entrapment: Check if we are inside an object and push out
    // We cast rays in 6 directions to detect if we are inside geometry
    const directions = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
    ];

    directions.forEach(dir => {
      raycaster.set(camera.position, dir);
      raycaster.far = PLAYER_RADIUS;
      // Use DoubleSide to catch backfaces (meaning we are inside)
      const hits = raycaster.intersectObjects(collidableObjects, true);
      
      if (hits.length > 0) {
        const hit = hits[0];
        // If we hit a face from the inside (normal points same way as ray)
        // or if we are just way too close, push back
        const isBackface = hit.face && hit.face.normal.clone().applyQuaternion(hit.object.quaternion).dot(dir) > 0;
        
        if (isBackface || hit.distance < 0.1) {
          const pushStrength = PLAYER_RADIUS - hit.distance;
          camera.position.add(dir.clone().multiplyScalar(-pushStrength * 1.5));
        }
      }
    });

    // 3. Horizontal Movement Calculation
    const inputDir = new THREE.Vector3();
    if (forward) inputDir.z -= 1;
    if (backward) inputDir.z += 1;
    if (left) inputDir.x -= 1;
    if (right) inputDir.x += 1;

    if (inputDir.lengthSq() > 0) {
      inputDir.normalize();
      
      // Get camera rotation but ignore pitch (look up/down)
      const cameraRot = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      cameraRot.x = 0;
      cameraRot.z = 0;
      const horizontalQuat = new THREE.Quaternion().setFromEuler(cameraRot);
      
      // Movement relative to camera orientation
      const moveDirection = inputDir.clone().applyQuaternion(horizontalQuat);
      
      // Check collision in X and Z separately to allow sliding along walls
      const axes = ['x', 'z'] as const;
      axes.forEach(axis => {
        const axisDir = new THREE.Vector3();
        axisDir[axis] = moveDirection[axis];
        if (axisDir.lengthSq() < 0.0001) return;
        
        const axisNormalized = axisDir.clone().normalize();
        const moveAmount = axisDir.length() * MOVE_SPEED * delta;
        
        // Raycast at multiple heights (Feet, Waist, Eyes)
        const checkHeights = [0, -0.7, -1.4]; // Relative to camera position (eye level)
        let collisionDetected = false;
        
        for (const hOffset of checkHeights) {
          const rayStart = camera.position.clone();
          rayStart.y += hOffset;
          
          raycaster.set(rayStart, axisNormalized);
          raycaster.far = PLAYER_RADIUS + moveAmount;
          
          const hits = raycaster.intersectObjects(collidableObjects, true);
          if (hits.length > 0) {
            collisionDetected = true;
            break;
          }
        }
        
        if (!collisionDetected) {
          camera.position[axis] += moveDirection[axis] * MOVE_SPEED * delta;
        }
      });
    }

    // 3. Gravity and Jumping
    if (isGrounded.current && jump) {
      velocity.current.y = JUMP_FORCE;
      isGrounded.current = false;
    }

    // Apply velocity
    velocity.current.y -= GRAVITY * delta;
    camera.position.y += velocity.current.y * delta;

    // 4. Floor Collision & Grounding
    const downDir = new THREE.Vector3(0, -1, 0);
    const rayDownStart = camera.position.clone();
    rayDownStart.y += 0.5; // Offset above eye level to catch the floor while falling/landing
    
    raycaster.set(rayDownStart, downDir);
    raycaster.far = PLAYER_HEIGHT + 0.6; // Distance from rayDownStart to feet
    
    const floorHits = raycaster.intersectObjects(collidableObjects, true);
    
    if (floorHits.length > 0) {
      const hit = floorHits[0];
      const targetY = hit.point.y + PLAYER_HEIGHT;
      
      // If we hit a floor surface and we are falling or close to it
      if (camera.position.y <= targetY) {
        camera.position.y = targetY;
        velocity.current.y = 0;
        isGrounded.current = true;
      } else {
        isGrounded.current = false;
      }
    } else {
      // Minimum ground level fallback (0)
      if (camera.position.y <= PLAYER_HEIGHT) {
        camera.position.y = PLAYER_HEIGHT;
        velocity.current.y = 0;
        isGrounded.current = true;
      } else {
        isGrounded.current = false;
      }
    }
  });

  return null;
}

// Simple Error Boundary for the model
class ModelErrorBoundary extends React.Component<{ fallback: (error: Error | null) => React.ReactNode, children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error) { console.error("Model load error:", error); }
  render() {
    if (this.state.hasError) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

function ErrorFallback({ error, onRetry }: { error: Error | null, onRetry: () => void }) {
    return (
        <group>
            <Box args={[1, 1, 1]} position={[0, 0.5, 0]}>
                <meshStandardMaterial color="red" />
            </Box>
            <Text position={[0, 1.5, 0]} color="red" fontSize={0.3} anchorX="center" anchorY="middle">
                Failed to load GLB
            </Text>
            {error && (
                <Text position={[0, 1.1, 0]} color="white" fontSize={0.18} anchorX="center" anchorY="middle" maxWidth={6}>
                    {error.message}
                </Text>
            )}
            <Box 
                args={[1.2, 0.4, 0.1]} 
                position={[0, 0.5, 0.6]} 
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                onPointerOver={() => document.body.style.cursor = 'pointer'}
                onPointerOut={() => document.body.style.cursor = 'auto'}
            >
                <meshStandardMaterial color="#444" />
            </Box>
            <Text position={[0, 0.5, 0.66]} color="white" fontSize={0.15} anchorX="center" anchorY="middle">
                Retry Load
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

const GlbViewer: React.FC<{ url: string; isFlying: boolean }> = ({ url, isFlying }) => {
  const [retryKey, setRetryKey] = useState(0);
  const handleRetry = () => setRetryKey(prev => prev + 1);

  // Use retryKey for re-mounting on error, but NOT the url.
  // This preserves camera and scene state across version swaps.
  const canvasKey = `canvas-${retryKey}`;

  return (
    <div className="w-full h-full relative" style={{ backgroundColor: '#e5e5e5' }}>
        <KeyboardControls map={controls}>
            <Canvas camera={{ position: [10, PLAYER_HEIGHT, 10], fov: 50, near: 0.1 }} key={canvasKey}>
                {/* Blender Default Background Color */}
                <color attach="background" args={['#e5e5e5']} />
                
                <ambientLight intensity={0.5} />
                <directionalLight position={[10, 10, 5]} intensity={1} />
                <hemisphereLight intensity={0.3} groundColor="#e5e5e5" />
                
                <Suspense fallback={<Placeholder />}>
                    <ModelErrorBoundary fallback={(error) => <ErrorFallback error={error} onRetry={handleRetry} />}>
                       <AsyncModel key={url} url={url} />
                    </ModelErrorBoundary>
                </Suspense>
                
                <PointerLockControls />
                <WasdControls isFlying={isFlying} />
                
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
        </KeyboardControls>
    </div>
  );
}

export default GlbViewer;
