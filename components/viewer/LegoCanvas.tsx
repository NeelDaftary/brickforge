'use client';

import { Canvas } from '@react-three/fiber';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { BrickInstance, BrickModelData, Vector3 } from '@/lib/engine/types';
import {
  DIAGNOSTIC_OVERLAY_MODES,
  activeDiagnosticOverlay,
  diagnosticCount,
  diagnosticShortLabel,
  type DiagnosticOverlayMode,
} from '@/lib/pipeline/diagnostic-categories';
import type { GraphDiagnosticBrickIds } from '@/lib/pipeline_v2/brick-graph';
import type { RepairPreview } from '@/lib/pipeline_v2/guided-repair-v2';
import { BrickScene, type ViewMode } from './BrickScene';
import { BuildStepsPanel } from './BuildStepsPanel';
import { EditToolbar } from './EditToolbar';
type TopTab = 'complete' | 'step' | 'repair' | 'paint' | 'build';
import { ReferenceImages } from './ReferenceImages';
import { useVoxelEditor } from './useVoxelEditor';

interface LegoCanvasProps {
  model: BrickModelData;
  diagnosticBrickIds?: Partial<GraphDiagnosticBrickIds>;
  focusedBrickIds?: string[];
  repairPanel?: ReactNode;
  repairPreview?: RepairPreview | null;
  onModelUpdate?: (model: BrickModelData) => void;
}

function getMaxStep(model: BrickModelData): number {
  return model.bricks.reduce((max, b) => Math.max(max, b.step), 1);
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

function previewCellsToBricks(model: BrickModelData, preview?: RepairPreview | null): BrickInstance[] {
  if (!preview?.addedCells.length || !model.voxelData) return [];
  const sx = model.voxelData.grid.length;
  const sy = model.voxelData.grid[0]?.length ?? 0;
  const cx = sx / 2;
  const cy = sy / 2;
  return preview.addedCells.map((cell, index) => ({
    id: `repair-preview-${cell.x}-${cell.y}-${cell.z}-${index}`,
    brickId: 'b_1x1',
    position: [cell.x - cx, cell.z * 3, cell.y - cy] as Vector3,
    rotation: 0,
    studWidth: 1,
    studDepth: 1,
    color: cell.color,
    step: cell.z + 1,
    metadata: { gx: cell.x, gy: cell.z, gz: cell.y, gw: 1, gd: 1, internalSupport: true },
  }));
}

export function LegoCanvas({ model, diagnosticBrickIds, focusedBrickIds, repairPanel, repairPreview, onModelUpdate }: LegoCanvasProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('complete');
  const [repairMode, setRepairMode] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [diagnosticOverlayMode, setDiagnosticOverlayMode] = useState<DiagnosticOverlayMode>('off');
  const activeOverlayMode = activeDiagnosticOverlay(diagnosticOverlayMode, diagnosticBrickIds);
  const maxStep = useMemo(() => getMaxStep(model), [model]);

  // Adaptive camera based on model size
  const extent = useMemo(() => computeModelExtent(model), [model]);
  const camDist = Math.max(14, extent * 1.2);
  const camZoom = Math.max(10, Math.min(45, 600 / extent));
  const camFar = Math.max(200, camDist * 6);
  const editor = useVoxelEditor({ model, onModelUpdate });
  const previewBricks = useMemo(() => previewCellsToBricks(model, repairPreview), [model, repairPreview]);

  const goPrev = () => {
    setRepairMode(false);
    setViewMode('step');
    setCurrentStep((s) => Math.max(1, s - 1));
  };
  const goNext = () => {
    setRepairMode(false);
    setViewMode('step');
    setCurrentStep((s) => Math.min(maxStep, s + 1));
  };

  const cancelEdit = useCallback(() => {
    editor.cancelEdit();
    setViewMode('complete');
  }, [editor]);

  // Derive which top tab is active
  const activeTab: TopTab = editor.editMode
    ? editor.editTool === 'paint' ? 'paint' : 'build'
    : repairMode ? 'repair'
    : viewMode === 'step' ? 'step' : 'complete';

  const handleTabChange = useCallback((tab: TopTab) => {
    if (tab === 'complete' || tab === 'step') {
      if (editor.editMode && editor.changeCount > 0) return; // don't leave edit with unsaved changes
      if (editor.editMode) cancelEdit();
      setRepairMode(false);
      setViewMode(tab);
    } else if (tab === 'repair') {
      if (!repairPanel) return;
      if (editor.editMode && editor.changeCount > 0) return;
      if (editor.editMode) cancelEdit();
      setRepairMode(true);
      setViewMode('complete');
    } else if (tab === 'paint') {
      if (!editor.canEdit) return;
      setRepairMode(false);
      if (editor.editMode) {
        editor.setEditTool('paint');
      } else if (editor.enterEdit('paint')) {
        setViewMode('complete');
      }
    } else if (tab === 'build') {
      if (!editor.canEdit) return;
      setRepairMode(false);
      if (editor.editMode) {
        editor.setEditTool('select');
      } else if (editor.enterEdit('select')) {
        setViewMode('complete');
      }
    }
  }, [cancelEdit, editor, repairPanel]);

  return (
    <div className="w-full rounded-card border-2 border-border bg-surface overflow-hidden lg:flex">
      {editor.editMode && (
        <ReferenceImages
          images={editor.refImages}
          onAdd={editor.addReferenceImages}
          onRemove={editor.removeReferenceImage}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="h-[600px] relative bg-surface-viewer">
          <Canvas
            orthographic
            shadows
            camera={{ position: [camDist, camDist, camDist], zoom: camZoom, near: 1, far: camFar }}
          >
            <color attach="background" args={['#F0EFE9']} />
            <BrickScene
              model={editor.displayModel}
              viewMode={viewMode}
              currentStep={currentStep}
              onBrickClick={editor.editMode ? editor.handleBrickClick : undefined}
              editMode={editor.editMode}
              editGrid={editor.editedGrid}
              editTool={editor.editTool}
              activeLayer={editor.activeLayer}
              selectedColor={editor.selectedColor}
              onGridCellClick={editor.handleGridCellClick}
              showAdjacentLayers={editor.showAdjacentLayers}
              unstableCells={editor.unstableCells}
              marginalCells={editor.marginalCells}
              diagnosticBrickIds={diagnosticBrickIds}
              diagnosticOverlayMode={activeOverlayMode}
              focusedBrickIds={focusedBrickIds}
              previewBricks={previewBricks}
              selectedCells={editor.selectedCells}
            />
          </Canvas>

          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex gap-1 bg-white/90 backdrop-blur px-1 py-1 rounded-xl border border-black/10 shadow-toggle">
            {([
              { tab: 'complete' as TopTab, label: 'Complete' },
              { tab: 'step' as TopTab, label: 'Step' },
              ...(repairPanel ? [
                { tab: 'repair' as TopTab, label: 'Repair' },
              ] : []),
              ...(editor.canEdit ? [
                { tab: 'paint' as TopTab, label: 'Paint' },
                { tab: 'build' as TopTab, label: 'Build' },
              ] : []),
            ]).map(({ tab, label }) => {
              const isActive = activeTab === tab;
              const disabled = editor.editMode && editor.changeCount > 0 && (tab === 'complete' || tab === 'step');
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

          {!editor.editMode && diagnosticBrickIds && (
            <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-1 bg-white/92 backdrop-blur px-2 py-2 rounded-xl border border-black/10 shadow-toggle">
              <span className="px-1.5 text-[10px] font-bold uppercase tracking-[0.8px] text-[#777777]">
                Issues
              </span>
              {DIAGNOSTIC_OVERLAY_MODES.map((mode) => {
                const label = diagnosticShortLabel(mode);
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

        {editor.editMode && (
          <EditToolbar
            editTool={editor.editTool}
            onSetEditTool={editor.setEditTool}
            activeLayer={editor.activeLayer}
            maxLayer={editor.maxLayer}
            onSetActiveLayer={editor.setActiveLayer}
            showAdjacentLayers={editor.showAdjacentLayers}
            onToggleAdjacentLayers={editor.setShowAdjacentLayers}
            selectedColor={editor.selectedColor}
            onSelectColor={editor.setSelectedColor}
            onApply={editor.applyEdit}
            onCancel={cancelEdit}
            changeCount={editor.changeCount}
            applying={editor.applying}
            undoDisabled={editor.undoDisabled}
            redoDisabled={editor.redoDisabled}
            onUndo={editor.undo}
            onRedo={editor.redo}
            selectionCount={editor.selectedCells.size}
            onClearSelection={editor.clearSelection}
            retileStyle={editor.retileStyle}
            onSetRetileStyle={editor.setRetileStyle}
            retileCandidates={editor.retileCandidates}
            retileLoading={editor.retileLoading}
            retileError={editor.retileError ?? editor.editError}
            onRetileSelection={editor.retileSelection}
            onApplyRetileCandidate={editor.applyRetileCandidate}
          />
        )}

        {!editor.editMode && (
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
      {!editor.editMode && (
        repairMode && repairPanel ? (
          <aside className="w-full lg:w-[520px] xl:w-[560px] shrink-0 min-w-0 flex flex-col">
            {repairPanel}
          </aside>
        ) : (
          <BuildStepsPanel model={editor.displayModel} currentStep={currentStep} maxStep={maxStep} onPrev={goPrev} onNext={goNext} />
        )
      )}
    </div>
  );
}
