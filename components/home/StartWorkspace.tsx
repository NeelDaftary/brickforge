'use client';

import { useRef } from 'react';
import { GenerationProgress } from '@/components/GenerationProgress';
import { ImageMosaic } from '@/components/ImageMosaic';
import { MeshUpload } from '@/components/MeshUpload';
import { SavedBuilds } from '@/components/SavedBuilds';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';
import type { PipelineStage } from '@/lib/pipeline/types';

interface StartWorkspaceProps {
  isWorking: boolean;
  stage: PipelineStage;
  error: string | null;
  savedBuildsRefreshKey: number;
  onLoadBuild: (id: string) => void;
  onResult: (model: GeneratedModel) => void;
  onError: (message: string | null) => void;
  onStageChange: (stage: PipelineStage) => void;
  onReset: () => void;
}

function isGeneratedModel(value: unknown): value is GeneratedModel {
  const data = value as Partial<GeneratedModel>;
  return typeof data.name === 'string' && Array.isArray(data.bricks) && typeof data.totalBricks === 'number';
}

function validateImportedBuild(data: unknown): GeneratedModel {
  if (!isGeneratedModel(data)) {
    throw new Error('Missing required fields: name, bricks, or totalBricks');
  }

  for (const brick of data.bricks) {
    if (!brick.id || !brick.brickId || !brick.position || !brick.color) {
      throw new Error('Each brick must have id, brickId, position, and color');
    }
  }

  return data;
}

export function StartWorkspace({
  isWorking,
  stage,
  error,
  savedBuildsRefreshKey,
  onLoadBuild,
  onResult,
  onError,
  onStageChange,
  onReset,
}: StartWorkspaceProps) {
  const importInputRef = useRef<HTMLInputElement>(null);

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const model = validateImportedBuild(JSON.parse(reader.result as string));
        onResult(model);
        onStageChange('ready');
        onError(null);
      } catch (err) {
        onError(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed: invalid file');
        onStageChange('error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <>
      <SavedBuilds
        onLoadBuild={onLoadBuild}
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
            onResult={(data) => onResult(data as GeneratedModel)}
            onError={(msg) => onError(msg)}
            onStageChange={onStageChange}
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
            onResult={(data) => onResult(data as GeneratedModel)}
            onError={(msg) => onError(msg)}
            onStageChange={onStageChange}
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
            onChange={handleImportFile}
          />
          <button
            onClick={() => importInputRef.current?.click()}
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

      {isWorking && (
        <GenerationProgress stage={stage} />
      )}

      {error && (
        <div className="w-full py-2.5 px-4 bg-[#FFF8E1] border border-[#FFE082] rounded-[10px] text-sm text-[#666666]">
          {error}
          <button
            onClick={onReset}
            className="ml-2 text-brick-red font-semibold hover:underline"
          >
            Try again
          </button>
        </div>
      )}
    </>
  );
}
