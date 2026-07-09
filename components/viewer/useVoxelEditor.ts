'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import type { BrickInstance, BrickModelData } from '@/lib/engine/types';
import { COLOR_PALETTE } from '@/lib/engine/color-palette';
import { floodFill } from '@/lib/engine/flood-fill';
import { expandGridIfNeeded, normalizeGridZ } from '@/lib/engine/grid-utils';
import { checkGridStability } from '@/lib/pipeline/brick-stability';
import { userFacingErrorMessage } from '@/lib/pipeline/user-facing-messages';
import type { BrickerVariant } from '@/lib/pipeline_v2/variants';
import type { RetileCandidate, RetileStyle } from '@/lib/pipeline_v2/retile-selection';
import type { EditTool } from './EditToolbar';

type ModelDiagnostics = {
  brickerEngine?: BrickerVariant;
  voxelSize?: number;
};

const HEX_TO_SYMBOL = new Map(COLOR_PALETTE.map((color) => [color.hex, color.symbol]));
const SYMBOL_TO_HEX = new Map(COLOR_PALETTE.map((color) => [color.symbol, color.hex]));

function cloneGrid(grid: string[][][]): string[][][] {
  return grid.map((plane) => plane.map((col) => [...col]));
}

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

function gridMaxLayer(grid: string[][][] | null): number {
  if (!grid) return 0;
  return Math.max(0, (grid[0]?.[0]?.length ?? 0) - 1);
}

export function useVoxelEditor({
  model,
  onModelUpdate,
}: {
  model: BrickModelData;
  onModelUpdate?: (model: BrickModelData) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editTool, setEditTool] = useState<EditTool>('paint');
  const [activeLayer, setActiveLayer] = useState(0);
  const [showAdjacentLayers, setShowAdjacentLayers] = useState(true);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [editedGrid, setEditedGrid] = useState<string[][][] | null>(null);
  const [changeCount, setChangeCount] = useState(0);
  const [applying, setApplying] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [voxelModel, setVoxelModel] = useState<BrickModelData | null>(null);
  const [refImages, setRefImages] = useState<string[]>([]);
  const [unstableCells, setUnstableCells] = useState<Set<string>>(new Set());
  const [marginalCells, setMarginalCells] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<string[][][][]>([]);
  const [redoStack, setRedoStack] = useState<string[][][][]>([]);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [retileStyle, setRetileStyle] = useState<RetileStyle>('balanced');
  const [retileCandidates, setRetileCandidates] = useState<RetileCandidate[]>([]);
  const [retileLoading, setRetileLoading] = useState(false);
  const [retileError, setRetileError] = useState<string | null>(null);
  const stabilityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const voxelData = model.voxelData;
  const canEdit = !!voxelData;
  const displayModel = editMode && voxelModel ? voxelModel : model;
  const maxLayer = useMemo(() => gridMaxLayer(editedGrid), [editedGrid]);

  const fullLegend = useMemo(() => {
    const legend: Record<string, string> = {};
    if (voxelData) {
      for (const [symbol, hex] of Object.entries(voxelData.colorLegend)) {
        legend[symbol] = hex;
      }
    }
    for (const color of COLOR_PALETTE) {
      if (!legend[color.symbol]) legend[color.symbol] = color.hex;
    }
    return legend;
  }, [voxelData]);

  const resetEditState = useCallback(() => {
    setEditMode(false);
    setEditTool('paint');
    setActiveLayer(0);
    setSelectedColor(null);
    setEditedGrid(null);
    setChangeCount(0);
    setVoxelModel(null);
    setUnstableCells(new Set());
    setMarginalCells(new Set());
    setUndoStack([]);
    setRedoStack([]);
    setSelectedCells(new Set());
    setRetileCandidates([]);
    setRetileError(null);
    setEditError(null);
  }, []);

  const runStabilityCheck = useCallback((grid: string[][][], immediate = false) => {
    const update = () => {
      const result = checkGridStability(grid);
      setUnstableCells(new Set([...result.critical, ...result.weak]));
      setMarginalCells(result.marginal);
    };
    if (stabilityTimer.current) clearTimeout(stabilityTimer.current);
    if (immediate) {
      update();
      return;
    }
    stabilityTimer.current = setTimeout(update, 200);
  }, []);

  const showGrid = useCallback((grid: string[][][]) => {
    setEditedGrid(grid);
    setVoxelModel(gridTo1x1Model(grid, fullLegend, model.name));
    runStabilityCheck(grid);
  }, [fullLegend, model.name, runStabilityCheck]);

  const commitGridChange = useCallback(
    (newGrid: string[][][]) => {
      const normalized = normalizeGridZ(newGrid);
      if (normalized.offsetZ > 0) {
        setActiveLayer((layer) => Math.max(0, layer - normalized.offsetZ));
      }
      if (editedGrid) {
        setUndoStack((stack) => [...stack.slice(-49), cloneGrid(editedGrid)]);
      }
      setRedoStack([]);
      setEditedGrid(normalized.grid);
      setChangeCount((count) => count + 1);
      setVoxelModel(gridTo1x1Model(normalized.grid, fullLegend, model.name));
      setSelectedCells(new Set());
      setRetileCandidates([]);
      setRetileError(null);
      setEditError(null);
      runStabilityCheck(normalized.grid);
    },
    [editedGrid, fullLegend, model.name, runStabilityCheck],
  );

  const enterEdit = useCallback((tool: EditTool) => {
    if (!voxelData) return false;
    const grid = cloneGrid(voxelData.grid);
    setEditMode(true);
    setEditTool(tool);
    setActiveLayer(0);
    setEditedGrid(grid);
    setChangeCount(0);
    setVoxelModel(gridTo1x1Model(grid, fullLegend, model.name));
    setUndoStack([]);
    setRedoStack([]);
    setSelectedCells(new Set());
    setRetileCandidates([]);
    setRetileError(null);
    setEditError(null);
    runStabilityCheck(grid, true);
    return true;
  }, [fullLegend, model.name, runStabilityCheck, voxelData]);

  const undo = useCallback(() => {
    if (!editedGrid || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [cloneGrid(editedGrid), ...stack].slice(0, 50));
    setChangeCount((count) => Math.max(0, count - 1));
    setSelectedCells(new Set());
    setRetileCandidates([]);
    showGrid(cloneGrid(previous));
  }, [editedGrid, showGrid, undoStack]);

  const redo = useCallback(() => {
    if (!editedGrid || redoStack.length === 0) return;
    const next = redoStack[0];
    setRedoStack((stack) => stack.slice(1));
    setUndoStack((stack) => [...stack.slice(-49), cloneGrid(editedGrid)]);
    setChangeCount((count) => count + 1);
    setSelectedCells(new Set());
    setRetileCandidates([]);
    showGrid(cloneGrid(next));
  }, [editedGrid, redoStack, showGrid]);

  const applyEdit = useCallback(async () => {
    if (!editedGrid || !voxelData) return;
    setApplying(true);

    try {
      const normalized = normalizeGridZ(editedGrid);
      const gridSize = Math.max(normalized.grid.length, normalized.grid[0]?.length ?? 0, normalized.grid[0]?.[0]?.length ?? 0);
      const diagnostics = (model as BrickModelData & { diagnostics?: ModelDiagnostics }).diagnostics;

      const res = await fetch('/api/voxelize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voxelData: {
            grid: normalized.grid,
            color_legend: fullLegend,
          },
          gridSize,
          voxelSize: diagnostics?.voxelSize ?? 0.06,
          name: model.name,
          description: model.description,
          shell: true,
          brickerEngine: diagnostics?.brickerEngine ?? 'stability_v2',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setEditError(userFacingErrorMessage(data, 'Could not rebuild the edited bricks.'));
        return;
      }

      resetEditState();
      onModelUpdate?.(await res.json() as BrickModelData);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not rebuild the edited bricks.');
    } finally {
      setApplying(false);
    }
  }, [editedGrid, fullLegend, model, onModelUpdate, resetEditState, voxelData]);

  const retileSelection = useCallback(async () => {
    if (!voxelData || selectedCells.size === 0 || retileLoading) return;
    if (changeCount > 0) {
      setRetileError('Apply your current edits before retiling this section.');
      return;
    }
    setRetileLoading(true);
    setRetileError(null);
    setRetileCandidates([]);
    try {
      const selectedStyles = [retileStyle, 'balanced', 'fewer_parts', 'stronger']
        .filter((style, index, all) => all.indexOf(style) === index) as RetileStyle[];
      const res = await fetch('/api/retile-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          selectedCells: [...selectedCells].map((cell) => {
            const [x, y, z] = cell.split(',').map(Number);
            return { x, y, z };
          }),
          styles: selectedStyles,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(userFacingErrorMessage(data, 'Could not retile this selection.'));
      setRetileCandidates(data.candidates ?? []);
    } catch (err) {
      setRetileError(err instanceof Error ? err.message : 'Could not retile this selection.');
    } finally {
      setRetileLoading(false);
    }
  }, [changeCount, model, retileLoading, retileStyle, selectedCells, voxelData]);

  const applyRetileCandidate = useCallback((candidate: RetileCandidate) => {
    resetEditState();
    onModelUpdate?.(candidate.model);
  }, [onModelUpdate, resetEditState]);

  const handleVoxelAction = useCallback((gx: number, gy: number, gz: number, shiftKey: boolean) => {
    if (!editMode || !editedGrid) return;

    if (editTool === 'select') {
      const sizeX = editedGrid.length;
      const sizeY = sizeX > 0 ? editedGrid[0].length : 0;
      const sizeZ = sizeY > 0 ? editedGrid[0][0].length : 0;
      if (gx < 0 || gx >= sizeX || gy < 0 || gy >= sizeY || gz < 0 || gz >= sizeZ) return;
      const currentSymbol = editedGrid[gx][gy][gz];
      if (currentSymbol === '0' || currentSymbol === '*') return;
      const next = new Set<string>();
      if (shiftKey) {
        for (const cell of floodFill(editedGrid, gx, gy, gz)) next.add(cell);
      } else {
        next.add(`${gx},${gy},${gz}`);
      }
      setSelectedCells(next);
      setRetileCandidates([]);
      setRetileError(null);
      return;
    }

    if (editTool === 'paint') {
      if (!selectedColor) return;
      const sizeX = editedGrid.length;
      const sizeY = sizeX > 0 ? editedGrid[0].length : 0;
      const sizeZ = sizeY > 0 ? editedGrid[0][0].length : 0;
      if (gx < 0 || gx >= sizeX || gy < 0 || gy >= sizeY || gz < 0 || gz >= sizeZ) return;

      const currentSymbol = editedGrid[gx][gy][gz];
      if (currentSymbol === '0' || currentSymbol === '*') return;

      const newSymbol = HEX_TO_SYMBOL.get(selectedColor);
      if (!newSymbol || currentSymbol === newSymbol) return;

      const positionsToUpdate = new Set<string>();
      if (shiftKey) {
        for (const key of floodFill(editedGrid, gx, gy, gz)) positionsToUpdate.add(key);
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
      return;
    }

    if (editTool === 'add') {
      if (!selectedColor) return;
      const newSymbol = HEX_TO_SYMBOL.get(selectedColor);
      if (!newSymbol) return;

      let grid = editedGrid;
      let adjGx = gx;
      let adjGy = gy;
      let adjGz = gz;
      const sizeX = grid.length;
      const sizeY = sizeX > 0 ? grid[0].length : 0;
      const sizeZ = sizeY > 0 ? grid[0][0].length : 0;

      if (gx < 0 || gx >= sizeX || gy < 0 || gy >= sizeY || gz < 0 || gz >= sizeZ) {
        const result = expandGridIfNeeded(grid, gx, gy, gz);
        grid = result.grid;
        adjGx = gx + result.offsetX;
        adjGy = gy + result.offsetY;
        adjGz = gz + result.offsetZ;
        if (result.offsetZ > 0) {
          setActiveLayer((prev) => prev + result.offsetZ);
        }
      } else {
        const currentSymbol = grid[gx][gy][gz];
        if (currentSymbol !== '0' && currentSymbol !== '*') return;
      }

      const newGrid = cloneGrid(grid);
      newGrid[adjGx][adjGy][adjGz] = newSymbol;
      commitGridChange(newGrid);
      return;
    }

    if (editTool === 'erase') {
      const sizeX = editedGrid.length;
      const sizeY = sizeX > 0 ? editedGrid[0].length : 0;
      const sizeZ = sizeY > 0 ? editedGrid[0][0].length : 0;
      if (gx < 0 || gx >= sizeX || gy < 0 || gy >= sizeY || gz < 0 || gz >= sizeZ) return;

      const currentSymbol = editedGrid[gx][gy][gz];
      if (currentSymbol === '0' || currentSymbol === '*') return;

      const newGrid = cloneGrid(editedGrid);
      if (shiftKey) {
        for (const key of floodFill(editedGrid, gx, gy, gz)) {
          const [x, y, z] = key.split(',').map(Number);
          newGrid[x][y][z] = '0';
        }
      } else {
        newGrid[gx][gy][gz] = '0';
      }

      commitGridChange(newGrid);
    }
  }, [commitGridChange, editMode, editTool, editedGrid, selectedColor]);

  const handleBrickClick = useCallback((brick: BrickInstance, shiftKey: boolean) => {
    if (!editMode) return;
    const metadata = brick.metadata;
    if (metadata?.gx == null || metadata?.gy == null || metadata?.gz == null) return;
    handleVoxelAction(metadata.gx, metadata.gz, metadata.gy, shiftKey);
  }, [editMode, handleVoxelAction]);

  const handleGridCellClick = useCallback((gx: number, gy: number, gz: number) => {
    handleVoxelAction(gx, gy, gz, false);
  }, [handleVoxelAction]);

  return {
    editMode,
    editTool,
    setEditTool,
    activeLayer,
    setActiveLayer,
    showAdjacentLayers,
    setShowAdjacentLayers,
    selectedColor,
    setSelectedColor,
    editedGrid,
    changeCount,
    applying,
    editError,
    undo,
    redo,
    undoDisabled: undoStack.length === 0,
    redoDisabled: redoStack.length === 0,
    selectedCells,
    clearSelection: () => {
      setSelectedCells(new Set());
      setRetileCandidates([]);
      setRetileError(null);
    },
    retileStyle,
    setRetileStyle,
    retileCandidates,
    retileLoading,
    retileError,
    retileSelection,
    applyRetileCandidate,
    refImages,
    addReferenceImages: (urls: string[]) => setRefImages((prev) => [...prev, ...urls]),
    removeReferenceImage: (index: number) => setRefImages((prev) => prev.filter((_, i) => i !== index)),
    unstableCells,
    marginalCells,
    canEdit,
    displayModel,
    maxLayer,
    enterEdit,
    cancelEdit: resetEditState,
    applyEdit,
    handleBrickClick,
    handleGridCellClick,
  };
}
