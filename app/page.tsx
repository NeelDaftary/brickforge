'use client';

import { useState } from 'react';
import { ResultWorkspace } from '@/components/home/ResultWorkspace';
import { StartWorkspace } from '@/components/home/StartWorkspace';
import { saveBuild, loadBuild } from '@/lib/storage/saved-builds';
import type { PipelineStage } from '@/lib/pipeline/types';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';
import { layoutWarningIsCoveredByHealthPanel } from '@/lib/pipeline/model-diagnostics';

const STUD_COLORS = ['#DB0000', '#0059CF', '#FFD500', '#2DBE2D'];

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

  const isWorking = stage !== 'idle' && stage !== 'ready' && stage !== 'error';
  const visibleWarnings = result?.diagnostics?.warnings?.filter((w) => !layoutWarningIsCoveredByHealthPanel(w)) ?? [];

  function handleReset() {
    setStage('idle');
    setError(null);
    setResult(null);
    setSavedBuildId(null);
    setSaveMessage(null);
  }

  function handleResult(model: GeneratedModel) {
    setResult(model);
    setSavedBuildId(null);
    setSaveMessage(null);
    setError(null);
  }

  function handleSave() {
    if (!result) return;
    const outcome = saveBuild(result, buildSourceLabel(result), savedBuildId ?? undefined);
    if (outcome.ok) {
      setSavedBuildId(outcome.id);
      setSaveMessage('Saved!');
      setSavedBuildsRefreshKey((key) => key + 1);
      setTimeout(() => setSaveMessage(null), 2000);
      return;
    }

    setSaveMessage(outcome.error);
    setTimeout(() => setSaveMessage(null), 5000);
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

  return (
    <main className="min-h-screen bg-surface-bg flex flex-col items-center justify-center px-8 py-12">
      <div className={`w-full flex flex-col items-center gap-7 ${result ? 'max-w-[960px]' : 'max-w-[520px]'}`}>
        <div className="flex items-center gap-3.5">
          <div className="grid grid-cols-2 gap-1">
            {STUD_COLORS.map((color, i) => (
              <div
                key={i}
                className="w-5 h-5 rounded-full"
                style={{
                  backgroundColor: color,
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

        <p className="text-base font-normal text-[#777777] text-center leading-relaxed">
          Upload a mesh or image, inspect build health, and export an editable BrickForge build.
        </p>

        {!result ? (
          <StartWorkspace
            isWorking={isWorking}
            stage={stage}
            error={error}
            savedBuildsRefreshKey={savedBuildsRefreshKey}
            onLoadBuild={handleLoadBuild}
            onResult={handleResult}
            onError={setError}
            onStageChange={setStage}
            onReset={handleReset}
          />
        ) : (
          <ResultWorkspace
            model={result}
            savedBuildId={savedBuildId}
            saveMessage={saveMessage}
            visibleWarnings={visibleWarnings}
            onSave={handleSave}
            onReset={handleReset}
            onModelChange={setResult}
            onSaveMessage={setSaveMessage}
            onError={setError}
          />
        )}
      </div>
    </main>
  );
}
