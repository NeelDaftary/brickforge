'use client';

import type { BrickInstance, BrickModelData } from '@/lib/engine/types';
import type { EditTool } from './EditToolbar';
import { BrickMesh } from './BrickMesh';
import { CameraControls } from './CameraControls';
import { EditGridPlane } from './EditGridPlane';

export type ViewMode = 'complete' | 'step' | 'exploded';

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

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight
        intensity={0.8}
        position={[10, 20, 10]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight intensity={0.3} position={[-10, 5, -10]} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
        <planeGeometry args={[50, 50]} />
        <meshLambertMaterial color="#E8E6DF" />
      </mesh>
      <gridHelper args={[30, 30, '#D0CFC8', '#D0CFC8']} />

      {model.bricks.map((brick) => {
        if (viewMode === 'step' && brick.step > currentStep) return null;
        const brickGz = brick.metadata?.gz;

        // Layer-aware visibility in edit mode (add/erase only, not paint)
        let hidden = false;
        let layerFaded = false;
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

        const faded = layerFaded || (viewMode === 'step' && brick.step < currentStep);
        const highlighted = !editMode && viewMode === 'step' && brick.step === currentStep;
        const yOffset = viewMode === 'exploded' ? brick.step * 2.5 : 0;

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
            yOffset={yOffset}
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
