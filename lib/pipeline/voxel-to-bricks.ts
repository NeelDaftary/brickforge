/**
 * Voxel-to-Bricks: Converts a voxel grid into LEGO BrickInstance[] data.
 *
 * Grid format: grid[x][y][z] where:
 *   x = width  (left-right)
 *   y = depth  (front-back)
 *   z = height (bottom-up)
 *
 * Pipeline:
 *   Phase 0: Shell the grid (remove deep interior voxels)
 *   Phase 0.5: Mark interior wildcards (flexible color for combining)
 *   Phase 1: Grid-partition combiner (Brickr-style with layer offset + below-layer awareness)
 *   Phase 2: Stability refinement (split-remerge)
 *   Phase 3: Convert to Three.js viewer format
 */

import type { BrickInstance, BrickModelData, Vector3 } from '@/lib/engine/types';
import { BRICK_CATALOG } from '@/lib/engine/brick_catalog';
import { refineStability, buildOccupiedSet, type RefinementStats } from '@/lib/pipeline/stability-refiner';

// ─── Brick Sizes ──────────────────────────────────────────────────────────────
// Derived from catalog (brick type only). Sorted by area descending,
// ties broken by squareness (lower aspect ratio preferred).

export const BRICK_SIZES: [number, number][] = (() => {
  const seen = new Set<string>();
  const sizes: [number, number][] = [];
  for (const def of BRICK_CATALOG) {
    if (def.type !== 'brick') continue;
    const w = Math.min(def.width, def.depth);
    const d = Math.max(def.width, def.depth);
    const key = `${w},${d}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sizes.push([w, d]);
  }
  sizes.sort((a, b) => {
    const areaA = a[0] * a[1], areaB = b[0] * b[1];
    if (areaA !== areaB) return areaB - areaA;
    return a[1] / a[0] - b[1] / b[0]; // prefer squarer
  });
  return sizes;
})();

const VALID_BRICK_DIMS = new Set(
  BRICK_SIZES.map(([w, d]) => `${w},${d}`),
);

export function isValidBrickSize(w: number, d: number): boolean {
  const nw = Math.min(w, d), nd = Math.max(w, d);
  return VALID_BRICK_DIMS.has(`${nw},${nd}`);
}

export function brickId(w: number, d: number): string {
  return `b_${Math.min(w, d)}x${Math.max(w, d)}`;
}

/** Wildcard symbol for interior voxels that can match any color. */
const WILDCARD = '*';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VoxelGrid {
  grid: string[][][]; // [x][y][z] — "0" = empty, otherwise color symbol
  colorLegend: Record<string, string>; // symbol -> hex color
  gridSize: number;
}

interface Dims {
  sx: number;
  sy: number;
  sz: number;
}

export interface PlacedBrick {
  x: number;
  y: number;
  z: number;
  w: number;  // extent along x
  d: number;  // extent along y
  color: string; // hex color
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];

function dims(grid: string[][][]): Dims {
  const sx = grid.length;
  const sy = sx > 0 ? grid[0].length : 0;
  const sz = sy > 0 ? grid[0][0].length : 0;
  return { sx, sy, sz };
}

function inBounds(x: number, y: number, z: number, d: Dims): boolean {
  return x >= 0 && x < d.sx && y >= 0 && y < d.sy && z >= 0 && z < d.sz;
}

function voxel(grid: string[][][], x: number, y: number, z: number, d: Dims): string {
  return inBounds(x, y, z, d) ? grid[x][y][z] : '0';
}

function cloneGrid(grid: string[][][]): string[][][] {
  return grid.map((plane) => plane.map((col) => [...col]));
}

// ─── Phase 0: Shell ───────────────────────────────────────────────────────────

const SHELL_THRESHOLD = 15; // don't shell small models
const SHELL_DEPTH = 2;      // keep 2 voxels of shell

function shell(grid: string[][][], d: Dims): string[][][] {
  if (Math.min(d.sx, d.sy, d.sz) <= SHELL_THRESHOLD) return grid;

  // BFS from surface to compute distance from exterior
  const dist: number[][][] = Array.from({ length: d.sx }, () =>
    Array.from({ length: d.sy }, () => new Array(d.sz).fill(Infinity)),
  );

  const queue: [number, number, number][] = [];

  for (let x = 0; x < d.sx; x++) {
    for (let y = 0; y < d.sy; y++) {
      for (let z = 0; z < d.sz; z++) {
        if (grid[x][y][z] === '0') {
          dist[x][y][z] = -1;
          continue;
        }
        for (let i = 0; i < 6; i++) {
          if (voxel(grid, x + DX[i], y + DY[i], z + DZ[i], d) === '0') {
            dist[x][y][z] = 0;
            queue.push([x, y, z]);
            break;
          }
        }
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [cx, cy, cz] = queue[head++];
    const nd = dist[cx][cy][cz] + 1;
    for (let i = 0; i < 6; i++) {
      const nx = cx + DX[i], ny = cy + DY[i], nz = cz + DZ[i];
      if (!inBounds(nx, ny, nz, d) || dist[nx][ny][nz] <= nd) continue;
      dist[nx][ny][nz] = nd;
      queue.push([nx, ny, nz]);
    }
  }

  const out = cloneGrid(grid);
  let removed = 0;
  for (let x = 0; x < d.sx; x++)
    for (let y = 0; y < d.sy; y++)
      for (let z = 0; z < d.sz; z++)
        if (dist[x][y][z] > SHELL_DEPTH) { out[x][y][z] = '0'; removed++; }

  if (removed > 0) console.log(`[shell] Removed ${removed} deep-interior voxels`);
  return out;
}

// ─── Phase 0.5: Interior Wildcards ────────────────────────────────────────────

/**
 * Mark interior voxels as WILDCARD so the greedy combiner can absorb them
 * into any adjacent brick regardless of color.
 *
 * Only the outermost shell of filled voxels (those directly adjacent to
 * exterior void with no filled voxel between them and the outside) keep
 * their color. Everything deeper becomes a wildcard.
 *
 * Exterior voids are empty cells reachable from outside the grid boundary.
 * Internal cavities (sealed voids) are NOT exterior, so voxels next to them
 * also become wildcards.
 *
 * BFS from surface voxels assigns each wildcard its nearest surface color.
 */
function markWildcards(
  grid: string[][][],
  d: Dims,
): { grid: string[][][]; wildcardColors: Map<string, string>; isSurface: boolean[][][] } {
  const out = cloneGrid(grid);

  // Step 1: Find all exterior void cells via BFS from grid boundary empty cells
  const exterior: boolean[][][] = Array.from({ length: d.sx }, () =>
    Array.from({ length: d.sy }, () => new Array(d.sz).fill(false)),
  );
  const voidQueue: [number, number, number][] = [];

  for (let x = 0; x < d.sx; x++) {
    for (let y = 0; y < d.sy; y++) {
      for (let z = 0; z < d.sz; z++) {
        if (grid[x][y][z] !== '0') continue;
        if (x === 0 || x === d.sx - 1 || y === 0 || y === d.sy - 1 || z === 0 || z === d.sz - 1) {
          exterior[x][y][z] = true;
          voidQueue.push([x, y, z]);
        }
      }
    }
  }

  let vHead = 0;
  while (vHead < voidQueue.length) {
    const [cx, cy, cz] = voidQueue[vHead++];
    for (let i = 0; i < 6; i++) {
      const nx = cx + DX[i], ny = cy + DY[i], nz = cz + DZ[i];
      if (!inBounds(nx, ny, nz, d) || exterior[nx][ny][nz] || grid[nx][ny][nz] !== '0') continue;
      exterior[nx][ny][nz] = true;
      voidQueue.push([nx, ny, nz]);
    }
  }

  // Step 2: Only outermost filled voxels keep color.
  // A voxel is "outermost" if it directly borders an exterior void or
  // is out-of-bounds on at least one face. Everything else → wildcard.
  const isSurface: boolean[][][] = Array.from({ length: d.sx }, () =>
    Array.from({ length: d.sy }, () => new Array(d.sz).fill(false)),
  );

  for (let x = 0; x < d.sx; x++) {
    for (let y = 0; y < d.sy; y++) {
      for (let z = 0; z < d.sz; z++) {
        if (grid[x][y][z] === '0') continue;
        for (let i = 0; i < 6; i++) {
          const nx = x + DX[i], ny = y + DY[i], nz = z + DZ[i];
          if (!inBounds(nx, ny, nz, d) || exterior[nx][ny][nz]) {
            isSurface[x][y][z] = true;
            break;
          }
        }
      }
    }
  }

  let count = 0;
  for (let x = 0; x < d.sx; x++) {
    for (let y = 0; y < d.sy; y++) {
      for (let z = 0; z < d.sz; z++) {
        if (grid[x][y][z] === '0') continue;
        if (!isSurface[x][y][z]) { out[x][y][z] = WILDCARD; count++; }
      }
    }
  }

  // BFS from boundary voxels to propagate color to wildcards
  const wildcardColors = new Map<string, string>();
  const visited: boolean[][][] = Array.from({ length: d.sx }, () =>
    Array.from({ length: d.sy }, () => new Array(d.sz).fill(false)),
  );

  const queue: [number, number, number, string][] = [];
  for (let x = 0; x < d.sx; x++)
    for (let y = 0; y < d.sy; y++)
      for (let z = 0; z < d.sz; z++) {
        const sym = out[x][y][z];
        if (sym !== '0' && sym !== WILDCARD) {
          queue.push([x, y, z, sym]);
          visited[x][y][z] = true;
        }
      }

  let head = 0;
  while (head < queue.length) {
    const [cx, cy, cz, color] = queue[head++];
    for (let i = 0; i < 6; i++) {
      const nx = cx + DX[i], ny = cy + DY[i], nz = cz + DZ[i];
      if (!inBounds(nx, ny, nz, d) || visited[nx][ny][nz] || out[nx][ny][nz] !== WILDCARD) continue;
      visited[nx][ny][nz] = true;
      wildcardColors.set(`${nx},${ny},${nz}`, color);
      queue.push([nx, ny, nz, color]);
    }
  }

  if (count > 0) console.log(`[wildcard] Marked ${count} interior voxels as wildcard`);
  return { grid: out, wildcardColors, isSurface };
}

// ─── Phase 1: Brickr-Style Grid-Partition Combiner ────────────────────────────
//
// For each brick size (largest first), try every possible grid-partition offset
// and pick the one that claims the most cells with the best support from below.
// A layer-dependent shift (+ z) ensures adjacent layers never partition
// identically, giving natural interlocking for free.

/**
 * Resolve color symbol at (x, y, z) for wildcard handling.
 */
function resolveColor(
  grid: string[][][], x: number, y: number, z: number,
  colorLegend: Record<string, string>,
  wildcardColors: Map<string, string>,
): string | null {
  const sym = grid[x][y][z];
  if (sym === '0') return null;
  if (sym === WILDCARD) {
    const resolved = wildcardColors.get(`${x},${y},${z}`) ?? 'G';
    return colorLegend[resolved] || '#A0A5A9';
  }
  return colorLegend[sym] || '#A0A5A9';
}

/**
 * Score a candidate brick set — higher is better.
 *
 * Primary: cell coverage (× 10).
 * Secondary: support-aware bonuses/penalties for z > 0:
 *   - Brick straddles support boundary: +3 (best interlocking)
 *   - Brick fully supported: +1
 *   - Surface voxel that IS supported: +2 per cell
 *   - Surface voxel with ZERO support: -15 per cell (penalty > 1 cell of coverage)
 */
function scoreCandidateSet(
  candidate: PlacedBrick[],
  belowOccupied: ReadonlySet<string>,
  surfaceCells: ReadonlySet<string>,
  z: number,
): number {
  let cellsClaimed = 0;
  let supportScore = 0;

  for (const b of candidate) {
    const total = b.w * b.d;
    cellsClaimed += total;

    if (z === 0) continue; // ground layer — no support scoring

    let supportedCells = 0;
    let surfaceUnsupported = 0;
    let surfaceSupported = 0;

    for (let dx = 0; dx < b.w; dx++) {
      for (let dy = 0; dy < b.d; dy++) {
        const cx = b.x + dx;
        const cy = b.y + dy;
        const hasSupport = belowOccupied.has(`${cx},${cy}`);
        const isSurf = surfaceCells.has(`${cx},${cy},${z}`);

        if (hasSupport) {
          supportedCells++;
          if (isSurf) surfaceSupported++;
        } else if (isSurf) {
          surfaceUnsupported++;
        }
      }
    }

    // Straddling bonus: brick overlaps support boundary — creates interlocking
    if (supportedCells > 0 && supportedCells < total) {
      supportScore += 3;
    } else if (supportedCells === total) {
      supportScore += 1;
    }

    // Surface support: reward supported surface voxels, penalize unsupported
    supportScore += surfaceSupported * 2;
    supportScore -= surfaceUnsupported * 15;
  }

  return cellsClaimed * 10 + supportScore;
}

/**
 * Partition a single layer for a given brick size + offset using the Brickr
 * formula with layer-dependent shift.
 *
 * Groups cells by integer division: gx = floor((x - shiftX) / w).
 * A group is valid if:
 *   - Fully filled (w × d cells, none empty, none already claimed)
 *   - Color-compatible (all non-wildcard cells share the same color)
 */
function partitionForSize(
  grid: string[][][], z: number,
  w: number, dep: number,
  offsetX: number, offsetY: number,
  dm: Dims,
  claimed: ReadonlySet<string>,
  colorLegend: Record<string, string>,
  wildcardColors: Map<string, string>,
): PlacedBrick[] {
  const bricks: PlacedBrick[] = [];

  // Layer-dependent shift: partition grid shifts by z cells in both axes
  const shiftX = (offsetX + z) % w;
  const shiftY = (offsetY + z) % dep;

  // Build groups via integer division
  // Group key → { cells, syms (raw grid symbols) }
  const groups = new Map<string, { cells: [number, number][]; syms: string[] }>();

  for (let x = 0; x < dm.sx; x++) {
    for (let y = 0; y < dm.sy; y++) {
      if (claimed.has(`${x},${y}`)) continue;
      const cell = grid[x][y][z];
      if (cell === '0') continue;

      // Brickr formula: integer division with layer shift
      // Add large multiple to avoid negative division issues
      const gx = Math.floor((x + w * 1000 - shiftX) / w);
      const gy = Math.floor((y + dep * 1000 - shiftY) / dep);
      const key = `${gx},${gy}`;

      let group = groups.get(key);
      if (!group) { group = { cells: [], syms: [] }; groups.set(key, group); }
      group.cells.push([x, y]);
      group.syms.push(cell);
    }
  }

  // Validate each group
  for (const group of groups.values()) {
    if (group.cells.length !== w * dep) continue; // not fully filled

    // Color check: all non-wildcard cells must share the same color
    let dominantSym: string | null = null;
    let valid = true;

    for (const sym of group.syms) {
      if (sym === WILDCARD) continue;
      if (dominantSym === null) {
        dominantSym = sym;
      } else if (sym !== dominantSym) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    // Resolve color
    if (dominantSym === null) {
      // All wildcards — use the first cell's propagated color
      const [fx, fy] = group.cells[0];
      dominantSym = wildcardColors.get(`${fx},${fy},${z}`) ?? 'G';
    }
    const hex = colorLegend[dominantSym] || '#A0A5A9';

    const minX = Math.min(...group.cells.map(c => c[0]));
    const minY = Math.min(...group.cells.map(c => c[1]));

    bricks.push({ x: minX, y: minY, z, w, d: dep, color: hex });
  }

  return bricks;
}

/**
 * Combine a single layer using Brickr-style grid partitioning with
 * below-layer awareness.
 *
 * For each brick size (largest first), try every offset combination in
 * both orientations. Score each by coverage + support quality. Best wins.
 */
function combineLayer(
  grid: string[][][], z: number,
  colorLegend: Record<string, string>,
  dm: Dims,
  wildcardColors: Map<string, string>,
  belowOccupied: ReadonlySet<string>,
  surfaceCells: ReadonlySet<string>,
): PlacedBrick[] {
  const allBricks: PlacedBrick[] = [];
  const claimed = new Set<string>();

  for (const [bw, bd] of BRICK_SIZES) {
    if (bw === 1 && bd === 1) continue; // 1x1 handled as fallback

    const orientations: [number, number][] = [[bw, bd]];
    if (bw !== bd) orientations.push([bd, bw]);

    let bestBricks: PlacedBrick[] = [];
    let bestScore = -Infinity;

    for (const [w, dep] of orientations) {
      for (let ox = 0; ox < w; ox++) {
        for (let oy = 0; oy < dep; oy++) {
          const candidate = partitionForSize(
            grid, z, w, dep, ox, oy, dm, claimed, colorLegend, wildcardColors,
          );
          if (candidate.length === 0) continue;

          const score = scoreCandidateSet(candidate, belowOccupied, surfaceCells, z);
          if (score > bestScore) {
            bestScore = score;
            bestBricks = candidate;
          }
        }
      }
    }

    if (bestBricks.length > 0) {
      for (const b of bestBricks) {
        for (let dx = 0; dx < b.w; dx++)
          for (let dy = 0; dy < b.d; dy++)
            claimed.add(`${b.x + dx},${b.y + dy}`);
        allBricks.push(b);
      }
    }
  }

  // Fallback: fill remaining unclaimed cells with 1×1 bricks
  for (let x = 0; x < dm.sx; x++) {
    for (let y = 0; y < dm.sy; y++) {
      if (claimed.has(`${x},${y}`)) continue;
      const hex = resolveColor(grid, x, y, z, colorLegend, wildcardColors);
      if (!hex) continue;
      claimed.add(`${x},${y}`);
      allBricks.push({ x, y, z, w: 1, d: 1, color: hex });
    }
  }

  return allBricks;
}

// ─── Phase 3: Convert to Viewer Format ────────────────────────────────────────

function toBrickInstances(placed: PlacedBrick[], d: Dims): BrickInstance[] {
  const cx = d.sx / 2;
  const cy = d.sy / 2;

  return placed.map((b, i) => ({
    id: `brick-${i}`,
    brickId: brickId(b.w, b.d),
    position: [
      b.x + (b.w / 2 - 0.5) - cx,
      b.z * 3,
      b.y + (b.d / 2 - 0.5) - cy,
    ] as Vector3,
    rotation: 0 as 0 | 90 | 180 | 270,
    studWidth: b.w,
    studDepth: b.d,
    color: b.color,
    step: b.z + 1,
    metadata: { gx: b.x, gy: b.z, gz: b.y, gw: b.w, gd: b.d },
  }));
}

// ─── Internal pipeline stages ────────────────────────────────────────────────

function buildLayers(
  grid: string[][][],
  colorLegend: Record<string, string>,
  gridDims: Dims,
  wildcardColors: Map<string, string>,
  surfaceCells: ReadonlySet<string>,
): PlacedBrick[][] {
  const layers: PlacedBrick[][] = [];
  let belowOccupied: ReadonlySet<string> = new Set<string>();

  for (let z = 0; z < gridDims.sz; z++) {
    const layerBricks = combineLayer(
      grid, z, colorLegend, gridDims, wildcardColors, belowOccupied, surfaceCells,
    );
    layers.push(layerBricks);
    belowOccupied = buildOccupiedSet(layerBricks);
  }

  return layers;
}

function layersToModel(
  layers: PlacedBrick[][],
  gridDims: Dims,
  name: string,
  description: string,
  voxelData: VoxelGrid,
): BrickModelData {
  const allBricks = layers.flat();
  const bricks = toBrickInstances(allBricks, gridDims);

  return {
    name,
    description,
    totalBricks: bricks.length,
    bricks,
    voxelData: { grid: voxelData.grid, colorLegend: voxelData.colorLegend, gridSize: voxelData.gridSize },
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function voxelGridToBrickModel(
  voxelData: VoxelGrid,
  name: string,
  description: string,
  options: { shell?: boolean; refine?: boolean } = {},
): BrickModelData & { refinementStats?: RefinementStats } {
  const { grid, colorLegend } = voxelData;
  const d = dims(grid);

  console.log(`[pipeline] Grid: [${d.sx}][${d.sy}][${d.sz}]`);

  // Phase 0: Shell
  const shelledGrid = options.shell !== false ? shell(grid, d) : grid;

  // Phase 0.5: Mark interior wildcards
  const { grid: processed, wildcardColors, isSurface } = markWildcards(shelledGrid, d);

  // Build surface cell set for support-aware scoring
  const surfaceCells = new Set<string>();
  let filledCount = 0;
  for (let x = 0; x < d.sx; x++)
    for (let y = 0; y < d.sy; y++)
      for (let z = 0; z < d.sz; z++) {
        if (processed[x][y][z] !== '0') filledCount++;
        if (isSurface[x][y][z]) surfaceCells.add(`${x},${y},${z}`);
      }

  // Phase 1: Grid-partition combiner (Brickr-style with layer offset + support awareness)
  let layers = buildLayers(processed, colorLegend, d, wildcardColors, surfaceCells);

  // Phase 2.5: Stability refinement (split-remerge)
  let refinementStats: RefinementStats | undefined;
  if (options.refine !== false) {
    const { layers: refined, stats } = refineStability(layers);
    layers = refined;
    refinementStats = stats;
    if (stats.regionsFound > 0) {
      console.log(
        `[refiner] ${stats.regionsFound} regions, ${stats.regionsImproved} improved, ` +
        `critical ${stats.criticalBefore}→${stats.criticalAfter}, ` +
        `weak ${stats.weakBefore}→${stats.weakAfter} (${stats.elapsedMs}ms)`,
      );
    }
  }

  const allBricks = layers.flat();
  console.log(`[pipeline] ${filledCount} voxels → ${allBricks.length} bricks (${(filledCount / Math.max(allBricks.length, 1)).toFixed(1)}x compression)`);

  // Phase 3: Convert to viewer format
  const model = layersToModel(layers, d, name, description, voxelData);
  return { ...model, refinementStats };
}
