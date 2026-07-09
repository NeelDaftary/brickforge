'use client';

import { useRef } from 'react';
import { GenerationProgress } from '@/components/GenerationProgress';
import { ImageMosaic } from '@/components/ImageMosaic';
import { MeshUpload } from '@/components/MeshUpload';
import { SavedBuilds } from '@/components/SavedBuilds';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';
import type { PipelineStage } from '@/lib/pipeline/types';

const DEMO_BUILDS = [
  {
    title: 'Starter Block',
    description: 'Clean export path',
    href: '/demos/starter-block.brickforge.json',
  },
  {
    title: 'Little Creature',
    description: 'Try repair + retile',
    href: '/demos/repair-creature.brickforge.json',
  },
  {
    title: 'Color Mosaic',
    description: 'Paint and save',
    href: '/demos/color-mosaic.brickforge.json',
  },
];

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

  async function handleLoadDemo(href: string) {
    try {
      onStageChange('validating');
      const res = await fetch(href);
      if (!res.ok) throw new Error('Demo file could not be loaded');
      const model = validateImportedBuild(await res.json());
      onResult(model);
      onStageChange('ready');
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? `Demo failed: ${err.message}` : 'Demo failed to load');
      onStageChange('error');
    }
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
                Try A Demo
              </h2>
              <p className="text-xs text-[#777777] mt-1">
                Open a polished BrickForge build and test the improvement loop.
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {DEMO_BUILDS.map((demo) => (
              <button
                key={demo.href}
                onClick={() => { void handleLoadDemo(demo.href); }}
                disabled={isWorking}
                className="min-h-[78px] rounded-card border-2 border-border bg-surface px-4 py-3 text-left transition-all hover:border-brick-red disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="text-sm font-extrabold text-[#1A1A1A]">{demo.title}</div>
                <div className="mt-1 text-xs text-[#777777]">{demo.description}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="w-full flex flex-col gap-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-sm font-extrabold uppercase tracking-[1.5px] text-[#1A1A1A]">
                Start From Mesh
              </h2>
              <p className="text-xs text-[#777777] mt-1">
                .blend, .glb, .obj, .stl, or .ply. Organic models may need a larger scale, thicker details, or repair.
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
                JPG, PNG, or WebP. Flat mosaics are the most predictable V1 output.
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
        <div className="w-full rounded-lg border border-[#FFCDD2] bg-[#FFEBEE] px-4 py-3 text-sm text-[#7F1D1D]">
          <div className="text-xs font-bold uppercase tracking-[0.8px]">Needs attention</div>
          <div className="mt-1 leading-snug">{error}</div>
          <button
            onClick={onReset}
            className="mt-2 text-xs font-bold text-brick-red hover:underline"
          >
            Try again
          </button>
        </div>
      )}
    </>
  );
}
