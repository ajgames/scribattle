import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

/**
 * R3F drawing-surface proof of concept: a paper plane with an ink stroke
 * "painted" onto it as 3D geometry (a tube swept along a curve).
 *
 * This is the seed of the 3D-painting upgrade — real strokes will be built
 * the same way from pointer input (raycast pointer → point on paper →
 * extend the curve), which unlocks brush thickness, ink relief, lighting,
 * and camera moves that a flat 2D canvas can't do.
 */

function InkStroke() {
  const group = useRef<THREE.Group>(null);

  // a hand-drawn-looking squiggle across the paper
  const tube = useMemo(() => {
    const points = [
      new THREE.Vector3(-2.4, 0.02, 0.5),
      new THREE.Vector3(-1.6, 0.02, -0.6),
      new THREE.Vector3(-0.8, 0.02, 0.7),
      new THREE.Vector3(0, 0.02, -0.7),
      new THREE.Vector3(0.8, 0.02, 0.6),
      new THREE.Vector3(1.6, 0.02, -0.5),
      new THREE.Vector3(2.4, 0.02, 0.4),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    return new THREE.TubeGeometry(curve, 120, 0.045, 12, false);
  }, []);

  useFrame(({ clock }) => {
    if (!group.current) return;
    // gentle idle float so the scene reads as alive
    group.current.rotation.z = Math.sin(clock.elapsedTime * 0.4) * 0.02;
  });

  return (
    <group ref={group}>
      {/* paper */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[7, 4.5]} />
        <meshStandardMaterial color="#ffffff" roughness={0.95} />
      </mesh>
      {/* ink */}
      <mesh geometry={tube} castShadow>
        <meshStandardMaterial color="#1c1917" roughness={0.35} />
      </mesh>
    </group>
  );
}

export function DrawCanvas() {
  return (
    <Canvas
      shadows
      camera={{ position: [0, 4.2, 3.4], fov: 40 }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      <color attach="background" args={['#f7f5f1']} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 6, 2]} intensity={1.4} castShadow />
      <InkStroke />
    </Canvas>
  );
}
