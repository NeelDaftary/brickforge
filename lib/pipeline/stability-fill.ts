/**
 * Stability Gap-Fill — insert 1×1 support bricks under critical/weak overhangs.
 *
 * After the refiner exhausts re-tiling gains, structural gaps remain where no
 * brick exists below an overhang. This module fills those gaps with support
 * columns that cascade downward until they hit existing structure or ground.
 */

import type { PlacedBrick } from './voxel-to-bricks';
import { buildOccupiedSet, classifyBrick } from './stability-refiner';

// ─── Public types ────────────────────────────────────────────────────────────

export interface FillConfig {
  budgetRatio?: number;   // default 0.10 (10% of total cells)
  supportColor?: string;  // default '#A0A5A9'
  fillWeak?: boolean;     // default true
}

export interface FillStats {
  cellsFilled: number;
  columnsBuilt: number;
  budgetUsed: number;     // actual ratio
}

export interface FillResult {
  layers: PlacedBrick[][];
  stats: FillStats;
}

// ─── Gap-fill algorithm ──────────────────────────────────────────────────────

export function fillGaps(
  layers: PlacedBrick[][],
  config?: FillConfig,
): FillResult {
  const budgetRatio = config?.budgetRatio ?? 0.10;
  const supportColor = config?.supportColor ?? '#A0A5A9';
  const fillWeak = config?.fillWeak ?? true;

  // Deep-clone layers
  const result: PlacedBrick[][] = layers.map((l) => l.map((b) => ({ ...b })));

  // Count total cells for budget
  let totalCells = 0;
  for (const layer of result) {
    for (const b of layer) totalCells += b.w * b.d;
  }

  const budget = Math.max(Math.floor(budgetRatio * totalCells), 20);
  let cellsFilled = 0;
  let columnsBuilt = 0;

  // Collect critical + weak bricks sorted worst-first
  const targets: { brick: PlacedBrick; tier: 'critical' | 'weak' }[] = [];

  for (let z = 1; z < result.length; z++) {
    const below = buildOccupiedSet(result[z - 1]);
    const above = z < result.length - 1
      ? buildOccupiedSet(result[z + 1])
      : new Set<string>();

    for (const b of result[z]) {
      const tier = classifyBrick(b, below, above);
      if (tier === 'critical') {
        targets.push({ brick: b, tier });
      } else if (tier === 'weak' && fillWeak) {
        targets.push({ brick: b, tier });
      }
    }
  }

  // Sort: critical first, then weak
  targets.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === 'critical' ? -1 : 1;
    return 0;
  });

  // Process each target brick
  for (const { brick } of targets) {
    if (cellsFilled >= budget) break;

    const z = brick.z;
    if (z === 0) continue;

    // Find empty cells in footprint on layer below
    const belowOccupied = buildOccupiedSet(result[z - 1]);

    for (let dx = 0; dx < brick.w; dx++) {
      for (let dy = 0; dy < brick.d; dy++) {
        if (cellsFilled >= budget) break;

        const cx = brick.x + dx;
        const cy = brick.y + dy;
        const key = `${cx},${cy}`;

        if (belowOccupied.has(key)) continue;

        // Cascade downward until hitting existing structure or ground
        let columnCells = 0;
        for (let lz = z - 1; lz >= 0; lz--) {
          const layerOccupied = buildOccupiedSet(result[lz]);
          if (layerOccupied.has(`${cx},${cy}`)) break;

          // Insert 1×1 support brick
          result[lz].push({
            x: cx, y: cy, z: lz,
            w: 1, d: 1,
            color: supportColor,
          });
          columnCells++;
          cellsFilled++;

          if (cellsFilled >= budget) break;
        }

        if (columnCells > 0) columnsBuilt++;
      }
    }
  }

  return {
    layers: result,
    stats: {
      cellsFilled,
      columnsBuilt,
      budgetUsed: totalCells > 0 ? cellsFilled / totalCells : 0,
    },
  };
}
