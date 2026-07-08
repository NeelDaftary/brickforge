'use client';

import { useEffect, useRef, useState } from 'react';
import { BuildHealth } from '@/components/BuildHealth';
import { GuidedRepairQueue } from '@/components/GuidedRepairQueue';
import { LegoCanvas } from '@/components/viewer/LegoCanvas';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';
import type { RepairPreview } from '@/lib/pipeline_v2/guided-repair-v2';

interface ResultWorkspaceProps {
  model: GeneratedModel;
  savedBuildId: string | null;
  saveMessage: string | null;
  visibleWarnings: string[];
  onSave: () => void;
  onReset: () => void;
  onModelChange: (model: GeneratedModel) => void;
  onSaveMessage: (message: string | null) => void;
  onError: (message: string) => void;
}

function withoutDiagnostics(model: GeneratedModel): Omit<GeneratedModel, 'diagnostics'> {
  const cleanModel = { ...model };
  delete cleanModel.diagnostics;
  return cleanModel;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function safeFileName(name: string, fallback = 'build'): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_') || fallback;
}

export function ResultWorkspace({
  model,
  savedBuildId,
  saveMessage,
  visibleWarnings,
  onSave,
  onReset,
  onModelChange,
  onSaveMessage,
  onError,
}: ResultWorkspaceProps) {
  const [focusedBrickIds, setFocusedBrickIds] = useState<string[]>([]);
  const [repairPreview, setRepairPreview] = useState<RepairPreview | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportingSTL, setExportingSTL] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showExportMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportMenu]);

  function handleDownloadJson() {
    const cleanModel = withoutDiagnostics(model);
    const blob = new Blob([JSON.stringify(cleanModel, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${safeFileName(model.name, 'build')}.brickforge.json`);
  }

  async function handleExportSTL() {
    const name = window.prompt('Name for your export:', model.name || 'build');
    if (!name) return;

    setShowExportMenu(false);
    setExportingSTL(true);

    try {
      const cleanModel = withoutDiagnostics(model);
      const res = await fetch('/api/export-stl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cleanModel, exportName: name }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Export failed');
      }

      downloadBlob(await res.blob(), `${safeFileName(name)}.zip`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'STL export failed');
    } finally {
      setExportingSTL(false);
    }
  }

  return (
    <>
      <div className="w-full py-2.5 px-4 bg-[#E8F5E9] rounded-lg text-sm font-semibold text-[#2E7D32] text-center">
        Built &quot;{model.name}&quot; — {model.totalBricks} bricks
        {model.diagnostics?.timingMs
          ? ` in ${(model.diagnostics.timingMs / 1000).toFixed(1)}s`
          : ''}
      </div>
      {visibleWarnings.map((warning, i) => (
        <div key={i} className="w-full py-2.5 px-4 bg-[#FFF8E1] border border-[#FFE082] rounded-lg text-sm text-[#CC8800]">
          {warning}
        </div>
      ))}
      <BuildHealth diagnostics={model.diagnostics} />
      <LegoCanvas
        model={model}
        diagnosticBrickIds={model.diagnostics?.layoutIds}
        focusedBrickIds={focusedBrickIds}
        repairPreview={repairPreview}
        repairPanel={(
          <GuidedRepairQueue
            model={model}
            onApply={(newModel) => {
              setRepairPreview(null);
              onModelChange(newModel);
              onSaveMessage('Repair applied. Review the build before saving.');
            }}
            onFocusBrickIds={setFocusedBrickIds}
            onPreview={setRepairPreview}
          />
        )}
        onModelUpdate={(newModel) => {
          onModelChange({ ...model, ...newModel });
        }}
      />
      <div className="w-full flex gap-3">
        <button
          onClick={onSave}
          className="flex-1 py-3 px-7 text-sm font-bold text-white bg-brick-red rounded-button cursor-pointer transition-all duration-200 tracking-[0.2px] hover:brightness-110 active:scale-[0.98]"
        >
          {savedBuildId ? 'Update Saved Build' : 'Save Build'}
        </button>
        <div className="relative" ref={exportMenuRef}>
          <button
            onClick={() => setShowExportMenu(!showExportMenu)}
            disabled={exportingSTL}
            className="py-3 px-5 text-sm font-bold text-[#1A1A1A] bg-surface border-2 border-[#DDDDDD] rounded-button cursor-pointer transition-all duration-200 tracking-[0.2px] hover:border-brick-red disabled:opacity-50 flex items-center gap-1.5"
          >
            {exportingSTL ? 'Exporting...' : 'Export'}
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {showExportMenu && (
            <div className="absolute top-full mt-1 right-0 bg-surface border-2 border-[#DDDDDD] rounded-lg shadow-lg z-50 min-w-[200px] overflow-hidden">
              <button
                onClick={() => { void handleExportSTL(); }}
                className="w-full py-2.5 px-4 text-sm text-left text-[#1A1A1A] hover:bg-[#F5F5F0] transition-colors flex items-center gap-2"
              >
                <span className="font-bold">STL Print Files</span>
                <span className="text-[11px] text-[#999]">.zip</span>
              </button>
              <div className="h-px bg-[#EEEEEE]" />
              <button
                onClick={() => { handleDownloadJson(); setShowExportMenu(false); }}
                className="w-full py-2.5 px-4 text-sm text-left text-[#1A1A1A] hover:bg-[#F5F5F0] transition-colors flex items-center gap-2"
              >
                <span className="font-bold">Build Data</span>
                <span className="text-[11px] text-[#999]">.brickforge.json</span>
              </button>
            </div>
          )}
        </div>
        <button
          onClick={onReset}
          className="flex-1 py-3 px-7 text-sm font-bold text-[#1A1A1A] bg-surface border-2 border-[#DDDDDD] rounded-button cursor-pointer transition-all duration-200 tracking-[0.2px] hover:border-brick-red"
        >
          Start Over
        </button>
      </div>
      {saveMessage && (
        <div className={`w-full py-2 px-4 rounded-lg text-sm font-medium text-center transition-opacity ${
          saveMessage === 'Saved!'
            ? 'bg-[#E8F5E9] text-[#2E7D32]'
            : 'bg-[#FFF8E1] text-[#CC8800] border border-[#FFE082]'
        }`}>
          {saveMessage}
        </div>
      )}
    </>
  );
}
