import type { BrickModelData } from '../engine/types';
import { getBrickDef } from '../engine/brick_catalog';
import { getColorName } from '../engine/color-palette';
import { generateBrickMesh } from './brick-geometry';
import type { IndexedMesh, PrintConfig, BedBrick, PrintPlate, BedPackingResult } from './types';

// LEGO dimensions needed for footprint calculation
const STUD_PITCH = 8.0;
const PLATE_HEIGHT = 3.2;
const STUD_HEIGHT = 1.8;

export interface BedPackerOptions {
  bedWidth?: number;         // mm, default 220
  bedDepth?: number;         // mm, default 220
  gap?: number;              // spacing between bricks in mm, default 2
  tolerance?: number;        // passed to PrintConfig, default 0.1
  cylinderSegments?: number; // passed to PrintConfig, default 16
}

/**
 * Pack all bricks in a model onto virtual print beds, one plate per color.
 * Bricks are laid flat (studs up, +Y) and arranged using shelf-packing.
 */
export function packBed(model: BrickModelData, options?: BedPackerOptions): BedPackingResult {
  const bedWidth = options?.bedWidth ?? 220;
  const bedDepth = options?.bedDepth ?? 220;
  const gap = options?.gap ?? 2;
  const printConfig: PrintConfig = {
    tolerance: options?.tolerance ?? 0.1,
    cylinderSegments: options?.cylinderSegments ?? 16,
  };

  // ── Mesh cache (same brickId → same geometry) ──
  const meshCache = new Map<string, IndexedMesh>();

  function getCachedMesh(brickId: string): IndexedMesh {
    let mesh = meshCache.get(brickId);
    if (!mesh) {
      mesh = generateBrickMesh(brickId, printConfig);
      meshCache.set(brickId, mesh);
    }
    return mesh;
  }

  // ── Group bricks by color ──
  const colorGroups = new Map<string, { brickId: string; id: string }[]>();

  for (const brick of model.bricks) {
    const def = getBrickDef(brick.brickId);
    if (!def) continue;

    const color = (brick.color || '#888888').toLowerCase();
    let group = colorGroups.get(color);
    if (!group) {
      group = [];
      colorGroups.set(color, group);
    }
    group.push({ brickId: brick.brickId, id: brick.id });
  }

  // ── Build plates ──
  const plates: PrintPlate[] = [];

  for (const [color, bricks] of colorGroups) {
    // Sub-group by height class for uniform Z within rows
    const heightClasses = new Map<number, { brickId: string; id: string }[]>();
    for (const b of bricks) {
      const def = getBrickDef(b.brickId)!;
      const h = def.height * PLATE_HEIGHT + STUD_HEIGHT; // total printed height
      let cls = heightClasses.get(h);
      if (!cls) {
        cls = [];
        heightClasses.set(h, cls);
      }
      cls.push(b);
    }

    // Sort height classes: tallest first
    const sortedClasses = Array.from(heightClasses.entries()).sort((a, b) => b[0] - a[0]);

    // Flatten, within each class sort by descending footprint area, then by brickId
    const sorted: { brickId: string; id: string }[] = [];
    for (const entry of sortedClasses) {
      const classBricks = entry[1];
      classBricks.sort((a, b) => {
        const da = getBrickDef(a.brickId)!;
        const db = getBrickDef(b.brickId)!;
        const areaA = da.width * da.depth;
        const areaB = db.width * db.depth;
        if (areaA !== areaB) return areaB - areaA; // descending area
        return a.brickId.localeCompare(b.brickId);
      });
      sorted.push(...classBricks);
    }

    // ── Shelf-pack ──
    const bedBricks: BedBrick[] = [];
    let currentX = 0;
    let currentZ = 0;
    let rowMaxDepth = 0; // tallest brick depth in current row
    let maxX = 0;
    let maxY = 0;
    let maxZ = 0;

    for (const b of sorted) {
      const def = getBrickDef(b.brickId)!;
      const tol = printConfig.tolerance;
      const brickW = def.width * STUD_PITCH - 2 * tol;
      const brickD = def.depth * STUD_PITCH - 2 * tol;
      const brickH = def.height * PLATE_HEIGHT + STUD_HEIGHT;

      // Check if brick fits in current row
      if (currentX + brickW > bedWidth) {
        // Start new row
        currentX = 0;
        currentZ += rowMaxDepth + gap;
        rowMaxDepth = 0;
      }

      bedBricks.push({
        brickId: b.brickId,
        bedPosition: [currentX, currentZ],
        mesh: getCachedMesh(b.brickId),
      });

      // Track max bounds (with bed offset)
      maxX = Math.max(maxX, currentX + brickW);
      maxY = Math.max(maxY, brickH);
      maxZ = Math.max(maxZ, currentZ + brickD);

      currentX += brickW + gap;
      rowMaxDepth = Math.max(rowMaxDepth, brickD);
    }

    const colorHex = color.startsWith('#') ? color : `#${color}`;
    plates.push({
      color: colorHex,
      colorName: getColorName(colorHex) ?? 'Unknown',
      bricks: bedBricks,
      bounds: [maxX, maxY, maxZ],
    });
  }

  // Sort plates by color name for deterministic output
  plates.sort((a, b) => a.colorName.localeCompare(b.colorName));

  return {
    plates,
    bedSize: { width: bedWidth, depth: bedDepth },
  };
}
