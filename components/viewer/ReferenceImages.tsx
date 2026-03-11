'use client';

import { useCallback, useState } from 'react';

interface ReferenceImagesProps {
  images: string[];
  onAdd: (dataUrls: string[]) => void;
  onRemove: (index: number) => void;
}

export function ReferenceImages({ images, onAdd, onRemove }: ReferenceImagesProps) {
  const [dragging, setDragging] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const readFiles = useCallback(
    (files: FileList | File[]) => {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;

      const promises = imageFiles.map(
        (file) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          }),
      );

      Promise.all(promises).then(onAdd);
    },
    [onAdd],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      readFiles(e.dataTransfer.files);
    },
    [readFiles],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) readFiles(e.target.files);
      e.target.value = '';
    },
    [readFiles],
  );

  return (
    <div className="w-[220px] shrink-0 border-r-2 border-border bg-surface flex flex-col">
      <div className="px-3 py-2.5 border-b border-border-subtle">
        <span className="text-xs font-semibold text-[#888888] uppercase tracking-wider">
          Reference Images
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {images.map((src, i) => (
          <div key={i} className="relative group">
            <img
              src={src}
              alt={`Reference ${i + 1}`}
              className="w-full rounded-lg border border-border cursor-pointer hover:border-brick-red transition-colors"
              onClick={() => setExpanded(expanded === i ? null : i)}
            />
            <button
              onClick={() => onRemove(i)}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            >
              x
            </button>
          </div>
        ))}

        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center gap-1.5 py-5 px-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
            dragging
              ? 'border-brick-red bg-red-50'
              : 'border-[#D0CFC8] hover:border-[#999999]'
          }`}
        >
          <span className="text-lg leading-none">+</span>
          <span className="text-[10px] font-medium text-[#999999] text-center">
            Drop images or click to upload
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
        </label>
      </div>

      {expanded !== null && images[expanded] && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-8"
          onClick={() => setExpanded(null)}
        >
          <img
            src={images[expanded]}
            alt="Reference enlarged"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
