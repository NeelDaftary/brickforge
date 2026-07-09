'use client';

import Image from 'next/image';
import { useRef } from 'react';
import { GenerationProgress } from '@/components/GenerationProgress';
import { ImageMosaic } from '@/components/ImageMosaic';
import { MeshUpload } from '@/components/MeshUpload';
import { SavedBuilds } from '@/components/SavedBuilds';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';
import type { PipelineStage } from '@/lib/pipeline/types';

const DEMO_BUILDS = [
  {
    title: 'Squirtle',
    href: '/demos/squirtle-repaint.brickforge.json',
    icon: '/demos/icons/squirtle.svg',
  },
  {
    title: 'Charmander',
    href: '/demos/charmander2.brickforge.json',
    icon: '/demos/icons/charmander.svg',
  },
  {
    title: 'Cat',
    href: '/demos/cat.brickforge.json',
    icon: '/demos/icons/cat.svg',
  },
  {
    title: 'Shiba',
    href: '/demos/shiba.brickforge.json',
    icon: '/demos/icons/shiba.svg',
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
                Samples
              </h2>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {DEMO_BUILDS.map((demo) => (
              <button
                key={demo.href}
                onClick={() => { void handleLoadDemo(demo.href); }}
                disabled={isWorking}
                title={demo.title}
                aria-label={`Open ${demo.title} sample`}
                className="aspect-square rounded-card border-2 border-border bg-surface p-2 transition-all hover:border-brick-red hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                <Image
                  src={demo.icon}
                  alt=""
                  width={112}
                  height={112}
                  className="h-full w-full object-contain"
                  draggable={false}
                />
                <span className="sr-only">{demo.title}</span>
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
                Upload a 3D model and convert it into an editable brick build. Use .blend for the best color capture.
              </p>
            </div>
            <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-[#777777] bg-surface border border-border rounded-full px-3 py-1">
              3D model
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
                Turn a flat image into a plate mosaic. Best for logos, pixel art, and simple color studies.
              </p>
            </div>
            <span className="shrink-0 whitespace-nowrap text-[11px] font-semibold text-[#777777] bg-surface border border-border rounded-full px-3 py-1">
              Mosaic
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
              Import Past Builds
            </h2>
            <p className="text-xs text-[#777777] mt-1">
              Load a local BrickForge JSON.
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
