'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getBrickDef } from '@/lib/engine/brick_catalog';
import type { BrickInstance } from '@/lib/engine/types';

const UNIT = 1;
const PLATE_HEIGHT = 0.4;
const STUD_RADIUS = 0.3;
const STUD_HEIGHT = 0.2;

export interface BrickMeshProps {
  brick: BrickInstance;
  faded?: boolean;
  highlighted?: boolean;
  yOffset?: number;
  hidden?: boolean;
  /** Adjacent reference layer — very low opacity, non-interactive */
  adjacentLayer?: boolean;
  unstable?: boolean;
  marginal?: boolean;
  onClick?: (brick: BrickInstance, shiftKey: boolean) => void;
}

export function BrickMesh({ brick, faded = false, highlighted = false, yOffset = 0, hidden = false, adjacentLayer = false, unstable = false, marginal = false, onClick }: BrickMeshProps) {
  const unstableRef = useRef<THREE.MeshBasicMaterial>(null);

  // Pulse animation for unstable overlay — skip frame work when not unstable
  useFrame(({ clock }) => {
    if (!unstable || !unstableRef.current) return;
    const t = clock.getElapsedTime();
    unstableRef.current.opacity = 0.15 + 0.2 * (0.5 + 0.5 * Math.sin(t * 4));
  });
  const def = getBrickDef(brick.brickId);
  const dims = useMemo(() => {
    if (!def) return null;
    // Use studWidth/studDepth from grid placement when available (accurate).
    // Fall back to catalog def + rotation for legacy data.
    let width: number;
    let depth: number;
    if (brick.studWidth != null && brick.studDepth != null) {
      width = brick.studWidth;
      depth = brick.studDepth;
    } else {
      const rotated = brick.rotation === 90 || brick.rotation === 270;
      width = rotated ? def.depth : def.width;
      depth = rotated ? def.width : def.depth;
    }
    const height = def.height * PLATE_HEIGHT;
    return { width, depth, height };
  }, [def, brick.rotation, brick.studWidth, brick.studDepth]);

  if (!def || !dims || hidden) return null;

  const worldX = brick.position[0] * UNIT;
  const worldY = brick.position[1] * PLATE_HEIGHT + yOffset;
  const worldZ = brick.position[2] * UNIT;
  const isTransparent = faded || adjacentLayer;
  const bodyColor = isTransparent
    ? new THREE.Color(brick.color).lerp(new THREE.Color('#F0EFE9'), adjacentLayer ? 0.65 : 0.5)
    : new THREE.Color(brick.color);
  const bodyOpacity = adjacentLayer ? 0.08 : faded ? 0.55 : 1;

  // No physical rotation when studWidth/studDepth are set — dimensions are already correct
  const useRotation = brick.studWidth == null;
  const yRot = useRotation ? (brick.rotation * Math.PI) / 180 : 0;

  return (
    <group position={[worldX, worldY, worldZ]} rotation={[0, yRot, 0]}>
      <mesh
        castShadow
        receiveShadow
        position={[0, dims.height / 2, 0]}
        onPointerDown={onClick ? (e) => { e.stopPropagation(); onClick(brick, e.nativeEvent.shiftKey); } : undefined}
      >
        <boxGeometry args={[dims.width * UNIT - 0.04, dims.height - 0.02, dims.depth * UNIT - 0.04]} />
        <meshPhongMaterial
          color={bodyColor}
          shininess={isTransparent ? 20 : 48}
          specular="#555555"
          transparent={isTransparent}
          opacity={bodyOpacity}
          depthWrite={!adjacentLayer}
        />
      </mesh>

      {def.type !== 'tile' &&
        Array.from({ length: dims.depth }).flatMap((_, dz) =>
          Array.from({ length: dims.width }).map((__, dx) => {
            const studX = dx - (dims.width - 1) / 2;
            const studZ = dz - (dims.depth - 1) / 2;
            return (
              <mesh
                key={`${dx}-${dz}`}
                castShadow
                position={[studX * UNIT, dims.height + STUD_HEIGHT / 2, studZ * UNIT]}
              >
                <cylinderGeometry args={[STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 12]} />
                <meshPhongMaterial
                  color={bodyColor}
                  shininess={isTransparent ? 20 : 48}
                  specular="#555555"
                  transparent={isTransparent}
                  opacity={bodyOpacity}
                  depthWrite={!adjacentLayer}
                />
              </mesh>
            );
          })
        )}

      {highlighted && (
        <mesh position={[0, dims.height / 2, 0]}>
          <boxGeometry args={[dims.width * UNIT + 0.1, dims.height + 0.1, dims.depth * UNIT + 0.1]} />
          <meshBasicMaterial color="#FFD500" transparent opacity={0.22} side={THREE.BackSide} />
        </mesh>
      )}

      {unstable && (
        <mesh position={[0, dims.height / 2, 0]}>
          <boxGeometry args={[dims.width * UNIT + 0.1, dims.height + 0.1, dims.depth * UNIT + 0.1]} />
          <meshBasicMaterial ref={unstableRef} color="#FF4444" transparent opacity={0.25} side={THREE.BackSide} depthWrite={false} />
        </mesh>
      )}

      {marginal && !unstable && (
        <mesh position={[0, dims.height / 2, 0]}>
          <boxGeometry args={[dims.width * UNIT + 0.1, dims.height + 0.1, dims.depth * UNIT + 0.1]} />
          <meshBasicMaterial color="#FFA500" transparent opacity={0.25} side={THREE.BackSide} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
