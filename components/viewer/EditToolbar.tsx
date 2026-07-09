'use client';

import { COLOR_PALETTE } from '@/lib/engine/color-palette';
import type { RetileCandidate, RetileStyle } from '@/lib/pipeline_v2/retile-selection';

export type EditTool = 'select' | 'paint' | 'add' | 'erase';

interface EditToolbarProps {
  editTool: EditTool;
  onSetEditTool: (tool: EditTool) => void;
  activeLayer: number;
  maxLayer: number;
  onSetActiveLayer: (layer: number) => void;
  showAdjacentLayers: boolean;
  onToggleAdjacentLayers: (show: boolean) => void;
  selectedColor: string | null;
  onSelectColor: (hex: string) => void;
  onApply: () => void;
  onCancel: () => void;
  changeCount: number;
  applying?: boolean;
  undoDisabled?: boolean;
  redoDisabled?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  selectionCount?: number;
  onClearSelection?: () => void;
  retileStyle?: RetileStyle;
  onSetRetileStyle?: (style: RetileStyle) => void;
  retileCandidates?: RetileCandidate[];
  retileLoading?: boolean;
  retileError?: string | null;
  onRetileSelection?: () => void;
  onApplyRetileCandidate?: (candidate: RetileCandidate) => void;
}

const HINT_TEXT: Record<EditTool, string> = {
  select: 'Click a brick to select (Shift+click selects connected color)',
  paint: 'Click brick to paint (Shift+click to fill region)',
  add: 'Click empty cell to place brick',
  erase: 'Click brick to remove (Shift+click to erase region)',
};

export function EditToolbar({
  editTool,
  onSetEditTool,
  activeLayer,
  maxLayer,
  onSetActiveLayer,
  showAdjacentLayers,
  onToggleAdjacentLayers,
  selectedColor,
  onSelectColor,
  onApply,
  onCancel,
  changeCount,
  applying = false,
  undoDisabled = true,
  redoDisabled = true,
  onUndo,
  onRedo,
  selectionCount = 0,
  onClearSelection,
  retileStyle = 'balanced',
  onSetRetileStyle,
  retileCandidates = [],
  retileLoading = false,
  retileError = null,
  onRetileSelection,
  onApplyRetileCandidate,
}: EditToolbarProps) {
  const showPalette = editTool === 'paint' || editTool === 'add';
  const showBuildControls = editTool !== 'paint';

  return (
    <div className="px-4 py-3 border-t-2 border-border bg-surface flex flex-col gap-2.5">
      {showBuildControls && (
        <div className="flex flex-wrap items-center gap-1">
          {([
            { tool: 'select' as EditTool, label: 'Select' },
            { tool: 'add' as EditTool, label: 'Add' },
            { tool: 'erase' as EditTool, label: 'Erase' },
          ]).map(({ tool, label }) => (
            <button
              key={tool}
              onClick={() => onSetEditTool(tool)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                editTool === tool
                  ? 'bg-brick-red text-white shadow-toggle-active'
                  : 'text-[#888888] bg-white border border-black/10 hover:bg-black/5'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {showBuildControls && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#888888] uppercase tracking-wider">Layer</span>
          <button
            onClick={() => onSetActiveLayer(Math.max(0, activeLayer - 1))}
            disabled={activeLayer <= 0}
            className="h-6 w-6 rounded border border-[#E0DFD9] text-xs font-bold disabled:opacity-30 hover:bg-black/5"
          >
            ◀
          </button>
          <span className="text-xs font-semibold text-[#1A1A1A] min-w-[80px] text-center">
            {activeLayer + 1} of {maxLayer + 1}
          </span>
          <button
            onClick={() => onSetActiveLayer(Math.min(maxLayer + 1, activeLayer + 1))}
            disabled={activeLayer > maxLayer}
            className="h-6 w-6 rounded border border-[#E0DFD9] text-xs font-bold disabled:opacity-30 hover:bg-black/5"
          >
            ▶
          </button>
          <label className="flex items-center gap-1.5 ml-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showAdjacentLayers}
              onChange={(e) => onToggleAdjacentLayers(e.target.checked)}
              className="w-3.5 h-3.5 accent-brick-red cursor-pointer"
            />
            <span className="text-xs text-[#888888]">Show nearby layers</span>
          </label>
        </div>
      )}

      {/* Hint text */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[#888888] uppercase tracking-wider">
          {HINT_TEXT[editTool]}
        </span>
        <div className="flex items-center gap-2">
          {changeCount > 0 && (
            <span className="text-xs font-medium text-[#666666]">
              Unsaved edits · {changeCount}
            </span>
          )}
          <button
            onClick={onUndo}
            disabled={undoDisabled || applying}
            className="px-2 py-1 text-[11px] font-bold rounded-md border border-[#E0DFD9] text-[#666666] disabled:opacity-35"
          >
            Undo
          </button>
          <button
            onClick={onRedo}
            disabled={redoDisabled || applying}
            className="px-2 py-1 text-[11px] font-bold rounded-md border border-[#E0DFD9] text-[#666666] disabled:opacity-35"
          >
            Redo
          </button>
        </div>
      </div>

      {/* Color palette (shown for paint and add) */}
      {showPalette && (
        <div className="flex flex-wrap gap-1.5">
          {COLOR_PALETTE.map((c) => {
            const isSelected = selectedColor === c.hex;
            return (
              <button
                key={c.symbol}
                title={c.name}
                onClick={() => onSelectColor(c.hex)}
                className="w-7 h-7 rounded-full border-2 transition-all duration-150 hover:scale-110"
                style={{
                  backgroundColor: c.hex,
                  borderColor: isSelected ? '#1A1A1A' : 'transparent',
                  boxShadow: isSelected
                    ? '0 0 0 2px white, 0 0 0 4px #1A1A1A'
                    : 'inset 0 -2px 4px rgba(0,0,0,0.15)',
                }}
              />
            );
          })}
        </div>
      )}

      {editTool === 'select' && (
        <div className="grid gap-2 rounded-lg border border-[#E4E2DA] bg-white px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold text-[#1A1A1A]">
              {selectionCount > 0 ? `${selectionCount} selected cell${selectionCount === 1 ? '' : 's'}` : 'No selection yet'}
            </div>
            <button
              onClick={onClearSelection}
              disabled={selectionCount === 0 || applying}
              className="text-[11px] font-bold text-[#777777] hover:text-brick-red disabled:opacity-35"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={retileStyle}
              onChange={(event) => onSetRetileStyle?.(event.target.value as RetileStyle)}
              className="min-w-[150px] rounded-md border border-[#DDDDDD] bg-white px-2 py-1.5 text-xs font-semibold text-[#555555]"
            >
              <option value="balanced">Balanced</option>
              <option value="fewer_parts">Fewer pieces</option>
              <option value="stronger">Stronger</option>
            </select>
            <button
              onClick={onRetileSelection}
              disabled={selectionCount === 0 || retileLoading || applying}
              className="px-3 py-1.5 text-xs font-bold text-white bg-brick-red rounded-lg disabled:opacity-40"
            >
              {retileLoading ? 'Retiling...' : 'Retile Selection'}
            </button>
          </div>
          {retileError && (
            <div className="text-[11px] leading-snug text-[#B71C1C]">{retileError}</div>
          )}
          {retileCandidates.length > 0 && (
            <div className="grid gap-2">
              {retileCandidates.map((candidate) => (
                <div key={candidate.id} className="rounded-md border border-[#E4E2DA] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-[#1A1A1A]">
                        {candidate.label}
                        {candidate.recommended ? ' · Best start' : ''}
                      </div>
                      <div className="text-[11px] text-[#777777]">{candidate.description}</div>
                    </div>
                    <button
                      onClick={() => onApplyRetileCandidate?.(candidate)}
                      disabled={applying}
                      className="px-3 py-1.5 text-[11px] font-bold rounded-md bg-[#1A1A1A] text-white disabled:opacity-40"
                    >
                      Apply
                    </button>
                  </div>
                  <div className="mt-1 text-[11px] text-[#666666]">
                    Bricks {candidate.metrics.brickCountBefore} → {candidate.metrics.brickCountAfter} · Unsupported {candidate.metrics.unsupportedBefore} → {candidate.metrics.unsupportedAfter}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Apply / Cancel */}
      <div className="flex gap-2">
        <button
          onClick={onApply}
          disabled={changeCount === 0 || applying}
          className="flex-1 py-2 px-4 text-xs font-bold text-white bg-brick-red rounded-button transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
        >
          {applying ? 'Rebuilding...' : 'Apply Changes'}
        </button>
        <button
          onClick={onCancel}
          disabled={applying}
          className="py-2 px-4 text-xs font-bold text-[#888888] bg-surface border-2 border-[#E0DFD9] rounded-button transition-all duration-200 hover:border-[#999999] disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
