'use client';

import { useState, useRef, useCallback } from 'react';
import type { PipelineStage } from '@/lib/pipeline/types';

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

export function MeshUpload({ onResult, onError, onStageChange, disabled }: MeshUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [voxelSize, setVoxelSize] = useState(0.06);
  const [objectName, setObjectName] = useState('');
  const [hollow, setHollow] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFile = useCallback((f: File) => {
    if (f.name.toLowerCase().endsWith('.blend')) {
      setFile(f);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) selectFile(f);
  }, [selectFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) selectFile(f);
  }, [selectFile]);

  function clearAll() {
    setFile(null);
    setVoxelSize(0.06);
    setObjectName('');
    setHollow(false);
  }

  async function handleBuild() {
    if (!file || isProcessing) return;

    setIsProcessing(true);

    try {
      onStageChange('uploading');

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
    }
  }

  const isDisabled = disabled || isProcessing;

  // Empty state: drop zone
  if (!file) {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`w-full border-2 border-dashed rounded-card p-8 flex flex-col items-center gap-3 transition-all duration-200 cursor-pointer ${
          isDragOver
            ? 'border-brick-red bg-[#FFF5F5]'
            : 'border-[#DDDDDD] bg-surface hover:border-[#BBBBBB]'
        } ${isDisabled ? 'opacity-50 pointer-events-none' : ''}`}
        onClick={() => inputRef.current?.click()}
      >
        <div className="text-[40px] leading-none">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#999999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div className="text-sm font-semibold text-[#666666]">
          Drop a .blend file here
        </div>
        <div className="text-xs text-[#999999]">
          or click to browse
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".blend"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    );
  }

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

      {/* Voxel size slider */}
      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold text-[#666666] whitespace-nowrap">
          Voxel Size
        </label>
        <input
          type="range"
          min={0.03}
          max={0.2}
          step={0.01}
          value={voxelSize}
          onChange={(e) => setVoxelSize(Number(e.target.value))}
          disabled={isDisabled}
          className="flex-1 accent-[#B40000] h-1.5"
        />
        <span className="text-xs font-bold text-[#1A1A1A] w-10 text-right">{voxelSize.toFixed(2)}</span>
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
          onClick={handleBuild}
          disabled={isDisabled}
          className="flex-1 py-3 px-7 text-sm font-bold text-white bg-brick-red rounded-button cursor-pointer transition-all duration-200 tracking-[0.3px] disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98]"
        >
          {isProcessing ? 'Processing...' : 'Build LEGO Model'}
        </button>
        <button
          onClick={clearAll}
          disabled={isDisabled}
          className="py-3 px-5 text-sm font-medium text-[#666666] bg-surface border-2 border-[#DDDDDD] rounded-button cursor-pointer transition-all duration-200 hover:border-[#999999] disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
