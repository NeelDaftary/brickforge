'use client';

import { useState, useRef, useCallback } from 'react';
import type { PipelineStage } from '@/lib/pipeline/types';
import { MeshPreview } from '@/components/MeshPreview';

interface MeshUploadProps {
  onResult: (model: unknown) => void;
  onError: (error: string) => void;
  onStageChange: (stage: PipelineStage) => void;
  disabled?: boolean;
}

interface SelectedFile {
  file: File;
  type: 'mesh' | 'material';
}

const MESH_EXTENSIONS = ['.obj', '.stl', '.ply', '.glb', '.blend'];
const MATERIAL_EXTENSIONS = ['.mtl'];

function classifyFile(file: File): SelectedFile['type'] | null {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (MESH_EXTENSIONS.includes(ext)) return 'mesh';
  if (MATERIAL_EXTENSIONS.includes(ext)) return 'material';
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MeshUpload({ onResult, onError, onStageChange, disabled }: MeshUploadProps) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [voxelSize, setVoxelSize] = useState(0.06);
  const [objectName, setObjectName] = useState('');
  const [hollow, setHollow] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [clientWarnings, setClientWarnings] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasMesh = files.some((f) => f.type === 'mesh');
  const hasMaterial = files.some((f) => f.type === 'material');
  const meshFile = files.find((f) => f.type === 'mesh');
  const isBlend = meshFile?.file.name.toLowerCase().endsWith('.blend') ?? false;

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const newFiles: SelectedFile[] = [];
    const warnings: string[] = [];

    for (const file of Array.from(fileList)) {
      const type = classifyFile(file);
      if (!type) {
        warnings.push(`Skipped "${file.name}" — unsupported format. Use .blend, PLY, GLB, OBJ, STL, or MTL.`);
        continue;
      }
      newFiles.push({ file, type });
    }

    setFiles((prev) => {
      const combined = [...prev];
      for (const nf of newFiles) {
        const idx = combined.findIndex((f) => f.type === nf.type);
        if (idx >= 0) combined[idx] = nf;
        else combined.push(nf);
      }
      return combined;
    });

    if (warnings.length > 0) setClientWarnings(warnings);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
  }, [addFiles]);

  function removeFile(type: SelectedFile['type']) {
    setFiles((prev) => prev.filter((f) => f.type !== type));
    setClientWarnings([]);
  }

  function clearAll() {
    setFiles([]);
    setClientWarnings([]);
    setVoxelSize(0.06);
    setObjectName('');
    setHollow(false);
  }

  async function handleBuild() {
    if (!meshFile || isProcessing) return;

    setIsProcessing(true);
    setClientWarnings([]);

    try {
      onStageChange('uploading');

      const formData = new FormData();
      formData.append('mesh', meshFile.file);
      if (hasMaterial && meshFile.file.name.toLowerCase().endsWith('.obj')) {
        const mtl = files.find((f) => f.type === 'material');
        if (mtl) formData.append('materials', mtl.file);
      }
      formData.append('voxelSize', String(voxelSize));
      if (objectName.trim()) {
        formData.append('objectName', objectName.trim());
      }
      formData.append('shell', String(hollow));
      formData.append('name', meshFile.file.name.replace(/\.\w+$/, ''));

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
  if (files.length === 0) {
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
          Drop .blend or mesh files here
        </div>
        <div className="text-xs text-[#999999]">
          or click to browse — .blend (preferred), .glb, .ply, .obj, .stl
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".blend,.ply,.glb,.obj,.stl,.mtl"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    );
  }

  // Files selected: show file list + mesh preview + controls
  return (
    <div className="w-full border-2 border-border rounded-card bg-surface p-5 flex flex-col gap-4">
      {/* File list */}
      <div className="flex flex-col gap-2">
        {files.map((f) => (
          <div key={f.type} className="flex items-center gap-3 text-sm">
            <span className="text-base leading-none">
              {f.type === 'mesh' ? '🧊' : '🎨'}
            </span>
            <span className="font-medium text-[#1A1A1A] flex-1 truncate">
              {f.file.name}
            </span>
            <span className="text-xs text-[#999999]">
              {formatSize(f.file.size)}
            </span>
            <button
              onClick={() => removeFile(f.type)}
              className="text-xs text-[#999999] hover:text-brick-red transition-colors"
              disabled={isDisabled}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Warnings */}
      {!hasMaterial && hasMesh && meshFile?.file.name.toLowerCase().endsWith('.obj') && (
        <div className="text-xs text-[#CC8800] bg-[#FFF8E1] px-3 py-2 rounded-lg">
          No MTL file — colors will use fallback LEGO palette. For best results, include the .mtl file.
        </div>
      )}
      {clientWarnings.map((w, i) => (
        <div key={i} className="text-xs text-[#CC8800] bg-[#FFF8E1] px-3 py-2 rounded-lg">
          {w}
        </div>
      ))}

      {/* Mesh preview — only shown when a non-.blend mesh file is selected */}
      {meshFile && !isBlend && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-[#666666]">
            Mesh Preview
          </span>
          <MeshPreview file={meshFile.file} />
        </div>
      )}

      {/* Object name input — shown only for .blend files */}
      {isBlend && (
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
      )}

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
          disabled={!hasMesh || isDisabled}
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

      {/* Add more files */}
      <button
        onClick={() => inputRef.current?.click()}
        disabled={isDisabled}
        className="text-xs text-[#999999] hover:text-brick-red transition-colors self-center"
      >
        + Add another file
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".blend,.ply,.glb,.obj,.stl,.mtl"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
    </div>
  );
}
