/**
 * MaxRects bin packing — shared core for print-planner and bed-packer.
 *
 * Maintains a list of all maximal free rectangles (overlapping).
 * For each item, finds the best free rect via heuristic (BSSF or BAF),
 * places the item, splits overlapping free rects, prunes contained rects.
 *
 * Reference: Jukka Jylänki, "A Thousand Ways to Pack the Bin" (2010)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PackItem {
  w: number;   // width in mm (including tolerance)
  h: number;   // depth in mm (including tolerance)
  index: number; // original index for mapping back
}

export interface PackedPlacement {
  x: number;
  y: number;
  index: number;
  rotated: boolean;
}

export type Heuristic = 'bssf' | 'baf';

// ─── Core algorithm ──────────────────────────────────────────────────────────

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

function scorePlacement(freeRect: Rect, w: number, h: number, heuristic: Heuristic): [number, number] {
  const leftoverW = freeRect.w - w;
  const leftoverH = freeRect.h - h;

  if (heuristic === 'bssf') {
    // Best Short Side Fit: minimize the shorter leftover side
    return [Math.min(leftoverW, leftoverH), Math.max(leftoverW, leftoverH)];
  }
  // Best Area Fit: minimize wasted area in the free rect
  return [freeRect.w * freeRect.h - w * h, Math.min(leftoverW, leftoverH)];
}

/**
 * Pack items onto a single bin using MaxRects.
 * Returns placements for items that fit, and indices of items that didn't.
 */
export function packMaxRects(
  items: PackItem[],
  binW: number,
  binH: number,
  gap: number,
  heuristic: Heuristic,
): { placed: PackedPlacement[]; remaining: number[] } {
  let freeRects: Rect[] = [{ x: 0, y: 0, w: binW, h: binH }];
  const placed: PackedPlacement[] = [];
  const remaining: number[] = [];

  for (const item of items) {
    const bw = item.w + gap;
    const bh = item.h + gap;

    // Find the best free rect
    let bestScore1 = Infinity;
    let bestScore2 = Infinity;
    let bestX = 0;
    let bestY = 0;
    let bestW = 0;
    let bestH = 0;
    let bestRotated = false;
    let found = false;

    for (const fr of freeRects) {
      // Normal orientation
      if (bw <= fr.w && bh <= fr.h) {
        const [s1, s2] = scorePlacement(fr, bw, bh, heuristic);
        if (s1 < bestScore1 || (s1 === bestScore1 && s2 < bestScore2)) {
          bestScore1 = s1; bestScore2 = s2;
          bestX = fr.x; bestY = fr.y;
          bestW = bw; bestH = bh;
          bestRotated = false;
          found = true;
        }
      }
      // Rotated (only if not square)
      if (bw !== bh && bh <= fr.w && bw <= fr.h) {
        const [s1, s2] = scorePlacement(fr, bh, bw, heuristic);
        if (s1 < bestScore1 || (s1 === bestScore1 && s2 < bestScore2)) {
          bestScore1 = s1; bestScore2 = s2;
          bestX = fr.x; bestY = fr.y;
          bestW = bh; bestH = bw;
          bestRotated = true;
          found = true;
        }
      }
    }

    if (!found) {
      remaining.push(item.index);
      continue;
    }

    placed.push({ x: bestX, y: bestY, index: item.index, rotated: bestRotated });

    // Split free rects overlapping the placed rect
    const placedRect: Rect = { x: bestX, y: bestY, w: bestW, h: bestH };
    const newFreeRects: Rect[] = [];

    for (const fr of freeRects) {
      if (!intersects(fr, placedRect)) {
        newFreeRects.push(fr);
        continue;
      }
      // Left strip
      if (placedRect.x > fr.x)
        newFreeRects.push({ x: fr.x, y: fr.y, w: placedRect.x - fr.x, h: fr.h });
      // Right strip
      if (placedRect.x + placedRect.w < fr.x + fr.w)
        newFreeRects.push({ x: placedRect.x + placedRect.w, y: fr.y, w: (fr.x + fr.w) - (placedRect.x + placedRect.w), h: fr.h });
      // Bottom strip
      if (placedRect.y > fr.y)
        newFreeRects.push({ x: fr.x, y: fr.y, w: fr.w, h: placedRect.y - fr.y });
      // Top strip
      if (placedRect.y + placedRect.h < fr.y + fr.h)
        newFreeRects.push({ x: fr.x, y: placedRect.y + placedRect.h, w: fr.w, h: (fr.y + fr.h) - (placedRect.y + placedRect.h) });
    }

    // Prune contained rects
    freeRects = [];
    for (let i = 0; i < newFreeRects.length; i++) {
      let isContained = false;
      for (let j = 0; j < newFreeRects.length; j++) {
        if (i !== j && contains(newFreeRects[j], newFreeRects[i])) {
          isContained = true;
          break;
        }
      }
      if (!isContained) freeRects.push(newFreeRects[i]);
    }
  }

  return { placed, remaining };
}

/**
 * Try both BSSF and BAF heuristics, return the one that places more area.
 */
export function packMaxRectsBest(
  items: PackItem[],
  binW: number,
  binH: number,
  gap: number,
): { placed: PackedPlacement[]; remaining: number[] } {
  const r1 = packMaxRects([...items], binW, binH, gap, 'bssf');
  const r2 = packMaxRects([...items], binW, binH, gap, 'baf');
  return r1.placed.length >= r2.placed.length ? r1 : r2;
}
