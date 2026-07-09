/**
 * Bed Packer — packs bricks onto print beds with mesh generation.
 *
 * Uses MaxRects bin packing (shared with print-planner) for layout,
 * then attaches generated brick meshes for STL export.
 */

import type { BrickModelData } from '../engine/types';
import { getBrickDef } from '../engine/brick_catalog';
import { getColorName } from '../engine/color-palette';
import { generateBrickMesh } from './brick-geometry';
import { packMaxRectsBest, type PackItem } from './maxrects';
import type { IndexedMesh, PrintConfig, BedBrick, PrintPlate, BedPackingResult } from './types';

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
 * Bricks are laid flat (studs up, +Y) and arranged using MaxRects packing.
 */
export function packBed(model: BrickModelData, options?: BedPackerOptions): BedPackingResult {
  const bedWidth = options?.bedWidth ?? 220;
  const bedDepth = options?.bedDepth ?? 220;
  const gap = options?.gap ?? 2;
  const printConfig: PrintConfig = {
    tolerance: options?.tolerance ?? 0.1,
    cylinderSegments: options?.cylinderSegments ?? 16,
  };

  // Mesh cache (same brickId → same geometry)
  const meshCache = new Map<string, IndexedMesh>();
  function getCachedMesh(brickId: string): IndexedMesh {
    let mesh = meshCache.get(brickId);
    if (!mesh) {
      mesh = generateBrickMesh(brickId, printConfig);
      meshCache.set(brickId, mesh);
    }
    return mesh;
  }

  // Group bricks by color
  const colorGroups = new Map<string, { brickId: string; id: string }[]>();
  for (const brick of model.bricks) {
    const def = getBrickDef(brick.brickId);
    if (!def) continue;
    const color = (brick.color || '#888888').toLowerCase();
    let group = colorGroups.get(color);
    if (!group) { group = []; colorGroups.set(color, group); }
    group.push({ brickId: brick.brickId, id: brick.id });
  }

  const plates: PrintPlate[] = [];
  const tol = printConfig.tolerance;

  for (const [color, bricks] of colorGroups) {
    // Sort by descending footprint area
    const sorted = [...bricks].sort((a, b) => {
      const da = getBrickDef(a.brickId)!;
      const db = getBrickDef(b.brickId)!;
      return (db.width * db.depth) - (da.width * da.depth);
    });

    // Build PackItems
    const entries = sorted.map((b) => {
      const def = getBrickDef(b.brickId)!;
      return {
        brickId: b.brickId,
        w: def.width * STUD_PITCH - 2 * tol,
        d: def.depth * STUD_PITCH - 2 * tol,
        h: def.height * PLATE_HEIGHT + STUD_HEIGHT,
      };
    });

    let pending: PackItem[] = entries.map((e, i) => ({ w: e.w, h: e.d, index: i }));

    while (pending.length > 0) {
      const result = packMaxRectsBest(pending, bedWidth, bedDepth, gap);
      if (result.placed.length === 0) break;

      const bedBricks: BedBrick[] = [];
      let maxX = 0, maxY = 0, maxZ = 0;

      for (const p of result.placed) {
        const entry = entries[p.index];
        bedBricks.push({
          brickId: entry.brickId,
          bedPosition: [p.x, p.y],
          mesh: getCachedMesh(entry.brickId),
          rotated: p.rotated,
        });
        maxX = Math.max(maxX, p.x + (p.rotated ? entry.d : entry.w));
        maxY = Math.max(maxY, entry.h);
        maxZ = Math.max(maxZ, p.y + (p.rotated ? entry.w : entry.d));
      }

      const colorHex = color.startsWith('#') ? color : `#${color}`;
      plates.push({
        color: colorHex,
        colorName: getColorName(colorHex) ?? colorHex,
        bricks: bedBricks,
        bounds: [maxX, maxY, maxZ],
      });

      pending = result.remaining.map(idx => ({ w: entries[idx].w, h: entries[idx].d, index: idx }));
    }
  }

  plates.sort((a, b) => a.colorName.localeCompare(b.colorName));

  return { plates, bedSize: { width: bedWidth, depth: bedDepth } };
}
