/**
 * Print Planner — lightweight bed layout without mesh generation.
 *
 * Uses MaxRects bin packing (BSSF + BAF dual-heuristic) via shared maxrects module.
 */

import type { BOMItem } from '../engine/bom-generator';
import { getBrickDef } from '../engine/brick_catalog';
import { packMaxRectsBest, type PackItem } from './maxrects';

// Real LEGO dimensions (mm)
const STUD_PITCH = 8.0;
const PLATE_HEIGHT = 3.2;
const STUD_HEIGHT = 1.8;

export interface PrintBedConfig {
  bedWidth?: number;    // mm, default 220 (Ender 3 / Prusa)
  bedDepth?: number;    // mm, default 220
  gap?: number;         // spacing between bricks in mm, default 2
  tolerance?: number;   // shrink per side in mm, default 0.1
}

export interface PlannedBrick {
  brickId: string;
  displayName: string;
  x: number;           // mm offset on bed
  z: number;           // mm offset on bed
  widthMm: number;
  depthMm: number;
  heightMm: number;
  rotated: boolean;
}

export interface PrintBed {
  bedIndex: number;     // 0-based within this color
  color: string;
  colorName: string;
  bricks: PlannedBrick[];
  brickCount: number;
  usedArea: number;     // mm² actually occupied
  bedArea: number;      // mm² total bed
  utilization: number;  // 0-1
}

export interface PrintPlan {
  beds: PrintBed[];
  totalBeds: number;
  totalBricks: number;
  uniqueParts: number;
  colorSummary: { color: string; colorName: string; beds: number; bricks: number }[];
}

interface BrickEntry {
  brickId: string;
  displayName: string;
  w: number;  // mm footprint (after tolerance)
  d: number;
  h: number;
}

function toBrickEntry(brickId: string, displayName: string, tolerance: number): BrickEntry | null {
  const def = getBrickDef(brickId);
  if (!def) return null;
  return {
    brickId, displayName,
    w: def.width * STUD_PITCH - 2 * tolerance,
    d: def.depth * STUD_PITCH - 2 * tolerance,
    h: def.height * PLATE_HEIGHT + STUD_HEIGHT,
  };
}

/**
 * Plan print beds from BOM items. Groups by color, packs onto beds using
 * MaxRects with dual-heuristic selection.
 */
export function planPrintBeds(bom: BOMItem[], config?: PrintBedConfig): PrintPlan {
  const bedWidth = config?.bedWidth ?? 220;
  const bedDepth = config?.bedDepth ?? 220;
  const gap = config?.gap ?? 2;
  const tolerance = config?.tolerance ?? 0.1;
  const bedArea = bedWidth * bedDepth;

  // Group BOM items by color
  const colorGroups = new Map<string, BOMItem[]>();
  for (const item of bom) {
    const key = item.color.toLowerCase();
    let group = colorGroups.get(key);
    if (!group) { group = []; colorGroups.set(key, group); }
    group.push(item);
  }

  const allBeds: PrintBed[] = [];
  const colorSummary: PrintPlan['colorSummary'] = [];
  let totalBricks = 0;

  for (const [color, items] of colorGroups) {
    const colorName = items[0].colorName;

    // Expand BOM → individual brick entries, sorted by area descending
    const entries: BrickEntry[] = [];
    for (const item of items) {
      const entry = toBrickEntry(item.brickId, item.displayName, tolerance);
      if (!entry) continue;
      for (let i = 0; i < item.count; i++) entries.push(entry);
    }
    entries.sort((a, b) => (b.w * b.d) - (a.w * a.d));

    // Convert to PackItems
    let pending: PackItem[] = entries.map((e, i) => ({ w: e.w, h: e.d, index: i }));
    let bedIndex = 0;

    while (pending.length > 0) {
      const result = packMaxRectsBest(pending, bedWidth, bedDepth, gap);

      if (result.placed.length === 0) break;

      const bricks: PlannedBrick[] = [];
      let usedArea = 0;
      for (const p of result.placed) {
        const entry = entries[p.index];
        bricks.push({
          brickId: entry.brickId,
          displayName: entry.displayName,
          x: p.x, z: p.y,
          widthMm: p.rotated ? entry.d : entry.w,
          depthMm: p.rotated ? entry.w : entry.d,
          heightMm: entry.h,
          rotated: p.rotated,
        });
        usedArea += entry.w * entry.d;
      }

      allBeds.push({
        bedIndex, color, colorName, bricks,
        brickCount: bricks.length, usedArea, bedArea,
        utilization: usedArea / bedArea,
      });

      totalBricks += result.placed.length;
      pending = result.remaining.map(idx => ({ w: entries[idx].w, h: entries[idx].d, index: idx }));
      bedIndex++;
    }

    colorSummary.push({ color, colorName, beds: bedIndex, bricks: entries.length });
  }

  allBeds.sort((a, b) => a.colorName.localeCompare(b.colorName) || a.bedIndex - b.bedIndex);
  colorSummary.sort((a, b) => a.colorName.localeCompare(b.colorName));

  return { beds: allBeds, totalBeds: allBeds.length, totalBricks, uniqueParts: bom.length, colorSummary };
}
