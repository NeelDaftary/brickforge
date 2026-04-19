/**
 * Mosaic Combiner — merges 1x1 cells into larger plates for 2D LEGO mosaics.
 *
 * Algorithm: per-color greedy, largest-plate-first, multi-pass scan-order.
 *
 * For each color, builds a boolean mask of unclaimed cells, then iterates
 * through plate sizes from largest area to smallest. Every valid placement
 * is claimed immediately. Multiple scan passes with different traversal
 * orders are tried, and the pass producing the fewest total plates wins.
 *
 * This is purpose-built for flat single-layer mosaics — no stability,
 * no layer offsets, no wildcards.
 */

import type { BrickInstance, BrickModelData, Vector3 } from '@/lib/engine/types';
import type { MosaicGrid } from '@/lib/mosaic/image-to-grid';

// ─── Valid plate sizes (from brick catalog), area descending ─────────────────

interface PlateSize {
  w: number;
  d: number;
  area: number;
  id: string; // plate catalog ID e.g. "p_2x4"
}

const PLATE_SIZES: PlateSize[] = [
  { w: 4, d: 4, area: 16, id: 'p_4x4' },
  { w: 2, d: 8, area: 16, id: 'p_2x8' },
  { w: 2, d: 6, area: 12, id: 'p_2x6' },
  { w: 2, d: 4, area: 8,  id: 'p_2x4' },
  { w: 1, d: 8, area: 8,  id: 'p_1x8' },
  { w: 2, d: 3, area: 6,  id: 'p_2x3' },
  { w: 1, d: 6, area: 6,  id: 'p_1x6' },
  { w: 2, d: 2, area: 4,  id: 'p_2x2' },
  { w: 1, d: 4, area: 4,  id: 'p_1x4' },
  { w: 1, d: 3, area: 3,  id: 'p_1x3' },
  { w: 1, d: 2, area: 2,  id: 'p_1x2' },
  // 1x1 handled as fallback
];

// Each size with both orientations pre-expanded
interface OrientedPlate {
  w: number;
  d: number;
  id: string;
}

const ORIENTED_PLATES: OrientedPlate[] = [];
for (const s of PLATE_SIZES) {
  ORIENTED_PLATES.push({ w: s.w, d: s.d, id: s.id });
  if (s.w !== s.d) {
    ORIENTED_PLATES.push({ w: s.d, d: s.w, id: s.id });
  }
}
// Sort by area descending, then prefer squarer
ORIENTED_PLATES.sort((a, b) => {
  const areaA = a.w * a.d, areaB = b.w * b.d;
  if (areaA !== areaB) return areaB - areaA;
  return (a.w > a.d ? a.w / a.d : a.d / a.w) - (b.w > b.d ? b.w / b.d : b.d / b.w);
});

// ─── Core combiner ───────────────────────────────────────────────────────────

interface PlacedPlate {
  x: number;
  y: number;
  w: number;
  d: number;
  color: string; // hex
}

function canPlace(mask: boolean[][], x: number, y: number, w: number, d: number, cols: number, rows: number): boolean {
  if (x + w > cols || y + d > rows) return false;
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < d; dy++) {
      if (!mask[x + dx][y + dy]) return false;
    }
  }
  return true;
}

function markUsed(mask: boolean[][], x: number, y: number, w: number, d: number): void {
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < d; dy++) {
      mask[x + dx][y + dy] = false;
    }
  }
}

type ScanOrder = (cols: number, rows: number) => [number, number][];

/** Generate scan orders for multi-pass jitter */
const SCAN_ORDERS: ScanOrder[] = [
  // Top-left → bottom-right
  (cols, rows) => {
    const out: [number, number][] = [];
    for (let x = 0; x < cols; x++)
      for (let y = 0; y < rows; y++)
        out.push([x, y]);
    return out;
  },
  // Bottom-right → top-left
  (cols, rows) => {
    const out: [number, number][] = [];
    for (let x = cols - 1; x >= 0; x--)
      for (let y = rows - 1; y >= 0; y--)
        out.push([x, y]);
    return out;
  },
  // Row-major (y-first)
  (cols, rows) => {
    const out: [number, number][] = [];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        out.push([x, y]);
    return out;
  },
  // Row-major reversed
  (cols, rows) => {
    const out: [number, number][] = [];
    for (let y = rows - 1; y >= 0; y--)
      for (let x = cols - 1; x >= 0; x--)
        out.push([x, y]);
    return out;
  },
];

function cloneMask(mask: boolean[][]): boolean[][] {
  return mask.map(col => col.slice());
}

/**
 * Run one greedy pass for a single color mask with a given scan order.
 * Returns the placed plates.
 */
function greedyPass(
  mask: boolean[][],
  cols: number,
  rows: number,
  scanOrder: [number, number][],
  color: string,
): PlacedPlate[] {
  const placed: PlacedPlate[] = [];

  // For each plate size (largest first), scan all positions
  for (const plate of ORIENTED_PLATES) {
    for (const [x, y] of scanOrder) {
      if (!mask[x][y]) continue;
      if (canPlace(mask, x, y, plate.w, plate.d, cols, rows)) {
        markUsed(mask, x, y, plate.w, plate.d);
        placed.push({ x, y, w: plate.w, d: plate.d, color });
      }
    }
  }

  // 1x1 fallback for remaining cells
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      if (mask[x][y]) {
        mask[x][y] = false;
        placed.push({ x, y, w: 1, d: 1, color });
      }
    }
  }

  return placed;
}

/**
 * Merge a single color's cells using multi-pass greedy.
 * Tries all scan orders and returns the one with fewest plates.
 */
function mergeColor(
  baseMask: boolean[][],
  cols: number,
  rows: number,
  color: string,
): PlacedPlate[] {
  let bestPlates: PlacedPlate[] | null = null;

  for (const orderFn of SCAN_ORDERS) {
    const mask = cloneMask(baseMask);
    const order = orderFn(cols, rows);
    const plates = greedyPass(mask, cols, rows, order, color);

    if (!bestPlates || plates.length < bestPlates.length) {
      bestPlates = plates;
    }
  }

  return bestPlates!;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface MosaicCombinerResult {
  bricks: BrickInstance[];
  totalBricks: number;
}

/**
 * Combine a mosaic grid into merged plates.
 *
 * @param grid - grid[x][y][0] with color symbols ("0" = empty)
 * @param colorLegend - symbol → hex
 * @param width - grid width (x dimension)
 * @param height - grid height (y dimension)
 */
export function combineMosaic(
  grid: string[][][],
  colorLegend: Record<string, string>,
  width: number,
  height: number,
): MosaicCombinerResult {
  // Group cells by color, building a boolean mask per color
  const colorMasks = new Map<string, { mask: boolean[][]; hex: string }>();

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const sym = grid[x]?.[y]?.[0];
      if (!sym || sym === '0') continue;
      const hex = colorLegend[sym];
      if (!hex) continue;

      let entry = colorMasks.get(sym);
      if (!entry) {
        // Initialize empty mask for this color
        const mask: boolean[][] = [];
        for (let mx = 0; mx < width; mx++) {
          mask[mx] = new Array(height).fill(false);
        }
        entry = { mask, hex };
        colorMasks.set(sym, entry);
      }
      entry.mask[x][y] = true;
    }
  }

  // Merge each color independently
  const allPlates: PlacedPlate[] = [];
  for (const { mask, hex } of colorMasks.values()) {
    const plates = mergeColor(mask, width, height, hex);
    allPlates.push(...plates);
  }

  // Convert to BrickInstance[]
  const cx = width / 2;
  const cy = height / 2;

  const bricks: BrickInstance[] = allPlates.map((p, i) => {
    const w = Math.min(p.w, p.d);
    const d = Math.max(p.w, p.d);
    return {
      id: `mosaic-${i}`,
      brickId: w === 1 && d === 1 ? 'p_1x1' : `p_${w}x${d}`,
      position: [
        p.x + (p.w / 2 - 0.5) - cx,
        0, // single layer, ground level
        p.y + (p.d / 2 - 0.5) - cy,
      ] as Vector3,
      rotation: (p.w > p.d ? 90 : 0) as 0 | 90 | 180 | 270,
      studWidth: p.w,
      studDepth: p.d,
      color: p.color,
      step: 1,
      metadata: { gx: p.x, gy: 0, gz: p.y, gw: p.w, gd: p.d },
    };
  });

  return { bricks, totalBricks: bricks.length };
}

/**
 * Build a BrickModelData from a mosaic grid using the dedicated mosaic combiner.
 * When combine=false, places all 1x1 plates without merging.
 */
export function mosaicGridToModel(
  mosaic: MosaicGrid,
  name: string,
  description: string,
  combine: boolean,
): BrickModelData {
  const { grid, colorLegend, width, height } = mosaic;

  let bricks: BrickInstance[];
  let totalBricks: number;

  if (combine) {
    const result = combineMosaic(grid, colorLegend, width, height);
    bricks = result.bricks;
    totalBricks = result.totalBricks;
  } else {
    // All 1x1 plates, no merging
    const plates: BrickInstance[] = [];
    const cx = width / 2;
    const cy = height / 2;
    let idx = 0;

    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const sym = grid[x]?.[y]?.[0];
        if (!sym || sym === '0') continue;
        const hex = colorLegend[sym];
        if (!hex) continue;

        plates.push({
          id: `mosaic-${idx++}`,
          brickId: 'p_1x1',
          position: [x - cx, 0, y - cy] as Vector3,
          rotation: 0,
          studWidth: 1,
          studDepth: 1,
          color: hex,
          step: 1,
          metadata: { gx: x, gy: 0, gz: y, gw: 1, gd: 1 },
        });
      }
    }

    bricks = plates;
    totalBricks = plates.length;
  }

  const pixelCount = bricks.length > 0 ? width * height : 0;
  const compression = combine && totalBricks > 0
    ? ` (${(pixelCount / totalBricks).toFixed(1)}x compression)`
    : '';
  console.log(`[mosaic] ${width}x${height} = ${pixelCount} pixels → ${totalBricks} plates${compression}`);

  return {
    name,
    description,
    totalBricks,
    bricks,
    voxelData: { grid, colorLegend, gridSize: Math.max(width, height) },
  };
}
