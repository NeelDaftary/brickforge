'use client';

/**
 * MeshPreview: Renders a small Three.js canvas showing an uploaded mesh
 * with color-coded axis arrows so the user can identify which axis is "up".
 *
 * X = red, Y = green, Z = blue
 * Supports OBJ / STL / PLY / GLB.
 */

import { useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// ─── Types ─────────────────────────────────────────────────────────────────

interface MeshPreviewProps {
  file: File;
}

interface MeshState {
  geometry: THREE.BufferGeometry | null;
  center: THREE.Vector3;
  size: number; // max bounding box dimension
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function loadGeometry(file: File): Promise<THREE.BufferGeometry | null> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    const text = await file.text();
    const loader = new OBJLoader();
    const group = loader.parse(text);

    // Merge all child geometries into one
    const geometries: THREE.BufferGeometry[] = [];
    group.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const cloned = child.geometry.clone();
        child.updateWorldMatrix(true, false);
        cloned.applyMatrix4(child.matrixWorld);
        geometries.push(cloned);
      }
    });

    if (geometries.length === 0) return null;
    if (geometries.length === 1) return geometries[0];

    const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    return mergeGeometries(geometries, true);
  }

  if (ext === 'stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    const buffer = await file.arrayBuffer();
    const loader = new STLLoader();
    return loader.parse(buffer);
  }

  if (ext === 'ply') {
    const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
    const buffer = await file.arrayBuffer();
    const loader = new PLYLoader();
    return loader.parse(buffer);
  }

  if (ext === 'glb') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const buffer = await file.arrayBuffer();
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(buffer, '');

    const geometries: THREE.BufferGeometry[] = [];
    gltf.scene.updateWorldMatrix(true, true);
    gltf.scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const cloned = child.geometry.clone();
        child.updateWorldMatrix(true, false);
        cloned.applyMatrix4(child.matrixWorld);
        geometries.push(cloned);
      }
    });

    if (geometries.length === 0) return null;
    if (geometries.length === 1) return geometries[0];
    const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
    return mergeGeometries(geometries, true);
  }

  return null;
}

// ─── Inner scene (runs inside Canvas context) ──────────────────────────────

function MeshScene({ geometry, center, size }: MeshState & { size: number }) {
  const { camera } = useThree();

  useEffect(() => {
    // Position camera to see the whole mesh
    const dist = size * 1.8;
    camera.position.set(dist * 0.8, dist * 0.6, dist * 1.0);
    camera.lookAt(center);
    if ('zoom' in camera) {
      (camera as THREE.OrthographicCamera).zoom = 1;
      camera.updateProjectionMatrix();
    }
  }, [camera, center, size]);

  if (!geometry) return null;

  // Axis arrow size proportional to bounding box
  const arrowLen = size * 0.55;
  const headLen = arrowLen * 0.22;
  const headWidth = headLen * 0.6;
  const origin = new THREE.Vector3(
    center.x - size * 0.5,
    center.y - size * 0.5,
    center.z - size * 0.5,
  );

  return (
    <>
      {/* Ambient + directional lights */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 5]} intensity={0.9} />
      <directionalLight position={[-4, -3, -4]} intensity={0.3} />

      {/* Mesh */}
      <mesh geometry={geometry} position={[-center.x, -center.y, -center.z]}>
        <meshStandardMaterial color="#CCCCCC" side={THREE.DoubleSide} />
      </mesh>

      {/* X axis arrow — red */}
      <arrowHelper
        args={[
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(origin.x - center.x, origin.y - center.y, origin.z - center.z),
          arrowLen,
          0xdd2222,
          headLen,
          headWidth,
        ]}
      />

      {/* Y axis arrow — green */}
      <arrowHelper
        args={[
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(origin.x - center.x, origin.y - center.y, origin.z - center.z),
          arrowLen,
          0x22aa44,
          headLen,
          headWidth,
        ]}
      />

      {/* Z axis arrow — blue */}
      <arrowHelper
        args={[
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(origin.x - center.x, origin.y - center.y, origin.z - center.z),
          arrowLen,
          0x2266dd,
          headLen,
          headWidth,
        ]}
      />

      <OrbitControls makeDefault enablePan={false} enableZoom={true} />
    </>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function MeshPreview({ file }: MeshPreviewProps) {
  const [meshState, setMeshState] = useState<MeshState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);
    setMeshState(null);

    loadGeometry(file)
      .then((geo) => {
        if (!mountedRef.current) return;
        if (!geo) {
          setError('Could not parse mesh geometry.');
          setLoading(false);
          return;
        }

        geo.computeBoundingBox();
        const box = geo.boundingBox!;
        const center = new THREE.Vector3();
        box.getCenter(center);
        const sizeVec = new THREE.Vector3();
        box.getSize(sizeVec);
        const size = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);

        setMeshState({ geometry: geo, center, size });
        setLoading(false);
      })
      .catch((e) => {
        if (!mountedRef.current) return;
        setError(`Preview failed: ${e instanceof Error ? e.message : String(e)}`);
        setLoading(false);
      });

    return () => {
      mountedRef.current = false;
    };
  }, [file]);

  return (
    <div className="relative w-full rounded-lg overflow-hidden bg-[#F0EFE9] border border-[#DDDDDD]" style={{ height: 200 }}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-[#999999]">
          Loading preview…
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-[#CC8800] px-4 text-center">
          {error}
        </div>
      )}
      {meshState && !loading && (
        <>
          <Canvas
            camera={{ position: [3, 2, 3], fov: 45 }}
            style={{ width: '100%', height: '100%' }}
          >
            <MeshScene {...meshState} />
          </Canvas>

          {/* Axis labels — HTML overlay */}
          <div className="absolute bottom-2 left-2 flex gap-2 pointer-events-none">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#dd2222', color: '#fff' }}>X</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#22aa44', color: '#fff' }}>Y</span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#2266dd', color: '#fff' }}>Z</span>
          </div>
          <div className="absolute top-2 right-2 pointer-events-none">
            <span className="text-[9px] text-[#999999] bg-white/70 px-1.5 py-0.5 rounded">drag to rotate</span>
          </div>
        </>
      )}
    </div>
  );
}
