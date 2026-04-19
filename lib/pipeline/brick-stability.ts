/**
 * Brick Stability Check — graduated tier warnings for unsupported bricks.
 *
 * Checks each non-ground brick for stud overlap with the layer below.
 * Produces warnings (no auto-fix) that are appended to pipeline diagnostics.
 *
 * Tiers:
 *   Critical  — <25% support, not locked from above (will physically fall)
 *   Weak      — 25-49% support (holds via clutch power but fragile)
 *   Marginal  — <50% support but locked from above (held but structurally poor)
 *   Stable    — ≥50% support (structurally sound)
 */

import type { BrickInstance } from '@/lib/engine/types';
import { classifySupport, type StabilityTier } from './stability-tiers';

interface BrickSupportInfo {
  supportRatio: number;
  tier: StabilityTier;
  supportedStuds: number;
  totalStuds: number;
}

export interface StabilityResult {
  criticalCount: number;    // <25% support, not locked
  weakCount: number;        // 25-49% support
  marginalCount: number;    // <50% but locked from above
  stableCount: number;      // ≥50% support
  warnings: string[];
  brickSupport: Map<string, BrickSupportInfo>;
}

/**
 * Check brick stability by computing support ratios with graduated tiers.
 *
 * For each non-ground brick:
 *   support_ratio = studs overlapping a brick below / total studs
 *   <25% and not locked → critical
 *   25-49% and not locked → weak
 *   <50% but locked from above → marginal
 *   ≥50% → stable
 */
export function checkBrickStability(bricks: BrickInstance[]): StabilityResult {
  const brickSupport = new Map<string, BrickSupportInfo>();

  if (bricks.length === 0) {
    return { criticalCount: 0, weakCount: 0, marginalCount: 0, stableCount: 0, warnings: [], brickSupport };
  }

  // Build spatial lookup: (gx, gy, gz) → brick
  const occupied = new Map<string, BrickInstance>();

  for (const brick of bricks) {
    const gx = brick.metadata?.gx ?? brick.position[0];
    const gy = brick.metadata?.gy ?? brick.position[1];
    const gz = brick.metadata?.gz ?? brick.position[2];
    const gw = brick.metadata?.gw ?? (brick.studWidth ?? 1);
    const gd = brick.metadata?.gd ?? (brick.studDepth ?? 1);

    for (let dx = 0; dx < gw; dx++) {
      for (let dz = 0; dz < gd; dz++) {
        const key = `${gx + dx},${gy},${gz + dz}`;
        occupied.set(key, brick);
      }
    }
  }

  let criticalCount = 0;
  let weakCount = 0;
  let marginalCount = 0;
  let stableCount = 0;

  for (const brick of bricks) {
    const gx = brick.metadata?.gx ?? brick.position[0];
    const gy = brick.metadata?.gy ?? brick.position[1];
    const gz = brick.metadata?.gz ?? brick.position[2];
    const gw = brick.metadata?.gw ?? (brick.studWidth ?? 1);
    const gd = brick.metadata?.gd ?? (brick.studDepth ?? 1);

    // Ground layer bricks are always stable
    if (gy === 0) {
      const info: BrickSupportInfo = {
        supportRatio: 1,
        tier: 'stable',
        supportedStuds: gw * gd,
        totalStuds: gw * gd,
      };
      brickSupport.set(brick.id, info);
      stableCount++;
      continue;
    }

    const totalStuds = gw * gd;
    let supportedStuds = 0;
    let lockedFromAbove = false;

    for (let dx = 0; dx < gw; dx++) {
      for (let dz = 0; dz < gd; dz++) {
        const belowKey = `${gx + dx},${gy - 1},${gz + dz}`;
        if (occupied.has(belowKey)) {
          supportedStuds++;
        }
        const aboveKey = `${gx + dx},${gy + 1},${gz + dz}`;
        if (occupied.has(aboveKey)) {
          lockedFromAbove = true;
        }
      }
    }

    const supportRatio = supportedStuds / totalStuds;
    const tier = classifySupport({ supportRatio, lockedFromAbove, isGround: false });

    if (tier === 'stable') stableCount++;
    else if (tier === 'marginal') marginalCount++;
    else if (tier === 'weak') weakCount++;
    else criticalCount++;

    brickSupport.set(brick.id, { supportRatio, tier, supportedStuds, totalStuds });
  }

  const warnings: string[] = [];
  if (criticalCount > 0) {
    warnings.push(
      `Stability: ${criticalCount} brick${criticalCount === 1 ? '' : 's'} are critical ` +
      `(less than 25% stud support, will likely fall). Add support bricks immediately.`,
    );
  }
  if (weakCount > 0) {
    warnings.push(
      `Stability: ${weakCount} brick${weakCount === 1 ? '' : 's'} are weak ` +
      `(25-49% support, held by clutch power but fragile).`,
    );
  }
  if (marginalCount > 0) {
    warnings.push(
      `Stability: ${marginalCount} brick${marginalCount === 1 ? '' : 's'} have marginal support ` +
      `(held by bricks above but weak support below).`,
    );
  }

  return { criticalCount, weakCount, marginalCount, stableCount, warnings, brickSupport };
}

// ─── Grid-based stability check (for voxel edit mode) ────────────────────────

export interface GridStabilityResult {
  critical: Set<string>;   // "x,y,z" keys — <25% support, not locked
  weak: Set<string>;       // "x,y,z" keys — 25-49% support
  marginal: Set<string>;   // "x,y,z" keys — <50% but locked above
  stable: Set<string>;     // "x,y,z" keys — ≥50% support
}

/**
 * Check stability directly on a voxel grid where z = height.
 *
 * For each filled voxel at z > 0:
 *   - Count direct support: grid[x][y][z-1] filled → 1 point
 *   - Count adjacent support: x±1,y,z-1 and x,y±1,z-1 filled → 0.5 points each
 *   - If total support < 1.0 (equivalent to <50% of direct+neighbor check) → weak
 *   - Weak + locked from above (grid[x][y][z+1] filled) → marginal
 *   - Weak + not locked → check threshold for critical vs weak
 */
export function checkGridStability(grid: string[][][]): GridStabilityResult {
  const sizeX = grid.length;
  const sizeY = sizeX > 0 ? grid[0].length : 0;
  const sizeZ = sizeY > 0 ? grid[0][0].length : 0;

  const critical = new Set<string>();
  const weak = new Set<string>();
  const marginal = new Set<string>();
  const stable = new Set<string>();

  for (let x = 0; x < sizeX; x++) {
    for (let y = 0; y < sizeY; y++) {
      for (let z = 0; z < sizeZ; z++) {
        const sym = grid[x][y][z];
        if (sym === '0' || sym === '*') continue;
        // Ground layer is always stable
        if (z === 0) {
          stable.add(`${x},${y},${z}`);
          continue;
        }

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

        const key = `${x},${y},${z}`;

        if (support >= 1.0) {
          stable.add(key);
        } else {
          // Check if locked from above
          if (isFilled(x, y, z + 1)) {
            marginal.add(key);
          } else if (support >= 0.5) {
            weak.add(key);
          } else {
            critical.add(key);
          }
        }
      }
    }
  }

  return { critical, weak, marginal, stable };
}
