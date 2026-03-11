'use client';

import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { EditTool } from './EditToolbar';

const UNIT = 1;
const PLATE_HEIGHT = 0.4;

interface EditGridPlaneProps {
  editGrid: string[][][];
  activeLayer: number;
  editTool: EditTool;
  selectedColor: string | null;
  colorLegend: Record<string, string>;
  onGridCellClick: (gx: number, gy: number, gz: number) => void;
}

export function EditGridPlane({
  editGrid,
  activeLayer,
  editTool,
  selectedColor,
  colorLegend,
  onGridCellClick,
}: EditGridPlaneProps) {
  const [hoveredCell, setHoveredCell] = useState<{ gx: number; gy: number } | null>(null);
  const planeRef = useRef<THREE.Mesh>(null);

  const sizeX = editGrid.length;
  const sizeY = sizeX > 0 ? editGrid[0].length : 0;
  const sizeZ = sizeY > 0 ? editGrid[0][0].length : 0;
  const centerX = sizeX / 2;
  const centerY = sizeY / 2;

  // World Y position for the active layer
  const layerWorldY = activeLayer * 3 * PLATE_HEIGHT;

  // Plane size: extend a few cells beyond grid for expansion
  const padding = 3;
  const planeWidth = (sizeX + padding * 2) * UNIT;
  const planeDepth = (sizeY + padding * 2) * UNIT;

  // Compute grid cell from intersection point
  const pointToCell = (point: THREE.Vector3) => {
    const gx = Math.floor(point.x / UNIT + centerX + 0.5);
    const gy = Math.floor(point.z / UNIT + centerY + 0.5);
    return { gx, gy };
  };

  // Ghost preview position (world coords)
  const ghostPosition = useMemo(() => {
    if (!hoveredCell) return null;
    const { gx, gy } = hoveredCell;
    const worldX = (gx - centerX) * UNIT;
    const worldZ = (gy - centerY) * UNIT;
    return new THREE.Vector3(worldX, layerWorldY + PLATE_HEIGHT * 1.5, worldZ);
  }, [hoveredCell, centerX, centerY, layerWorldY]);

  // Determine ghost color and visibility
  const ghostInfo = useMemo(() => {
    if (!hoveredCell || !ghostPosition) return null;
    const { gx, gy } = hoveredCell;
    // Inline fill check to avoid stale closure from function reference
    const filled =
      gx >= 0 && gx < sizeX && gy >= 0 && gy < sizeY &&
      activeLayer >= 0 && activeLayer < sizeZ &&
      editGrid[gx][gy][activeLayer] !== '0' &&
      editGrid[gx][gy][activeLayer] !== '*';

    if (editTool === 'add' && !filled && selectedColor) {
      return { color: selectedColor, opacity: 0.3, visible: true };
    }
    if (editTool === 'erase' && filled) {
      return { color: '#FF4444', opacity: 0.3, visible: true };
    }
    return null;
  }, [hoveredCell, ghostPosition, editTool, selectedColor, editGrid, activeLayer, sizeX, sizeY, sizeZ]);

  // Grid lines geometry at the active layer (single BufferGeometry with all segments)
  const gridLinesGeometry = useMemo(() => {
    const points: number[] = [];
    const halfX = centerX;
    const halfY = centerY;
    const y = layerWorldY + 0.01;

    // X-axis lines
    for (let i = 0; i <= sizeX; i++) {
      const x = (i - halfX) * UNIT - UNIT / 2;
      points.push(x, y, -halfY * UNIT - UNIT / 2);
      points.push(x, y, (sizeY - halfY) * UNIT - UNIT / 2);
    }
    // Z-axis lines
    for (let j = 0; j <= sizeY; j++) {
      const z = (j - halfY) * UNIT - UNIT / 2;
      points.push(-halfX * UNIT - UNIT / 2, y, z);
      points.push((sizeX - halfX) * UNIT - UNIT / 2, y, z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return geo;
  }, [sizeX, sizeY, centerX, centerY, layerWorldY]);

  return (
    <group>
      {/* Grid lines at active layer */}
      <lineSegments geometry={gridLinesGeometry}>
        <lineBasicMaterial color="#4A90D9" transparent opacity={0.4} />
      </lineSegments>

      {/* Invisible raycast plane */}
      <mesh
        ref={planeRef}
        position={[0, layerWorldY + 0.01, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerMove={(e) => {
          e.stopPropagation();
          const cell = pointToCell(e.point);
          setHoveredCell(cell);
        }}
        onPointerLeave={() => setHoveredCell(null)}
        onPointerDown={(e) => {
          e.stopPropagation();
          const cell = pointToCell(e.point);
          onGridCellClick(cell.gx, cell.gy, activeLayer);
        }}
      >
        <planeGeometry args={[planeWidth, planeDepth]} />
        <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
      </mesh>

      {/* Ghost preview brick */}
      {ghostInfo?.visible && ghostPosition && (
        <mesh position={ghostPosition}>
          <boxGeometry args={[UNIT - 0.04, PLATE_HEIGHT * 3 - 0.02, UNIT - 0.04]} />
          <meshBasicMaterial
            color={ghostInfo.color}
            transparent
            opacity={ghostInfo.opacity}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}
