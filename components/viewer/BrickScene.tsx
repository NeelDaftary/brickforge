'use client';

import { useMemo } from 'react';
import type { BrickInstance, BrickModelData } from '@/lib/engine/types';
import type { EditTool } from './EditToolbar';
import { BrickMesh } from './BrickMesh';
import { CameraControls } from './CameraControls';
import { EditGridPlane } from './EditGridPlane';

export type ViewMode = 'complete' | 'step';

/** Compute the model's extent to scale the scene accordingly. */
function computeModelExtent(model: BrickModelData): number {
  if (model.voxelData) {
    const g = model.voxelData;
    const sx = g.grid.length;
    const sy = sx > 0 ? g.grid[0].length : 0;
    const sz = sy > 0 ? g.grid[0][0].length : 0;
    return Math.max(sx, sy, sz * 1.2); // z scaled by plate height ratio
  }
  // Fallback: compute from brick positions
  let maxExtent = 10;
  for (const b of model.bricks) {
    const ex = Math.abs(b.position[0]) + (b.studWidth ?? 1);
    const ez = Math.abs(b.position[2]) + (b.studDepth ?? 1);
    maxExtent = Math.max(maxExtent, ex * 2, ez * 2);
  }
  return maxExtent;
}

interface BrickSceneProps {
  model: BrickModelData;
  viewMode: ViewMode;
  currentStep: number;
  onBrickClick?: (brick: BrickInstance, shiftKey: boolean) => void;
  editMode?: boolean;
  editGrid?: string[][][] | null;
  editTool?: EditTool;
  activeLayer?: number;
  selectedColor?: string | null;
  colorLegend?: Record<string, string>;
  onGridCellClick?: (gx: number, gy: number, gz: number) => void;
  showAdjacentLayers?: boolean;
  unstableCells?: Set<string>;
  marginalCells?: Set<string>;
}

export function BrickScene({
  model,
  viewMode,
  currentStep,
  onBrickClick,
  editMode,
  editGrid,
  editTool,
  activeLayer,
  selectedColor,
  colorLegend,
  onGridCellClick,
  showAdjacentLayers = true,
  unstableCells,
  marginalCells,
}: BrickSceneProps) {
  // Layer view only applies to add/erase — paint mode shows all layers
  const hasLayerView = editMode && activeLayer != null && editTool !== 'paint';

  // Scale scene elements to fit the model
  const extent = useMemo(() => computeModelExtent(model), [model]);
  const gridSize = Math.max(30, Math.ceil(extent * 1.5 / 2) * 2); // round up to even, at least 30
  const planeSize = gridSize * 2;

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight
        intensity={0.8}
        position={[extent, extent * 2, extent]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight intensity={0.3} position={[-extent, extent * 0.5, -extent]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
        <planeGeometry args={[planeSize, planeSize]} />
        <meshLambertMaterial color="#E8E6DF" />
      </mesh>
      <gridHelper args={[gridSize, gridSize, '#D0CFC8', '#D0CFC8']} />

      {model.bricks.map((brick) => {
        if (viewMode === 'step' && brick.step > currentStep) return null;
        const brickGz = brick.metadata?.gz;

        // Layer-aware visibility in edit mode (add/erase only, not paint)
        let hidden = false;
        let adjacentLayer = false;
        if (hasLayerView && brickGz != null) {
          const dist = Math.abs(brickGz - activeLayer);
          if (dist === 0) {
            // Active layer — full visibility
          } else if (dist === 1 && showAdjacentLayers) {
            // Adjacent layer — show as low-opacity reference
            adjacentLayer = true;
          } else {
            // Far layers (or adjacent with toggle off) — hide
            hidden = true;
          }
        }

        const faded = viewMode === 'step' && brick.step < currentStep;
        const highlighted = !editMode && viewMode === 'step' && brick.step === currentStep;

        // Stability flags
        const cellKey = brickGz != null ? `${brick.metadata!.gx},${brick.metadata!.gy},${brickGz}` : '';
        const unstable = (editMode && unstableCells?.has(cellKey)) || false;
        const marginal = (editMode && marginalCells?.has(cellKey)) || false;

        return (
          <BrickMesh
            key={brick.id}
            brick={brick}
            faded={faded}
            highlighted={highlighted}
            hidden={hidden}
            adjacentLayer={adjacentLayer}
            unstable={unstable}
            marginal={marginal}
            onClick={adjacentLayer ? undefined : onBrickClick}
          />
        );
      })}

      {editMode && editGrid && editTool && editTool !== 'paint' && activeLayer != null && colorLegend && onGridCellClick && (
        <EditGridPlane
          editGrid={editGrid}
          activeLayer={activeLayer}
          editTool={editTool}
          selectedColor={selectedColor ?? null}
          colorLegend={colorLegend}
          onGridCellClick={onGridCellClick}
        />
      )}

      <CameraControls autoRotate={viewMode === 'complete' && !editMode} />
    </>
  );
}
