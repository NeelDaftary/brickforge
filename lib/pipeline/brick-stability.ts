/**
 * Brick Stability Check — advisory warnings for unsupported bricks.
 *
 * Checks each non-ground brick for stud overlap with the layer below.
 * Produces warnings (no auto-fix) that are appended to pipeline diagnostics.
 */

import type { BrickInstance } from '@/lib/engine/types';

export interface StabilityResult {
  unstableCount: number;
  marginalCount: number;
  warnings: string[];
}

/**
 * Check brick stability by computing support ratios.
 *
 * For each non-ground brick:
 *   support_ratio = studs overlapping a brick below / total studs
 *   < 0.5 and not locked from above → unstable
 *   < 0.5 but locked from above → marginal
 */
export function checkBrickStability(bricks: BrickInstance[]): StabilityResult {
  if (bricks.length === 0) {
    return { unstableCount: 0, marginalCount: 0, warnings: [] };
  }

  // Build spatial lookup: (gx, gy, gz) → brick
  // Use metadata grid coords if available, otherwise derive from position
  const occupied = new Map<string, BrickInstance>();

  for (const brick of bricks) {
    const gx = brick.metadata?.gx ?? brick.position[0];
    const gy = brick.metadata?.gy ?? brick.position[1];
    const gz = brick.metadata?.gz ?? brick.position[2];
    const gw = brick.metadata?.gw ?? (brick.studWidth ?? 1);
    const gd = brick.metadata?.gd ?? (brick.studDepth ?? 1);

    // Mark all studs this brick occupies
    for (let dx = 0; dx < gw; dx++) {
      for (let dz = 0; dz < gd; dz++) {
        const key = `${gx + dx},${gy},${gz + dz}`;
        occupied.set(key, brick);
      }
    }
  }

  let unstableCount = 0;
  let marginalCount = 0;

  for (const brick of bricks) {
    const gx = brick.metadata?.gx ?? brick.position[0];
    const gy = brick.metadata?.gy ?? brick.position[1];
    const gz = brick.metadata?.gz ?? brick.position[2];
    const gw = brick.metadata?.gw ?? (brick.studWidth ?? 1);
    const gd = brick.metadata?.gd ?? (brick.studDepth ?? 1);

    // Ground layer bricks are always stable
    if (gy === 0) continue;

    const totalStuds = gw * gd;
    let supportedStuds = 0;
    let lockedFromAbove = false;

    for (let dx = 0; dx < gw; dx++) {
      for (let dz = 0; dz < gd; dz++) {
        // Check below
        const belowKey = `${gx + dx},${gy - 1},${gz + dz}`;
        if (occupied.has(belowKey)) {
          supportedStuds++;
        }
        // Check above
        const aboveKey = `${gx + dx},${gy + 1},${gz + dz}`;
        if (occupied.has(aboveKey)) {
          lockedFromAbove = true;
        }
      }
    }

    const supportRatio = supportedStuds / totalStuds;
    if (supportRatio < 0.5) {
      if (lockedFromAbove) {
        marginalCount++;
      } else {
        unstableCount++;
      }
    }
  }

  const warnings: string[] = [];
  if (unstableCount > 0) {
    warnings.push(
      `Stability: ${unstableCount} brick${unstableCount === 1 ? '' : 's'} may be unstable ` +
      `(less than 50% stud support from below). Consider adding support bricks.`,
    );
  }
  if (marginalCount > 0) {
    warnings.push(
      `Stability: ${marginalCount} brick${marginalCount === 1 ? '' : 's'} have marginal support ` +
      `(held by bricks above but weak support below).`,
    );
  }

  return { unstableCount, marginalCount, warnings };
}

// ─── Grid-based stability check (for voxel edit mode) ────────────────────────

export interface GridStabilityResult {
  unstable: Set<string>;  // "x,y,z" keys — no support below
  marginal: Set<string>;  // "x,y,z" keys — weak support but locked above
}

/**
 * Check stability directly on a voxel grid where z = height.
 *
 * For each filled voxel at z > 0:
 *   - Count direct support: grid[x][y][z-1] filled → 1 point
 *   - Count adjacent support: x±1,y,z-1 and x,y±1,z-1 filled → 0.5 points each
 *   - If total support < 1.0 (equivalent to <50% of direct+neighbor check) → weak
 *   - Weak + locked from above (grid[x][y][z+1] filled) → marginal
 *   - Weak + not locked → unstable
 */
export function checkGridStability(grid: string[][][]): GridStabilityResult {
  const sizeX = grid.length;
  const sizeY = sizeX > 0 ? grid[0].length : 0;
  const sizeZ = sizeY > 0 ? grid[0][0].length : 0;

  const unstable = new Set<string>();
  const marginal = new Set<string>();

  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        const sym = grid[x][y][z];
        if (sym === '0' || sym === '*') continue;
        // Ground layer is always stable
        if (z === 0) continue;

        const isFilled = (cx: number, cy: number, cz: number) =>
          cx >= 0 && cx < sizeX && cy >= 0 && cy < sizeY && cz >= 0 && cz < sizeZ &&
          grid[cx][cy][cz] !== '0' && grid[cx][cy][cz] !== '*';

        // Direct support below
        const directBelow = isFilled(x, y, z - 1) ? 1 : 0;

        // Adjacent support below (4 neighbors at z-1)
        let adjacentBelow = 0;
        if (isFilled(x - 1, y, z - 1)) adjacentBelow++;
        if (isFilled(x + 1, y, z - 1)) adjacentBelow++;
        if (isFilled(x, y - 1, z - 1)) adjacentBelow++;
        if (isFilled(x, y + 1, z - 1)) adjacentBelow++;

        // Total support: direct counts full, adjacent count half each
        // Max possible = 1 + 4*0.5 = 3. Threshold: < 50% of max(2) = < 1.0
        const support = directBelow + adjacentBelow * 0.5;

        if (support < 1.0) {
          const key = `${x},${y},${z}`;
          // Check if locked from above
          if (isFilled(x, y, z + 1)) {
            marginal.add(key);
          } else {
            unstable.add(key);
          }
        }
      }
    }
  }

  return { unstable, marginal };
}
