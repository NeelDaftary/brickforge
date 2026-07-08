'use client';

import { useState, useCallback } from 'react';
import type { PipelineStage } from '@/lib/pipeline/types';
import { MESH_UPLOAD_ACCEPT, isSupportedUploadExtension } from '@/lib/pipeline/mesh-formats';
import { FileDropZone } from './shared/FileDropZone';

interface MeshBounds {
  width: number;
  depth: number;
  height: number;
  maxExtent: number;
}

interface MeshUploadProps {
  onResult: (model: unknown) => void;
  onError: (error: string) => void;
  onStageChange: (stage: PipelineStage) => void;
  disabled?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compute voxel size from mesh extent and target studs (rounds UP to nearest 0.01). */
function computeVoxelSize(maxExtent: number, targetStuds: number): number {
  const raw = maxExtent / targetStuds;
  const rounded = Math.ceil(raw * 100) / 100;
  return Math.max(0.02, Math.min(0.5, rounded));
}

const STUD_PRESETS = [
  { label: 'Small', studs: 20, desc: '~20 studs wide' },
  { label: 'Medium', studs: 40, desc: '~40 studs wide' },
  { label: 'Large', studs: 64, desc: '~64 studs wide' },
];

export function MeshUpload({ onResult, onError, onStageChange, disabled }: MeshUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [bounds, setBounds] = useState<MeshBounds | null>(null);
  const [targetStuds, setTargetStuds] = useState(40);
  const [objectName, setObjectName] = useState('');
  const [hollow, setHollow] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isMeasuring, setIsMeasuring] = useState(false);

  const selectFile = useCallback((f: File) => {
    setFile(f);
    setBounds(null);
  }, []);

  const acceptMesh = useCallback((f: File) => isSupportedUploadExtension(f.name), []);

  function clearAll() {
    setFile(null);
    setBounds(null);
    setTargetStuds(40);
    setObjectName('');
    setHollow(false);
  }

  async function handleMeasure() {
    if (!file || isMeasuring) return;

    setIsMeasuring(true);
    try {
      const formData = new FormData();
      formData.append('mesh', file);
      if (objectName.trim()) {
        formData.append('objectName', objectName.trim());
      }

      const res = await fetch('/api/mesh-bounds', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to read mesh dimensions');
      }

      setBounds(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to measure mesh';
      onError(msg);
    } finally {
      setIsMeasuring(false);
    }
  }

  async function handleBuild() {
    if (!file || !bounds || isProcessing) return;

    setIsProcessing(true);
    setIsBuilding(true);

    try {
      onStageChange('uploading');

      const voxelSize = computeVoxelSize(bounds.maxExtent, targetStuds);

      const formData = new FormData();
      formData.append('mesh', file);
      formData.append('voxelSize', String(voxelSize));
      if (objectName.trim()) {
        formData.append('objectName', objectName.trim());
      }
      formData.append('shell', String(hollow));
      formData.append('name', file.name.replace(/\.\w+$/, ''));

      onStageChange('validating');

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Upload processing failed');
      }

      onStageChange('optimizing_bricks');

      onResult(data);
      onStageChange('ready');
      clearAll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      onError(msg);
      onStageChange('error');
    } finally {
      setIsProcessing(false);
      setIsBuilding(false);
    }
  }

  const isDisabled = disabled || isProcessing || isMeasuring;

  // Empty state: drop zone
  if (!file) {
    return (
      <FileDropZone
        accept={MESH_UPLOAD_ACCEPT}
        acceptFile={acceptMesh}
        onFile={selectFile}
        disabled={isDisabled}
        label="Drop a mesh file here"
        hint="or click to browse"
        icon={
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#999999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        }
      />
    );
  }

  const voxelSize = bounds ? computeVoxelSize(bounds.maxExtent, targetStuds) : null;
  const estimatedGrid = bounds ? Math.round(bounds.maxExtent / voxelSize!) : null;

  // File selected: show file info + controls
  return (
    <div className="w-full border-2 border-border rounded-card bg-surface p-5 flex flex-col gap-4">
      {/* File info */}
      <div className="flex items-center gap-3 text-sm">
        <span className="font-medium text-[#1A1A1A] flex-1 truncate">
          {file.name}
        </span>
        <span className="text-xs text-[#999999]">
          {formatSize(file.size)}
        </span>
        <button
          onClick={clearAll}
          className="text-xs text-[#999999] hover:text-brick-red transition-colors"
          disabled={isDisabled}
        >
          Remove
        </button>
      </div>

      {/* Object name input */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold text-[#666666] whitespace-nowrap">
          Object Name
        </label>
        <input
          type="text"
          value={objectName}
          onChange={(e) => setObjectName(e.target.value)}
          placeholder="Auto-detect (largest mesh)"
          disabled={isDisabled}
          className="flex-1 px-3 py-1.5 text-xs border border-[#DDDDDD] rounded-md outline-none bg-surface focus:border-brick-red transition-colors placeholder:text-[#BBBBBB]"
        />
      </div>

      {/* Step 1: Measure mesh (if bounds not yet fetched) */}
      {!bounds && (
        <button
          onClick={handleMeasure}
          disabled={isDisabled}
          className="w-full py-3 px-7 text-sm font-bold text-white bg-brick-red rounded-button cursor-pointer transition-all duration-200 tracking-[0.3px] disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98]"
        >
          {isMeasuring ? 'Measuring mesh...' : 'Measure Mesh'}
        </button>
      )}

      {/* Step 2: Size selection + build (after bounds are known) */}
      {bounds && (
        <>
          {/* Target size slider */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <label className="text-xs font-semibold text-[#666666] whitespace-nowrap">
                Build Size
              </label>
              <input
                type="range"
                min={16}
                max={100}
                step={1}
                value={targetStuds}
                onChange={(e) => setTargetStuds(Number(e.target.value))}
                disabled={isDisabled}
                className="flex-1 accent-[#B40000] h-1.5"
              />
              <span className="text-xs font-bold text-[#1A1A1A] w-20 text-right">
                ~{estimatedGrid} studs
              </span>
            </div>

            {/* Preset buttons */}
            <div className="flex gap-2">
              {STUD_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setTargetStuds(p.studs)}
                  disabled={isDisabled}
                  className={`flex-1 py-1.5 text-[10px] font-semibold rounded-md border transition-all ${
                    targetStuds === p.studs
                      ? 'border-brick-red text-brick-red bg-[#FFF5F5]'
                      : 'border-[#DDDDDD] text-[#999999] hover:border-[#BBBBBB]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Computed info */}
            <div className="text-[10px] text-[#999999] flex gap-4">
              <span>Voxel size: {voxelSize!.toFixed(2)}</span>
              <span>Mesh: {bounds.width.toFixed(2)} x {bounds.depth.toFixed(2)} x {bounds.height.toFixed(2)}</span>
            </div>
          </div>

          {/* Hollow toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={hollow}
              onChange={(e) => setHollow(e.target.checked)}
              disabled={isDisabled}
              className="accent-[#B40000] w-3.5 h-3.5"
            />
            <span className="text-xs text-[#666666]">
              Hollow interior
            </span>
            <span className="text-[10px] text-[#BBBBBB]">
              reduces bricks for large builds
            </span>
          </label>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => handleBuild()}
              disabled={isDisabled}
              className="flex-1 py-3 px-7 text-sm font-bold text-white bg-brick-red rounded-button cursor-pointer transition-all duration-200 tracking-[0.3px] disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98]"
            >
              {isBuilding ? 'Building...' : 'Build LEGO Model'}
            </button>
            <button
              onClick={clearAll}
              disabled={isDisabled}
              className="py-3 px-5 text-sm font-medium text-[#666666] bg-surface border-2 border-[#DDDDDD] rounded-button cursor-pointer transition-all duration-200 hover:border-[#999999] disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  );
}
