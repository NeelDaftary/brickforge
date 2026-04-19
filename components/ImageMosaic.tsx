'use client';

import { useState, useRef, useCallback } from 'react';
import type { PipelineStage } from '@/lib/pipeline/types';
import { imageToMosaicGrid, loadImageFile, type MosaicPreview } from '@/lib/mosaic/image-to-grid';
import { mosaicGridToModel } from '@/lib/mosaic/mosaic-combiner';

interface ImageMosaicProps {
  onResult: (model: unknown) => void;
  onError: (error: string) => void;
  onStageChange: (stage: PipelineStage) => void;
  disabled?: boolean;
}

const STUD_PRESETS = [
  { label: 'Small', studs: 32, desc: '~32 studs wide' },
  { label: 'Medium', studs: 48, desc: '~48 studs wide' },
  { label: 'Large', studs: 64, desc: '~64 studs wide' },
];

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function isAcceptedImage(file: File): boolean {
  return ACCEPTED_TYPES.includes(file.type);
}

export function ImageMosaic({ onResult, onError, onStageChange, disabled }: ImageMosaicProps) {
  const [file, setFile] = useState<File | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [targetStuds, setTargetStuds] = useState(48);
  const [mergePlates, setMergePlates] = useState(true);
  const [preview, setPreview] = useState<MosaicPreview | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const selectFile = useCallback(async (f: File) => {
    if (!isAcceptedImage(f)) return;
    setFile(f);
    setPreview(null);
    try {
      const loaded = await loadImageFile(f);
      setImg(loaded);
      // Generate initial preview
      const { preview: p } = imageToMosaicGrid(loaded, 48);
      setPreview(p);
      drawPreview(p);
    } catch {
      onError('Failed to load image');
    }
  }, [onError]);

  function drawPreview(p: MosaicPreview) {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    canvas.width = p.width;
    canvas.height = p.height;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        const hex = p.pixels[y * p.width + x];
        if (hex === 'transparent') continue;
        ctx.fillStyle = hex;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  function handleStudsChange(studs: number) {
    setTargetStuds(studs);
    if (!img) return;
    const { preview: p } = imageToMosaicGrid(img, studs);
    setPreview(p);
    drawPreview(p);
  }

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
    setImg(null);
    setTargetStuds(48);
    setPreview(null);
  }

  function handleBuild() {
    if (!img || isProcessing) return;

    setIsProcessing(true);
    try {
      onStageChange('voxelizing');

      const { mosaic } = imageToMosaicGrid(img, targetStuds);
      const fileName = file?.name.replace(/\.\w+$/, '') ?? 'mosaic';

      onStageChange('optimizing_bricks');

      // Run the dedicated mosaic combiner client-side
      const model = mosaicGridToModel(
        mosaic,
        `${fileName} Mosaic`,
        `LEGO mosaic — ${mosaic.width}x${mosaic.height} studs`,
        mergePlates,
      );

      onResult(model);
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
  const heightStuds = img ? Math.max(1, Math.round(targetStuds * (img.naturalHeight / img.naturalWidth))) : 0;

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
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>
        <div className="text-sm font-semibold text-[#666666]">
          Drop an image here for a LEGO mosaic
        </div>
        <div className="text-xs text-[#999999]">
          JPG, PNG, or WebP
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    );
  }

  // File selected: show preview + controls
  return (
    <div className="w-full border-2 border-border rounded-card bg-surface p-5 flex flex-col gap-4">
      {/* File info */}
      <div className="flex items-center gap-3 text-sm">
        <span className="font-medium text-[#1A1A1A] flex-1 truncate">
          {file.name}
        </span>
        {img && (
          <span className="text-xs text-[#999999]">
            {img.naturalWidth}x{img.naturalHeight}px
          </span>
        )}
        <button
          onClick={clearAll}
          className="text-xs text-[#999999] hover:text-brick-red transition-colors"
          disabled={isDisabled}
        >
          Remove
        </button>
      </div>

      {/* LEGO color preview */}
      {preview && (
        <div className="flex justify-center">
          <canvas
            ref={previewCanvasRef}
            className="border border-[#EEEEEE] rounded-md"
            style={{
              width: Math.min(400, preview.width * 6),
              height: Math.min(400, preview.height * 6),
              imageRendering: 'pixelated',
            }}
          />
        </div>
      )}

      {/* Size slider */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-[#666666] whitespace-nowrap">
            Mosaic Width
          </label>
          <input
            type="range"
            min={16}
            max={100}
            step={1}
            value={targetStuds}
            onChange={(e) => handleStudsChange(Number(e.target.value))}
            disabled={isDisabled}
            className="flex-1 accent-[#B40000] h-1.5"
          />
          <span className="text-xs font-bold text-[#1A1A1A] w-24 text-right">
            {targetStuds} x {heightStuds}
          </span>
        </div>

        {/* Preset buttons */}
        <div className="flex gap-2">
          {STUD_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => handleStudsChange(p.studs)}
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

        <div className="text-[10px] text-[#999999]">
          {targetStuds * heightStuds} studs total
        </div>
      </div>

      {/* Merge plates toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={mergePlates}
          onChange={(e) => setMergePlates(e.target.checked)}
          disabled={isDisabled}
          className="accent-[#B40000] w-3.5 h-3.5"
        />
        <span className="text-xs text-[#666666]">
          Merge into larger plates
        </span>
        <span className="text-[10px] text-[#BBBBBB]">
          {mergePlates ? 'fewer pieces, lower cost' : '1x1 plates only (LEGO Art style)'}
        </span>
      </label>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleBuild}
          disabled={isDisabled || !img}
          className="flex-1 py-3 px-7 text-sm font-bold text-white bg-brick-red rounded-button cursor-pointer transition-all duration-200 tracking-[0.3px] disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98]"
        >
          {isProcessing ? 'Building Mosaic...' : 'Build Mosaic'}
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
