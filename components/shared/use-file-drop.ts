'use client';

import { useCallback, useState } from 'react';

/**
 * Shared drag-and-drop state + handlers for file-picker components.
 *
 * Consumers render their own dropzone UI and wire the returned handlers
 * to the target element. The `accept` predicate filters files by MIME
 * or extension; failing files are ignored silently so the caller can
 * also surface its own error UI.
 */
export interface UseFileDropResult {
  isDragOver: boolean;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
}

export function useFileDrop(onFile: (file: File) => void, accept?: (file: File) => boolean): UseFileDropResult {
  const [isDragOver, setIsDragOver] = useState(false);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f && (!accept || accept(f))) onFile(f);
  }, [onFile, accept]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  return { isDragOver, onDrop, onDragOver, onDragLeave };
}
