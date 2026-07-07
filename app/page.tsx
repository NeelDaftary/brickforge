'use client';

import { useState, useRef, useEffect } from 'react';
import { LegoCanvas } from '@/components/viewer/LegoCanvas';
import { GenerationProgress } from '@/components/GenerationProgress';
import { MeshUpload } from '@/components/MeshUpload';
import { ImageMosaic } from '@/components/ImageMosaic';
import { SavedBuilds } from '@/components/SavedBuilds';
import { BuildHealth } from '@/components/BuildHealth';
import { GuidedRepairQueue } from '@/components/GuidedRepairQueue';
import { saveBuild, loadBuild } from '@/lib/storage/saved-builds';
import type { PipelineStage } from '@/lib/pipeline/types';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';
import { layoutWarningIsCoveredByHealthPanel } from '@/lib/pipeline/model-diagnostics';

const STUD_COLORS = ['#DB0000', '#0059CF', '#FFD500', '#2DBE2D'];

function withoutDiagnostics(model: GeneratedModel): Omit<GeneratedModel, 'diagnostics'> {
  const cleanModel = { ...model };
  delete cleanModel.diagnostics;
  return cleanModel;
}

function buildSourceLabel(model: GeneratedModel): string {
  return model.description || model.name || 'BrickForge build';
}

export default function HomePage() {
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GeneratedModel | null>(null);
  const [savedBuildId, setSavedBuildId] = useState<string | null>(null);
  const [savedBuildsRefreshKey, setSavedBuildsRefreshKey] = useState(0);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [repairFocusBrickIds, setRepairFocusBrickIds] = useState<string[]>([]);

  const isWorking = stage !== 'idle' && stage !== 'ready' && stage !== 'error';
  const visibleWarnings = result?.diagnostics?.warnings?.filter((w) => !layoutWarningIsCoveredByHealthPanel(w)) ?? [];

  function handleReset() {
    setStage('idle');
    setError(null);
    setResult(null);
    setSavedBuildId(null);
    setSaveMessage(null);
  }

  function handleSave() {
    if (!result) return;
    const outcome = saveBuild(result, buildSourceLabel(result), savedBuildId ?? undefined);
    if (outcome.ok) {
      setSavedBuildId(outcome.id);
      setSaveMessage('Saved!');
      setSavedBuildsRefreshKey((k) => k + 1);
      setTimeout(() => setSaveMessage(null), 2000);
    } else {
      setSaveMessage(outcome.error);
      setTimeout(() => setSaveMessage(null), 5000);
    }
  }

  function handleDownloadJson() {
    if (!result) return;
    const cleanModel = withoutDiagnostics(result);
    const blob = new Blob([JSON.stringify(cleanModel, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'build'}.brickforge.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

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

  async function handleExportSTL() {
    if (!result) return;
    const name = window.prompt('Name for your export:', result.name || 'build');
    if (!name) return;

    setShowExportMenu(false);
    setExportingSTL(true);

    try {
      const cleanModel = withoutDiagnostics(result);
      const res = await fetch('/api/export-stl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: cleanModel, exportName: name }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Export failed');
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'STL export failed';
      setError(msg);
    } finally {
      setExportingSTL(false);
    }
  }

  function handleLoadBuild(id: string) {
    const saved = loadBuild(id);
    if (!saved) return;
    setResult(saved.model as GeneratedModel);
    setSavedBuildId(saved.id);
    setStage('ready');
    setError(null);
    setSaveMessage(null);
  }

  // ── Import a .brickforge.json file ──────────────────────────────────────
  const importInputRef = useRef<HTMLInputElement>(null);

  function handleImportJson() {
    importInputRef.current?.click();
  }

  function onImportFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string);

        // Validate top-level fields
        if (typeof data.name !== 'string' || !Array.isArray(data.bricks) || typeof data.totalBricks !== 'number') {
          throw new Error('Missing required fields: name, bricks, or totalBricks');
        }

        // Validate each brick has required fields
        for (const brick of data.bricks) {
          if (!brick.id || !brick.brickId || !brick.position || !brick.color) {
            throw new Error('Each brick must have id, brickId, position, and color');
          }
        }

        setResult(data as GeneratedModel);
        setSavedBuildId(null);
        setStage('ready');
        setError(null);
        setSaveMessage(null);
      } catch (err) {
        setError(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed: invalid file');
        setStage('error');
      }
    };
    reader.readAsText(file);

    // Reset input so the same file can be re-selected
    e.target.value = '';
  }

  return (
    <main className="min-h-screen bg-surface-bg flex flex-col items-center justify-center px-8 py-12">
      <div className={`w-full flex flex-col items-center gap-7 ${result ? 'max-w-[960px]' : 'max-w-[520px]'}`}>
        {/* Logo */}
        <div className="flex items-center gap-3.5">
          <div className="grid grid-cols-2 gap-1">
            {STUD_COLORS.map((c, i) => (
              <div
                key={i}
                className="w-5 h-5 rounded-full"
                style={{
                  backgroundColor: c,
                  boxShadow: 'inset 0 -2px 4px rgba(0,0,0,0.2), 0 1px 2px rgba(0,0,0,0.15)',
                }}
              />
            ))}
          </div>
          <span className="text-[44px] font-extrabold tracking-[-1.5px] text-[#1A1A1A]">
            BrickForge
          </span>
          <span className="text-[11px] font-bold text-white bg-brick-red px-2 py-0.5 rounded-md">
            v3
          </span>
        </div>

        {/* Tagline */}
        <p className="text-base font-normal text-[#777777] text-center leading-relaxed">
          Upload a mesh or image, inspect build health, and export an editable BrickForge build.
        </p>

        {/* Input Section (hidden when viewing result) */}
        {!result && (
          <>
            <SavedBuilds
              onLoadBuild={handleLoadBuild}
              refreshKey={savedBuildsRefreshKey}
            />
            <div className="w-full flex flex-col gap-7">
              <section className="w-full flex flex-col gap-3">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-extrabold uppercase tracking-[1.5px] text-[#1A1A1A]">
                      Start From Mesh
                    </h2>
                    <p className="text-xs text-[#777777] mt-1">
                      .blend, .glb, .obj, .stl, or .ply
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold text-[#777777] bg-surface border border-border rounded-pill px-3 py-1">
                    3D build
                  </span>
                </div>
                <MeshUpload
                  onResult={(data) => {
                    setResult(data as GeneratedModel);
                  }}
                  onError={(msg) => setError(msg)}
                  onStageChange={(s) => setStage(s)}
                  disabled={isWorking}
                />
              </section>

              <section className="w-full flex flex-col gap-3">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-extrabold uppercase tracking-[1.5px] text-[#1A1A1A]">
                      Image Mosaic
                    </h2>
                    <p className="text-xs text-[#777777] mt-1">
                      JPG, PNG, or WebP
                    </p>
                  </div>
                  <span className="text-[11px] font-semibold text-[#777777] bg-surface border border-border rounded-pill px-3 py-1">
                    Flat build
                  </span>
                </div>
                <ImageMosaic
                  onResult={(data) => {
                    setResult(data as GeneratedModel);
                  }}
                  onError={(msg) => setError(msg)}
                  onStageChange={(s) => setStage(s)}
                  disabled={isWorking}
                />
              </section>

              <section className="w-full flex flex-col gap-3 border-t border-[#E0DFD9] pt-6">
                <div>
                  <h2 className="text-sm font-extrabold uppercase tracking-[1.5px] text-[#1A1A1A]">
                    Open Build Data
                  </h2>
                  <p className="text-xs text-[#777777] mt-1">
                    Load a local BrickForge JSON export.
                  </p>
                </div>

                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={onImportFileSelected}
                />
                <button
                  onClick={handleImportJson}
                  disabled={isWorking}
                  className="w-full py-3 px-7 text-sm font-bold text-[#1A1A1A] bg-surface border-2 border-[#DDDDDD] rounded-button cursor-pointer transition-all duration-200 tracking-[0.2px] hover:border-brick-red disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 1v10M8 1L4.5 4.5M8 1l3.5 3.5M2 11v2.5A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Import .brickforge.json
                </button>
              </section>
            </div>

            {/* Progress indicator */}
            {isWorking && (
              <GenerationProgress stage={stage} />
            )}

            {/* Error display */}
            {error && (
              <div className="w-full py-2.5 px-4 bg-[#FFF8E1] border border-[#FFE082] rounded-[10px] text-sm text-[#666666]">
                {error}
                <button
                  onClick={handleReset}
                  className="ml-2 text-brick-red font-semibold hover:underline"
                >
                  Try again
                </button>
              </div>
            )}
          </>
        )}

        {/* Result View */}
        {result && (
          <>
            <div className="w-full py-2.5 px-4 bg-[#E8F5E9] rounded-lg text-sm font-semibold text-[#2E7D32] text-center">
              Built &quot;{result.name}&quot; — {result.totalBricks} bricks
              {result.diagnostics?.timingMs
                ? ` in ${(result.diagnostics.timingMs / 1000).toFixed(1)}s`
                : ''}
            </div>
            {visibleWarnings.map((w, i) => (
              <div key={i} className="w-full py-2.5 px-4 bg-[#FFF8E1] border border-[#FFE082] rounded-lg text-sm text-[#CC8800]">
                {w}
              </div>
            ))}
            <BuildHealth diagnostics={result.diagnostics} />
            <GuidedRepairQueue
              model={result}
              onApply={(newModel) => {
                setResult(newModel);
                setSaveMessage('Repair applied. Review the build before saving.');
              }}
              onFocusBrickIds={setRepairFocusBrickIds}
            />
            <LegoCanvas
              model={result}
              diagnosticBrickIds={result.diagnostics?.layoutIds}
              focusedBrickIds={repairFocusBrickIds}
              onModelUpdate={(newModel) => {
                setResult({ ...result, ...newModel });
              }}
            />
            <div className="w-full flex gap-3">
              <button
                onClick={handleSave}
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
                      onClick={() => { handleExportSTL(); }}
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
                onClick={handleReset}
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
        )}
      </div>
    </main>
  );
}
