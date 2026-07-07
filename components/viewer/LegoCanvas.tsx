'use client';

import { Canvas } from '@react-three/fiber';
import { useCallback, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import type { BrickInstance, BrickModelData } from '@/lib/engine/types';
import { COLOR_PALETTE } from '@/lib/engine/color-palette';
import { floodFill } from '@/lib/engine/flood-fill';
import { expandGridIfNeeded } from '@/lib/engine/grid-utils';
import { checkGridStability } from '@/lib/pipeline/brick-stability';
import type { GraphDiagnosticBrickIds } from '@/lib/pipeline_v2/brick-graph';
import { BrickScene, type ViewMode } from './BrickScene';
import { BuildStepsPanel } from './BuildStepsPanel';
import { EditToolbar, type EditTool } from './EditToolbar';
type TopTab = 'complete' | 'step' | 'paint' | 'build';
import { ReferenceImages } from './ReferenceImages';

interface LegoCanvasProps {
  model: BrickModelData;
  diagnosticBrickIds?: Partial<GraphDiagnosticBrickIds>;
  onModelUpdate?: (model: BrickModelData) => void;
}

type DiagnosticOverlayMode =
  | 'auto'
  | 'floating'
  | 'unsupported'
  | 'weakCantilever'
  | 'supportedCantilever'
  | 'articulation'
  | 'bridge'
  | 'internalSupport'
  | 'oracle'
  | 'off';

function getMaxStep(model: BrickModelData): number {
  return model.bricks.reduce((max, b) => Math.max(max, b.step), 1);
}

/** Build reverse lookup: hex → symbol from the palette. */
const HEX_TO_SYMBOL = new Map(COLOR_PALETTE.map((c) => [c.hex, c.symbol]));
const SYMBOL_TO_HEX = new Map(COLOR_PALETTE.map((c) => [c.symbol, c.hex]));

/** Deep-clone a 3D string grid. */
function cloneGrid(grid: string[][][]): string[][][] {
  return grid.map((plane) => plane.map((col) => [...col]));
}

/**
 * Build a 1x1 voxel model from a grid for the edit-mode view.
 * Every filled voxel becomes a single 1x1 BrickInstance.
 */
function gridTo1x1Model(
  grid: string[][][],
  colorLegend: Record<string, string>,
  name: string,
): BrickModelData {
  const sizeX = grid.length;
  const sizeY = sizeX > 0 ? grid[0].length : 0;
  const sizeZ = sizeY > 0 ? grid[0][0].length : 0;
  const centerX = sizeX / 2;
  const centerY = sizeY / 2;

  const bricks: BrickInstance[] = [];
  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        const sym = grid[x][y][z];
        if (sym === '0' || sym === '*') continue;
        const hex = colorLegend[sym] ?? SYMBOL_TO_HEX.get(sym) ?? '#A0A5A9';
        bricks.push({
          id: uuid(),
          brickId: 'b_1x1',
          position: [x - centerX, z * 3, y - centerY],
          rotation: 0,
          studWidth: 1,
          studDepth: 1,
          color: hex,
          step: z + 1,
          metadata: { gx: x, gy: y, gz: z, gw: 1, gd: 1 },
        });
      }
    }
  }

  return { name, description: '', totalBricks: bricks.length, bricks };
}

function computeModelExtent(model: BrickModelData): number {
  if (model.voxelData) {
    const g = model.voxelData;
    const sx = g.grid.length;
    const sy = sx > 0 ? g.grid[0].length : 0;
    const sz = sy > 0 ? g.grid[0][0].length : 0;
    return Math.max(sx, sy, sz * 1.2);
  }
  let maxExtent = 10;
  for (const b of model.bricks) {
    const ex = Math.abs(b.position[0]) + (b.studWidth ?? 1);
    const ez = Math.abs(b.position[2]) + (b.studDepth ?? 1);
    maxExtent = Math.max(maxExtent, ex * 2, ez * 2);
  }
  return maxExtent;
}

function activeDiagnosticOverlay(mode: DiagnosticOverlayMode, ids?: Partial<GraphDiagnosticBrickIds>): DiagnosticOverlayMode {
  if (mode !== 'auto') return mode;
  const order: DiagnosticOverlayMode[] = [
    'floating',
    'unsupported',
    'weakCantilever',
    'oracle',
    'articulation',
    'bridge',
    'supportedCantilever',
    'internalSupport',
  ];
  return order.find((candidate) => (ids?.[candidate as keyof GraphDiagnosticBrickIds]?.length ?? 0) > 0) ?? 'off';
}

function diagnosticCount(mode: DiagnosticOverlayMode, ids?: Partial<GraphDiagnosticBrickIds>): number {
  if (mode === 'auto' || mode === 'off') return 0;
  return ids?.[mode as keyof GraphDiagnosticBrickIds]?.length ?? 0;
}

export function LegoCanvas({ model, diagnosticBrickIds, onModelUpdate }: LegoCanvasProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('complete');
  const [currentStep, setCurrentStep] = useState(1);
  const [diagnosticOverlayMode, setDiagnosticOverlayMode] = useState<DiagnosticOverlayMode>('auto');
  const activeOverlayMode = activeDiagnosticOverlay(diagnosticOverlayMode, diagnosticBrickIds);
  const maxStep = useMemo(() => getMaxStep(model), [model]);

  // Adaptive camera based on model size
  const extent = useMemo(() => computeModelExtent(model), [model]);
  const camDist = Math.max(14, extent * 1.2);
  const camZoom = Math.max(10, Math.min(45, 600 / extent));
  const camFar = Math.max(200, camDist * 6);

  // ─── Edit mode state ──────────────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editTool, setEditTool] = useState<EditTool>('paint');
  const [activeLayer, setActiveLayer] = useState(0);
  const [showAdjacentLayers, setShowAdjacentLayers] = useState(true);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [editedGrid, setEditedGrid] = useState<string[][][] | null>(null);
  const [changeCount, setChangeCount] = useState(0);
  const [applying, setApplying] = useState(false);
  // 1x1 voxel model for edit-mode rendering
  const [voxelModel, setVoxelModel] = useState<BrickModelData | null>(null);
  // Reference images for color benchmarking
  const [refImages, setRefImages] = useState<string[]>([]);
  // Stability state
  const [unstableCells, setUnstableCells] = useState<Set<string>>(new Set());
  const [marginalCells, setMarginalCells] = useState<Set<string>>(new Set());
  const stabilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const voxelData = model.voxelData;
  const canEdit = !!voxelData;

  // In edit mode show the 1x1 voxel model, otherwise the optimized model
  const displayModel = editMode && voxelModel ? voxelModel : model;

  // Compute max layer from current grid
  const maxLayer = useMemo(() => {
    if (!editedGrid) return 0;
    const sizeZ = editedGrid[0]?.[0]?.length ?? 0;
    return Math.max(0, sizeZ - 1);
  }, [editedGrid]);

  const goPrev = () => {
    setViewMode('step');
    setCurrentStep((s) => Math.max(1, s - 1));
  };
  const goNext = () => {
    setViewMode('step');
    setCurrentStep((s) => Math.min(maxStep, s + 1));
  };

  // ─── Build full color legend (original + all palette colors) ────────

  const fullLegend = useMemo(() => {
    const legend: Record<string, string> = {};
    if (voxelData) {
      for (const [sym, hex] of Object.entries(voxelData.colorLegend)) {
        legend[sym] = hex;
      }
    }
    for (const c of COLOR_PALETTE) {
      if (!legend[c.symbol]) legend[c.symbol] = c.hex;
    }
    return legend;
  }, [voxelData]);

  // ─── Stability check (debounced) ──────────────────────────────────

  const runStabilityCheck = useCallback((grid: string[][][]) => {
    if (stabilityTimer.current) clearTimeout(stabilityTimer.current);
    stabilityTimer.current = setTimeout(() => {
      const result = checkGridStability(grid);
      setUnstableCells(new Set([...result.critical, ...result.weak]));
      setMarginalCells(result.marginal);
    }, 200);
  }, []);

  // ─── commitGridChange helper ──────────────────────────────────────

  const commitGridChange = useCallback(
    (newGrid: string[][][]) => {
      setEditedGrid(newGrid);
      setChangeCount((c) => c + 1);
      setVoxelModel(gridTo1x1Model(newGrid, fullLegend, model.name));
      runStabilityCheck(newGrid);
    },
    [fullLegend, model.name, runStabilityCheck],
  );

  // ─── Enter/exit edit mode ─────────────────────────────────────────────

  const cancelEdit = useCallback(() => {
    setEditMode(false);
    setEditTool('paint');
    setActiveLayer(0);
    setSelectedColor(null);
    setEditedGrid(null);
    setChangeCount(0);
    setVoxelModel(null);
    setUnstableCells(new Set());
    setMarginalCells(new Set());
    setViewMode('complete');
  }, []);

  // Derive which top tab is active
  const activeTab: TopTab = editMode
    ? editTool === 'paint' ? 'paint' : 'build'
    : viewMode === 'step' ? 'step' : 'complete';

  const handleTabChange = useCallback((tab: TopTab) => {
    if (tab === 'complete' || tab === 'step') {
      if (editMode && changeCount > 0) return; // don't leave edit with unsaved changes
      if (editMode) cancelEdit();
      setViewMode(tab);
    } else if (tab === 'paint') {
      if (!canEdit) return;
      if (editMode) {
        setEditTool('paint');
      } else {
        // Enter edit mode with paint tool
        if (!voxelData) return;
        const grid = cloneGrid(voxelData.grid);
        setEditMode(true);
        setEditTool('paint');
        setActiveLayer(0);
        setEditedGrid(grid);
        setChangeCount(0);
        setVoxelModel(gridTo1x1Model(grid, fullLegend, model.name));
        setViewMode('complete');
        const result = checkGridStability(grid);
        setUnstableCells(new Set([...result.critical, ...result.weak]));
        setMarginalCells(result.marginal);
      }
    } else if (tab === 'build') {
      if (!canEdit) return;
      if (editMode) {
        setEditTool('add');
      } else {
        if (!voxelData) return;
        const grid = cloneGrid(voxelData.grid);
        setEditMode(true);
        setEditTool('add');
        setActiveLayer(0);
        setEditedGrid(grid);
        setChangeCount(0);
        setVoxelModel(gridTo1x1Model(grid, fullLegend, model.name));
        setViewMode('complete');
        const result = checkGridStability(grid);
        setUnstableCells(new Set([...result.critical, ...result.weak]));
        setMarginalCells(result.marginal);
      }
    }
  }, [editMode, changeCount, cancelEdit, canEdit, voxelData, fullLegend, model.name]);

  // ─── Apply: run wildcard + greedy optimizer on edited grid ────────────

  const applyEdit = useCallback(async () => {
    if (!editedGrid || !voxelData) return;
    setApplying(true);

    try {
      // Compute gridSize from actual editedGrid dimensions
      const gridSize = Math.max(editedGrid.length, editedGrid[0]?.length ?? 0, editedGrid[0]?.[0]?.length ?? 0);

      const res = await fetch('/api/voxelize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voxelData: {
            grid: editedGrid,
            color_legend: fullLegend,
          },
          gridSize,
          name: model.name,
          description: model.description,
          shell: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        console.error('Re-optimization failed:', data.error);
        return;
      }

      const newModel: BrickModelData = await res.json();
      setEditMode(false);
      setEditTool('paint');
      setActiveLayer(0);
      setSelectedColor(null);
      setEditedGrid(null);
      setChangeCount(0);
      setVoxelModel(null);
      setUnstableCells(new Set());
      setMarginalCells(new Set());
      onModelUpdate?.(newModel);
    } catch (err) {
      console.error('Re-optimization error:', err);
    } finally {
      setApplying(false);
    }
  }, [editedGrid, voxelData, fullLegend, model.name, model.description, onModelUpdate]);

  // ─── Unified voxel action handler ──────────────────────────────────

  const handleVoxelAction = useCallback(
    (gx: number, gy: number, gz: number, shiftKey: boolean) => {
      if (!editMode || !editedGrid) return;

      if (editTool === 'paint') {
        // Paint: need a selected color and a filled cell
        if (!selectedColor) return;
        const sizeX = editedGrid.length;
        const sizeY = sizeX > 0 ? editedGrid[0].length : 0;
        const sizeZ = sizeY > 0 ? editedGrid[0][0].length : 0;
        if (gx < 0 || gx >= sizeX || gy < 0 || gy >= sizeY || gz < 0 || gz >= sizeZ) return;

        const currentSymbol = editedGrid[gx][gy][gz];
        if (currentSymbol === '0' || currentSymbol === '*') return; // Can't paint empty

        const newSymbol = HEX_TO_SYMBOL.get(selectedColor);
        if (!newSymbol || currentSymbol === newSymbol) return;

        const positionsToUpdate = new Set<string>();
        if (shiftKey) {
          const filled = floodFill(editedGrid, gx, gy, gz);
          for (const key of filled) positionsToUpdate.add(key);
        } else {
          positionsToUpdate.add(`${gx},${gy},${gz}`);
        }

        if (positionsToUpdate.size === 0) return;

        const newGrid = cloneGrid(editedGrid);
        for (const key of positionsToUpdate) {
          const [x, y, z] = key.split(',').map(Number);
          newGrid[x][y][z] = newSymbol;
        }
        commitGridChange(newGrid);
      } else if (editTool === 'add') {
        // Add: need a selected color, target cell must be empty (or out of bounds → expand)
        if (!selectedColor) return;
        const newSymbol = HEX_TO_SYMBOL.get(selectedColor);
        if (!newSymbol) return;

        let grid = editedGrid;
        let adjGx = gx;
        let adjGy = gy;
        let adjGz = gz;

        // Check if we need to expand the grid
        const sizeX = grid.length;
        const sizeY = sizeX > 0 ? grid[0].length : 0;
        const sizeZ = sizeY > 0 ? grid[0][0].length : 0;

        if (gx < 0 || gx >= sizeX || gy < 0 || gy >= sizeY || gz < 0 || gz >= sizeZ) {
          // Expand grid
          const result = expandGridIfNeeded(grid, gx, gy, gz);
          grid = result.grid;
          adjGx = gx + result.offsetX;
          adjGy = gy + result.offsetY;
          adjGz = gz + result.offsetZ;
          // Adjust active layer if grid expanded downward
          if (result.offsetZ > 0) {
            setActiveLayer((prev) => prev + result.offsetZ);
          }
        } else {
          // Cell must be empty to add
          const currentSymbol = grid[gx][gy][gz];
          if (currentSymbol !== '0' && currentSymbol !== '*') return;
        }

        const newGrid = cloneGrid(grid);
        newGrid[adjGx][adjGy][adjGz] = newSymbol;
        commitGridChange(newGrid);
      } else if (editTool === 'erase') {
        // Erase: cell must be filled
        const sizeX = editedGrid.length;
        const sizeY = sizeX > 0 ? editedGrid[0].length : 0;
        const sizeZ = sizeY > 0 ? editedGrid[0][0].length : 0;
        if (gx < 0 || gx >= sizeX || gy < 0 || gy >= sizeY || gz < 0 || gz >= sizeZ) return;

        const currentSymbol = editedGrid[gx][gy][gz];
        if (currentSymbol === '0' || currentSymbol === '*') return;

        const newGrid = cloneGrid(editedGrid);

        if (shiftKey) {
          // Flood-erase connected region
          const filled = floodFill(editedGrid, gx, gy, gz);
          for (const key of filled) {
            const [x, y, z] = key.split(',').map(Number);
            newGrid[x][y][z] = '0';
          }
        } else {
          newGrid[gx][gy][gz] = '0';
        }

        commitGridChange(newGrid);
      }
    },
    [editMode, editTool, selectedColor, editedGrid, commitGridChange],
  );

  // ─── Brick click handler (routes into unified handler) ────────────

  const handleBrickClick = useCallback(
    (brick: BrickInstance, shiftKey: boolean) => {
      if (!editMode) return;
      const m = brick.metadata;
      if (m?.gx == null || m?.gy == null || m?.gz == null) return;
      handleVoxelAction(m.gx, m.gy, m.gz, shiftKey);
    },
    [editMode, handleVoxelAction],
  );

  // ─── Grid cell click handler (from EditGridPlane) ──────────────────

  const handleGridCellClick = useCallback(
    (gx: number, gy: number, gz: number) => {
      handleVoxelAction(gx, gy, gz, false);
    },
    [handleVoxelAction],
  );

  return (
    <div className="w-full rounded-card border-2 border-border bg-surface overflow-hidden lg:flex">
      {editMode && (
        <ReferenceImages
          images={refImages}
          onAdd={(urls) => setRefImages((prev) => [...prev, ...urls])}
          onRemove={(i) => setRefImages((prev) => prev.filter((_, idx) => idx !== i))}
        />
      )}
      <div className="flex-1">
        <div className="h-[600px] relative bg-surface-viewer">
          <Canvas
            orthographic
            shadows
            camera={{ position: [camDist, camDist, camDist], zoom: camZoom, near: 1, far: camFar }}
          >
            <color attach="background" args={['#F0EFE9']} />
            <BrickScene
              model={displayModel}
              viewMode={viewMode}
              currentStep={currentStep}
              onBrickClick={editMode ? handleBrickClick : undefined}
              editMode={editMode}
              editGrid={editedGrid}
              editTool={editTool}
              activeLayer={activeLayer}
              selectedColor={selectedColor}
              colorLegend={fullLegend}
              onGridCellClick={handleGridCellClick}
              showAdjacentLayers={showAdjacentLayers}
              unstableCells={unstableCells}
              marginalCells={marginalCells}
              diagnosticBrickIds={diagnosticBrickIds}
              diagnosticOverlayMode={activeOverlayMode}
            />
          </Canvas>

          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-1 bg-white/90 backdrop-blur px-1 py-1 rounded-xl border border-black/10 shadow-toggle">
            {([
              { tab: 'complete' as TopTab, label: 'Complete' },
              { tab: 'step' as TopTab, label: 'Step' },
              ...(canEdit ? [
                { tab: 'paint' as TopTab, label: 'Paint' },
                { tab: 'build' as TopTab, label: 'Build' },
              ] : []),
            ]).map(({ tab, label }) => {
              const isActive = activeTab === tab;
              const disabled = editMode && changeCount > 0 && (tab === 'complete' || tab === 'step');
              return (
                <button
                  key={tab}
                  onClick={() => handleTabChange(tab)}
                  disabled={disabled}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    isActive
                      ? 'bg-brick-red text-white shadow-toggle-active'
                      : 'text-[#888888] hover:bg-black/5'
                  } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {!editMode && diagnosticBrickIds && (
            <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-1 bg-white/92 backdrop-blur px-2 py-2 rounded-xl border border-black/10 shadow-toggle">
              <span className="px-1.5 text-[10px] font-bold uppercase tracking-[0.8px] text-[#777777]">
                Issues
              </span>
              {([
                ['auto', 'Auto'],
                ['floating', 'Floating'],
                ['unsupported', 'Unsupported'],
                ['weakCantilever', 'Weak'],
                ['supportedCantilever', 'Cantilever'],
                ['articulation', 'Joint'],
                ['bridge', 'Bridge'],
                ['internalSupport', 'Int support'],
                ['oracle', 'Oracle'],
                ['off', 'Off'],
              ] as Array<[DiagnosticOverlayMode, string]>).map(([mode, label]) => {
                const isActive = diagnosticOverlayMode === mode || (diagnosticOverlayMode === 'auto' && activeOverlayMode === mode);
                return (
                  <button
                    key={mode}
                    onClick={() => setDiagnosticOverlayMode(mode)}
                    className={`px-2 py-1 text-[10px] font-semibold rounded-lg whitespace-nowrap transition-all ${
                      isActive ? 'bg-brick-red text-white shadow-toggle-active' : 'text-[#888888] hover:bg-black/5'
                    }`}
                  >
                    {mode === 'auto' || mode === 'off' ? label : `${label} ${diagnosticCount(mode, diagnosticBrickIds)}`}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {editMode && (
          <EditToolbar
            editTool={editTool}
            onSetEditTool={setEditTool}
            activeLayer={activeLayer}
            maxLayer={maxLayer}
            onSetActiveLayer={setActiveLayer}
            showAdjacentLayers={showAdjacentLayers}
            onToggleAdjacentLayers={setShowAdjacentLayers}
            selectedColor={selectedColor}
            onSelectColor={setSelectedColor}
            onApply={applyEdit}
            onCancel={cancelEdit}
            changeCount={changeCount}
            applying={applying}
          />
        )}

        {!editMode && (
          <div className="px-4 py-3 border-t border-border-subtle flex items-center justify-between lg:hidden">
            <button
              onClick={goPrev}
              className="h-9 w-9 rounded-button-sm border-2 border-[#E0DFD9] text-sm font-bold disabled:opacity-30"
              disabled={currentStep <= 1}
            >
              ◀
            </button>
            <div className="text-sm font-semibold text-[#1A1A1A]">
              Step {currentStep} of {maxStep}
            </div>
            <button
              onClick={goNext}
              className="h-9 w-9 rounded-button-sm border-2 border-[#E0DFD9] text-sm font-bold disabled:opacity-30"
              disabled={currentStep >= maxStep}
            >
              ▶
            </button>
          </div>
        )}
      </div>
      {!editMode && (
        <BuildStepsPanel model={displayModel} currentStep={currentStep} maxStep={maxStep} onPrev={goPrev} onNext={goNext} />
      )}
    </div>
  );
}
