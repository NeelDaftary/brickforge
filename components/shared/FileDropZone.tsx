'use client';

import { type ReactNode, useRef } from 'react';
import { useFileDrop } from './use-file-drop';

interface FileDropZoneProps {
  /** Comma-separated accept string for the <input>, e.g. ".blend" or "image/png,image/jpeg". */
  accept: string;
  /** Runtime predicate for accepting dropped files (validates extension/MIME). */
  acceptFile: (file: File) => boolean;
  onFile: (file: File) => void;
  disabled?: boolean;
  /** Icon element (svg) shown at the top of the dropzone. */
  icon: ReactNode;
  /** Primary label ("Drop a .blend file here"). */
  label: string;
  /** Small hint text below the label. */
  hint: string;
}

export function FileDropZone({ accept, acceptFile, onFile, disabled, icon, label, hint }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { isDragOver, onDrop, onDragOver, onDragLeave } = useFileDrop(onFile, acceptFile);

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`w-full border-2 border-dashed rounded-card p-8 flex flex-col items-center gap-3 transition-all duration-200 cursor-pointer ${
        isDragOver
          ? 'border-brick-red bg-[#FFF5F5]'
          : 'border-[#DDDDDD] bg-surface hover:border-[#BBBBBB]'
      } ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
      onClick={() => inputRef.current?.click()}
    >
      <div className="text-[40px] leading-none">{icon}</div>
      <div className="text-sm font-semibold text-[#666666]">{label}</div>
      <div className="text-xs text-[#999999]">{hint}</div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && acceptFile(f)) onFile(f);
        }}
      />
    </div>
  );
}
