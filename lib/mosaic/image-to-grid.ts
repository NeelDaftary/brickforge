/**
 * Image-to-Mosaic Grid — converts a 2D image into a flat voxel grid
 * suitable for the BrickForge brick optimizer.
 *
 * Runs entirely client-side using Canvas API for image sampling
 * and the existing OKLCH color quantization for LEGO color matching.
 */

import { nearestLegoSymbol, getHexForSymbol } from '@/lib/engine/color-palette';

export interface MosaicGrid {
  /** Voxel grid in [x][y][z] format — z always has 1 layer */
  grid: string[][][];
  /** Symbol → hex mapping (only symbols actually used) */
  colorLegend: Record<string, string>;
  /** Width in studs */
  width: number;
  /** Height in studs */
  height: number;
}

export interface MosaicPreview {
  /** Flat array of hex colors, row-major (width * height) */
  pixels: string[];
  width: number;
  height: number;
}

/**
 * Convert a loaded image to a LEGO mosaic voxel grid.
 *
 * @param img - A loaded HTMLImageElement
 * @param widthStuds - Target width in LEGO studs (height computed from aspect ratio)
 * @returns Grid data ready for POST to /api/voxelize, plus a preview
 */
export function imageToMosaicGrid(
  img: HTMLImageElement,
  widthStuds: number,
): { mosaic: MosaicGrid; preview: MosaicPreview } {
  const aspect = img.naturalHeight / img.naturalWidth;
  const heightStuds = Math.max(1, Math.round(widthStuds * aspect));

  // Draw image to canvas at target stud dimensions (1 pixel = 1 stud)
  const canvas = document.createElement('canvas');
  canvas.width = widthStuds;
  canvas.height = heightStuds;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, widthStuds, heightStuds);

  const imageData = ctx.getImageData(0, 0, widthStuds, heightStuds);
  const pixels = imageData.data; // RGBA, 4 bytes per pixel

  // Build symbol grid and collect preview colors
  const usedSymbols = new Set<string>();
  const previewPixels: string[] = [];

  // grid[x][y][z] — x is column, y is row (top-to-bottom), z is depth (always 1 layer)
  const grid: string[][][] = [];
  for (let x = 0; x < widthStuds; x++) {
    const plane: string[][] = [];
    for (let y = 0; y < heightStuds; y++) {
      const idx = (y * widthStuds + x) * 4;
      const r = pixels[idx] / 255;
      const g = pixels[idx + 1] / 255;
      const b = pixels[idx + 2] / 255;
      const a = pixels[idx + 3] / 255;

      // Treat transparent pixels as empty
      if (a < 0.5) {
        plane.push(['0']);
      } else {
        const symbol = nearestLegoSymbol(r, g, b);
        usedSymbols.add(symbol);
        plane.push([symbol]);
      }
    }
    grid.push(plane);
  }

  // Build preview (row-major for easy rendering)
  for (let y = 0; y < heightStuds; y++) {
    for (let x = 0; x < widthStuds; x++) {
      const symbol = grid[x][y][0];
      previewPixels.push(symbol === '0' ? 'transparent' : getHexForSymbol(symbol));
    }
  }

  // Color legend: only include symbols that appear in the grid
  const colorLegend: Record<string, string> = {};
  for (const sym of usedSymbols) {
    colorLegend[sym] = getHexForSymbol(sym);
  }

  return {
    mosaic: { grid, colorLegend, width: widthStuds, height: heightStuds },
    preview: { pixels: previewPixels, width: widthStuds, height: heightStuds },
  };
}

/**
 * Load an image file into an HTMLImageElement.
 */
export function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
