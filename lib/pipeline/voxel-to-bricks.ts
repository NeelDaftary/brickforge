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
 *   Phase 1: Greedy brick combiner (layer by layer, largest first)
 *   Phase 2: Structural staggering (break aligned seams between layers)
 *   Phase 3: Convert to Three.js viewer format
 */

import type { BrickInstance, BrickModelData, Vector3 } from '@/lib/engine/types';
import { BRICK_CATALOG } from '@/lib/engine/brick_catalog';
import { refineStability, type RefinementStats } from '@/lib/pipeline/stability-refiner';
import { fillGaps, type FillStats } from '@/lib/pipeline/stability-fill';

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
): { grid: string[][][]; wildcardColors: Map<string, string> } {
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
  return { grid: out, wildcardColors };
}

// ─── Phase 1: Greedy Brick Combiner ───────────────────────────────────────────

function fits(
  grid: string[][][], used: Set<string>,
  bx: number, by: number, z: number,
  w: number, d: number,
  symbol: string, dm: Dims,
): boolean {
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < d; dy++) {
      const nx = bx + dx, ny = by + dy;
      if (nx >= dm.sx || ny >= dm.sy) return false;
      if (used.has(`${nx},${ny}`)) return false;
      const cell = grid[nx][ny][z];
      if (cell !== symbol && cell !== WILDCARD) return false;
    }
  }
  return true;
}

function combineLayer(
  grid: string[][][], z: number,
  colorLegend: Record<string, string>,
  d: Dims,
  wildcardColors: Map<string, string>,
): PlacedBrick[] {
  const bricks: PlacedBrick[] = [];
  const used = new Set<string>();

  for (let x = 0; x < d.sx; x++) {
    for (let y = 0; y < d.sy; y++) {
      if (used.has(`${x},${y}`)) continue;
      let sym = grid[x][y][z];
      if (sym === '0') continue;

      // Resolve wildcard to nearest boundary color
      if (sym === WILDCARD) {
        sym = wildcardColors.get(`${x},${y},${z}`) ?? 'G';
      }

      const hex = colorLegend[sym] || '#A0A5A9';
      let placed = false;

      for (const [bw, bd] of BRICK_SIZES) {
        // Try both orientations for non-square bricks
        const orientations: [number, number][] = [[bw, bd]];
        if (bw !== bd) orientations.push([bd, bw]);

        for (const [w, dep] of orientations) {
          if (fits(grid, used, x, y, z, w, dep, sym, d)) {
            for (let dx = 0; dx < w; dx++)
              for (let dy = 0; dy < dep; dy++)
                used.add(`${x + dx},${y + dy}`);
            bricks.push({ x, y, z, w, d: dep, color: hex });
            placed = true;
            break;
          }
        }
        if (placed) break;
      }

      if (!placed) {
        used.add(`${x},${y}`);
        bricks.push({ x, y, z, w: 1, d: 1, color: hex });
      }
    }
  }

  return bricks;
}

// ─── Phase 2: Structural Staggering ───────────────────────────────────────────
//
// Detect seams (brick boundaries) that align between adjacent layers and
// re-split bricks to break the alignment — just like real LEGO building.

function extractSeams(bricks: PlacedBrick[]): Set<string> {
  const seams = new Set<string>();
  for (const b of bricks) {
    const rx = b.x + b.w;
    for (let dy = 0; dy < b.d; dy++) seams.add(`x=${rx},y=${b.y + dy}`);
    const by = b.y + b.d;
    for (let dx = 0; dx < b.w; dx++) seams.add(`y=${by},x=${b.x + dx}`);
  }
  return seams;
}

function staggerLayer(bricks: PlacedBrick[], prevSeams: Set<string>): PlacedBrick[] {
  if (prevSeams.size === 0) return bricks;

  const result: PlacedBrick[] = [];

  for (const b of bricks) {
    // Check X-axis aligned seams
    if (b.w > 1) {
      let splitX = -1;
      for (let sx = b.x + 1; sx < b.x + b.w; sx++) {
        const leftW = sx - b.x;
        const rightW = b.x + b.w - sx;
        // Only split if both pieces are valid LEGO brick sizes
        if (!isValidBrickSize(leftW, b.d) || !isValidBrickSize(rightW, b.d)) continue;
        let count = 0;
        for (let dy = 0; dy < b.d; dy++)
          if (prevSeams.has(`x=${sx},y=${b.y + dy}`)) count++;
        if (count > b.d / 2) { splitX = sx; break; }
      }
      if (splitX > b.x) {
        result.push({ ...b, w: splitX - b.x });
        result.push({ ...b, x: splitX, w: b.x + b.w - splitX });
        continue;
      }
    }

    // Check Y-axis aligned seams
    if (b.d > 1) {
      let splitY = -1;
      for (let sy = b.y + 1; sy < b.y + b.d; sy++) {
        const topD = sy - b.y;
        const bottomD = b.y + b.d - sy;
        // Only split if both pieces are valid LEGO brick sizes
        if (!isValidBrickSize(b.w, topD) || !isValidBrickSize(b.w, bottomD)) continue;
        let count = 0;
        for (let dx = 0; dx < b.w; dx++)
          if (prevSeams.has(`y=${sy},x=${b.x + dx}`)) count++;
        if (count > b.w / 2) { splitY = sy; break; }
      }
      if (splitY > b.y) {
        result.push({ ...b, d: splitY - b.y });
        result.push({ ...b, y: splitY, d: b.y + b.d - splitY });
        continue;
      }
    }

    result.push(b);
  }

  return result;
}

// ─── Phase 3: Convert to Viewer Format ────────────────────────────────────────

let brickCounter = 0;

function toBrickInstances(placed: PlacedBrick[], d: Dims): BrickInstance[] {
  const cx = d.sx / 2;
  const cy = d.sy / 2;

  return placed.map((b) => ({
    id: `brick-${brickCounter++}`,
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
): PlacedBrick[][] {
  const layers: PlacedBrick[][] = [];
  for (let z = 0; z < gridDims.sz; z++) {
    layers.push(combineLayer(grid, z, colorLegend, gridDims, wildcardColors));
  }

  // Phase 2: Structural staggering (two passes, two-layer lookahead)
  let splits = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let z = 1; z < gridDims.sz; z++) {
      if (layers[z].length === 0) continue;
      const seams = extractSeams(layers[z - 1]);
      if (z >= 2 && layers[z - 2].length > 0) {
        for (const s of extractSeams(layers[z - 2])) seams.add(s);
      }
      const before = layers[z].length;
      layers[z] = staggerLayer(layers[z], seams);
      splits += layers[z].length - before;
    }
  }
  if (splits > 0) console.log(`[stagger] Split ${splits} bricks to break aligned seams`);

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
  brickCounter = 0;
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
  options: { shell?: boolean; refine?: boolean; fill?: boolean } = {},
): BrickModelData & { refinementStats?: RefinementStats; fillStats?: FillStats } {
  const { grid, colorLegend } = voxelData;
  const d = dims(grid);

  console.log(`[pipeline] Grid: [${d.sx}][${d.sy}][${d.sz}]`);

  // Phase 0: Shell
  const shelledGrid = options.shell !== false ? shell(grid, d) : grid;

  // Phase 0.5: Mark interior wildcards
  const { grid: processed, wildcardColors } = markWildcards(shelledGrid, d);

  let filledCount = 0;
  for (let x = 0; x < d.sx; x++)
    for (let y = 0; y < d.sy; y++)
      for (let z = 0; z < d.sz; z++)
        if (processed[x][y][z] !== '0') filledCount++;

  // Phase 1+2: Greedy brick combiner + stagger
  let layers = buildLayers(processed, colorLegend, d, wildcardColors);

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

  // Phase 2.75: Gap-fill (support bricks)
  let fillStats: FillStats | undefined;
  if (options.fill !== false) {
    const { layers: filled, stats } = fillGaps(layers);
    layers = filled;
    fillStats = stats;
    if (stats.cellsFilled > 0) {
      console.log(`[fill] ${stats.cellsFilled} cells filled, ${stats.columnsBuilt} columns`);
    }
  }

  const allBricks = layers.flat();
  console.log(`[pipeline] ${filledCount} voxels → ${allBricks.length} bricks (${(filledCount / Math.max(allBricks.length, 1)).toFixed(1)}x compression)`);

  // Phase 3: Convert to viewer format
  const model = layersToModel(layers, d, name, description, voxelData);
  return { ...model, refinementStats, fillStats };
}
