'use client';

import { COLOR_PALETTE } from '@/lib/engine/color-palette';

export type EditTool = 'paint' | 'add' | 'erase';

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
}

const TOOL_CONFIG: { tool: EditTool; label: string; icon: string }[] = [
  { tool: 'paint', label: 'Paint', icon: '🎨' },
  { tool: 'add', label: 'Add', icon: '➕' },
  { tool: 'erase', label: 'Erase', icon: '🗑' },
];

const HINT_TEXT: Record<EditTool, string> = {
  paint: 'Pick color, click brick (Shift+click to fill region)',
  add: 'Pick color, click empty cell to place brick',
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
}: EditToolbarProps) {
  const showPalette = editTool === 'paint' || editTool === 'add';

  return (
    <div className="px-4 py-3 border-t-2 border-border bg-surface flex flex-col gap-2.5">
      {/* Tool selector */}
      <div className="flex items-center gap-1">
        {TOOL_CONFIG.map(({ tool, label, icon }) => (
          <button
            key={tool}
            onClick={() => onSetEditTool(tool)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              editTool === tool
                ? 'bg-brick-red text-white shadow-toggle-active'
                : 'text-[#888888] bg-white border border-black/10 hover:bg-black/5'
            }`}
          >
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Layer navigation (only for add/erase — paint works across all layers) */}
      {editTool !== 'paint' && (
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
        {changeCount > 0 && (
          <span className="text-xs font-medium text-[#666666]">
            {changeCount} {changeCount === 1 ? 'change' : 'changes'}
          </span>
        )}
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
