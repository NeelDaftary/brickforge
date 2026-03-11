/**
 * Voxel-to-Bricks: Converts a voxel grid matrix into LEGO BrickInstance[] data.
 *
 * Grid format: grid[x][y][z] where:
 *   x = width  (left-right)
 *   y = depth  (front-back)
 *   z = height (bottom-up)
 *
 * Pipeline:
 *   Phase 0: Shell the grid (remove fully interior voxels)
 *   Phase 1: Greedy brick combiner (bottom-up, layer by layer)
 *   Phase 2: Structural staggering (break aligned seams between layers)
 *   Phase 3: Convert to viewer BrickInstance format
 */

import { v4 as uuid } from 'uuid';
import type { BrickInstance, BrickModelData, Vector3, VoxelData } from '@/lib/engine/types';

// ─── Brick Sizes ──────────────────────────────────────────────────────────────
// Ordered by area (largest first) for greedy fitting.
// Each entry is [width, depth] in stud units.

const STANDARD_BRICKS: [number, number][] = [
  [2, 8], [2, 6], [4, 4], [2, 4], [2, 3], [2, 2],
  [1, 4], [1, 3], [1, 2], [1, 1],
];

const SUPPORTED_BRICK_IDS = new Set([
  'b_1x1', 'b_1x2', 'b_1x3', 'b_1x4', 'b_1x6', 'b_1x8',
  'b_2x2', 'b_2x3', 'b_2x4', 'b_2x6', 'b_2x8', 'b_4x4',
]);

/** Wildcard symbol for interior voxels that can match any color. */
const WILDCARD = '*';

function brickIdForSize(w: number, d: number): string {
  const [a, b] = [Math.min(w, d), Math.max(w, d)];
  const id = `b_${a}x${b}`;
  return SUPPORTED_BRICK_IDS.has(id) ? id : 'b_1x1';
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VoxelGrid {
  grid: string[][][]; // [x][y][z] — "0" = empty, otherwise color symbol
  colorLegend: Record<string, string>; // symbol -> hex color
  gridSize: number;
}

interface GridDims {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

interface PlacedBrick {
  x: number;  // position in grid x
  y: number;  // position in grid y
  z: number;  // height layer index
  w: number;  // extent along x
  d: number;  // extent along y
  color: string; // hex color
  usedAny?: boolean; // true if this brick consumed any wildcard interior voxels
}

// ─── Direction Vectors (shared across phases) ─────────────────────────────────

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];

// ─── Grid Utilities ───────────────────────────────────────────────────────────

function getGridDims(grid: string[][][]): GridDims {
  const sizeX = grid.length;
  const sizeY = sizeX > 0 ? grid[0].length : 0;
  const sizeZ = sizeY > 0 ? grid[0][0].length : 0;
  return { sizeX, sizeY, sizeZ };
}

function getVoxel(grid: string[][][], x: number, y: number, z: number, dims: GridDims): string {
  if (x < 0 || x >= dims.sizeX || y < 0 || y >= dims.sizeY || z < 0 || z >= dims.sizeZ) {
    return '0';
  }
  return grid[x][y][z];
}

// ─── Phase 0: Shell Grid ──────────────────────────────────────────────────────

const SMALL_MODEL_THRESHOLD = 15;
const MIN_SHELL = 2;

function shellGrid(grid: string[][][], dims: GridDims): string[][][] {
  const minDim = Math.min(dims.sizeX, dims.sizeY, dims.sizeZ);
  if (minDim <= SMALL_MODEL_THRESHOLD) {
    return grid;
  }

  const dist: number[][][] = Array.from({ length: dims.sizeX }, () =>
    Array.from({ length: dims.sizeY }, () =>
      new Array(dims.sizeZ).fill(Infinity),
    ),
  );

  const queue: [number, number, number][] = [];

  for (let x = 0; x < dims.sizeX; x++) {
    for (let y = 0; y < dims.sizeY; y++) {
      for (let z = 0; z < dims.sizeZ; z++) {
        if (grid[x][y][z] === '0') {
          dist[x][y][z] = -1;
          continue;
        }
        let onSurface = false;
        for (let d = 0; d < 6; d++) {
          if (getVoxel(grid, x + DX[d], y + DY[d], z + DZ[d], dims) === '0') {
            onSurface = true;
            break;
          }
        }
        if (onSurface) {
          dist[x][y][z] = 0;
          queue.push([x, y, z]);
        }
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [cx, cy, cz] = queue[head++];
    const nd = dist[cx][cy][cz] + 1;
    for (let d = 0; d < 6; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      const nz = cz + DZ[d];
      if (nx < 0 || nx >= dims.sizeX || ny < 0 || ny >= dims.sizeY || nz < 0 || nz >= dims.sizeZ) continue;
      if (dist[nx][ny][nz] <= nd) continue;
      dist[nx][ny][nz] = nd;
      queue.push([nx, ny, nz]);
    }
  }

  const out: string[][][] = grid.map((plane) =>
    plane.map((col) => [...col]),
  );
  let removed = 0;
  for (let x = 0; x < dims.sizeX; x++) {
    for (let y = 0; y < dims.sizeY; y++) {
      for (let z = 0; z < dims.sizeZ; z++) {
        if (dist[x][y][z] > MIN_SHELL) {
          out[x][y][z] = '0';
          removed++;
        }
      }
    }
  }
  console.log(`[shell] Removed ${removed} deep-interior voxels (${MIN_SHELL}-voxel shell)`);
  return out;
}

// ─── Phase 0.5: Mark Interior Wildcards ──────────────────────────────────────

/**
 * Identify interior voxels (all 6 face-neighbors are filled) and replace their
 * color symbol with WILDCARD ('*'). Build a boundary-color map via BFS so each
 * wildcard knows the nearest boundary voxel's color for fallback resolution.
 *
 * This lets the greedy brick combiner absorb interior voxels into any adjacent
 * boundary-colored brick, maximizing brick size without affecting visible color.
 */
function markInteriorWildcards(
  grid: string[][][],
  dims: GridDims,
): { grid: string[][][]; boundaryColorMap: Map<string, string> } {
  const out: string[][][] = grid.map((plane) =>
    plane.map((col) => [...col]),
  );

  // Step A: Identify and mark interior voxels
  let interiorCount = 0;
  for (let x = 0; x < dims.sizeX; x++) {
    for (let y = 0; y < dims.sizeY; y++) {
      for (let z = 0; z < dims.sizeZ; z++) {
        if (grid[x][y][z] === '0') continue;
        let allFilled = true;
        for (let d = 0; d < 6; d++) {
          if (getVoxel(grid, x + DX[d], y + DY[d], z + DZ[d], dims) === '0') {
            allFilled = false;
            break;
          }
        }
        if (allFilled) {
          out[x][y][z] = WILDCARD;
          interiorCount++;
        }
      }
    }
  }

  // Step B: BFS from boundary voxels to propagate nearest boundary color
  const boundaryColorMap = new Map<string, string>();
  const visited: boolean[][][] = Array.from({ length: dims.sizeX }, () =>
    Array.from({ length: dims.sizeY }, () =>
      new Array(dims.sizeZ).fill(false),
    ),
  );

  const queue: [number, number, number, string][] = [];

  // Seed: all boundary (non-wildcard, non-empty) voxels
  for (let x = 0; x < dims.sizeX; x++) {
    for (let y = 0; y < dims.sizeY; y++) {
      for (let z = 0; z < dims.sizeZ; z++) {
        const sym = out[x][y][z];
        if (sym !== '0' && sym !== WILDCARD) {
          queue.push([x, y, z, sym]);
          visited[x][y][z] = true;
        }
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [cx, cy, cz, color] = queue[head++];
    for (let d = 0; d < 6; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      const nz = cz + DZ[d];
      if (nx < 0 || nx >= dims.sizeX || ny < 0 || ny >= dims.sizeY || nz < 0 || nz >= dims.sizeZ) continue;
      if (visited[nx][ny][nz]) continue;
      if (out[nx][ny][nz] !== WILDCARD) continue;
      visited[nx][ny][nz] = true;
      boundaryColorMap.set(`${nx},${ny},${nz}`, color);
      queue.push([nx, ny, nz, color]);
    }
  }

  // Step C: Fallback for orphan wildcards unreachable by boundary BFS
  if (interiorCount > boundaryColorMap.size) {
    const colorCounts = new Map<string, number>();
    for (let x = 0; x < dims.sizeX; x++) {
      for (let y = 0; y < dims.sizeY; y++) {
        for (let z = 0; z < dims.sizeZ; z++) {
          const sym = out[x][y][z];
          if (sym !== '0' && sym !== WILDCARD) {
            colorCounts.set(sym, (colorCounts.get(sym) ?? 0) + 1);
          }
        }
      }
    }
    let fallbackColor = 'G';
    let maxCount = 0;
    for (const [sym, cnt] of colorCounts) {
      if (cnt > maxCount) { maxCount = cnt; fallbackColor = sym; }
    }

    for (let x = 0; x < dims.sizeX; x++) {
      for (let y = 0; y < dims.sizeY; y++) {
        for (let z = 0; z < dims.sizeZ; z++) {
          if (out[x][y][z] === WILDCARD && !boundaryColorMap.has(`${x},${y},${z}`)) {
            boundaryColorMap.set(`${x},${y},${z}`, fallbackColor);
          }
        }
      }
    }
  }

  if (interiorCount > 0) {
    console.log(`[wildcard] Marked ${interiorCount} interior voxels as wildcard (${boundaryColorMap.size} mapped to boundary colors)`);
  }

  return { grid: out, boundaryColorMap };
}

// ─── Phase 1: Greedy Brick Combiner ───────────────────────────────────────────

/**
 * Check if a brick of size (w, d) fits at position (bx, by) in a
 * horizontal layer at height z. All covered voxels must share the
 * same color symbol and not be already used.
 */
function fits(
  grid: string[][][],
  used: Set<string>,
  bx: number, by: number, z: number,
  w: number, d: number,
  targetSymbol: string,
  dims: GridDims,
): boolean {
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < d; dy++) {
      const nx = bx + dx;
      const ny = by + dy;
      if (nx >= dims.sizeX || ny >= dims.sizeY) return false;
      if (used.has(`${nx},${ny}`)) return false;
      const cell = grid[nx][ny][z];
      if (cell !== targetSymbol && cell !== WILDCARD) return false;
    }
  }
  return true;
}

/**
 * Greedy brick combiner for a single horizontal layer at height z.
 * Alternates scan direction per layer for basic staggering.
 */
function combineLayer(
  grid: string[][][],
  z: number,
  colorLegend: Record<string, string>,
  dims: GridDims,
  boundaryColorMap: Map<string, string>,
): PlacedBrick[] {
  const bricks: PlacedBrick[] = [];
  const used = new Set<string>();

  const scanXFirst = z % 2 === 0;
  const primaryRange = scanXFirst ? dims.sizeX : dims.sizeY;
  const secondaryRange = scanXFirst ? dims.sizeY : dims.sizeX;

  for (let p = 0; p < primaryRange; p++) {
    for (let s = 0; s < secondaryRange; s++) {
      const x = scanXFirst ? p : s;
      const y = scanXFirst ? s : p;

      if (used.has(`${x},${y}`)) continue;
      let symbol = grid[x][y][z];
      if (symbol === '0') continue;

      // Resolve wildcard start voxels to nearest boundary color
      let usedAny = false;
      if (symbol === WILDCARD) {
        symbol = boundaryColorMap.get(`${x},${y},${z}`) ?? 'G';
        usedAny = true;
      }

      const hexColor = colorLegend[symbol] || '#A0A5A9';
      let placed = false;

      for (const [bw, bd] of STANDARD_BRICKS) {
        const orientations: [number, number][] = [
          scanXFirst ? [bw, bd] : [bd, bw],
        ];
        if (bw !== bd) {
          orientations.push(scanXFirst ? [bd, bw] : [bw, bd]);
        }

        for (const [w, d] of orientations) {
          if (fits(grid, used, x, y, z, w, d, symbol, dims)) {
            for (let dx = 0; dx < w; dx++) {
              for (let dy = 0; dy < d; dy++) {
                if (grid[x + dx][y + dy][z] === WILDCARD) usedAny = true;
                used.add(`${x + dx},${y + dy}`);
              }
            }
            bricks.push({ x, y, z, w, d, color: hexColor, usedAny: usedAny || undefined });
            placed = true;
            break;
          }
        }
        if (placed) break;
      }

      if (!placed) {
        used.add(`${x},${y}`);
        bricks.push({ x, y, z, w: 1, d: 1, color: hexColor, usedAny: usedAny || undefined });
      }
    }
  }

  return bricks;
}

// ─── Phase 2: Structural Staggering ───────────────────────────────────────────
//
// Real LEGO builds never align seams between layers. A "seam" is the boundary
// between two adjacent bricks on the same layer. If the same seam line appears
// on layers z and z+1, the build is structurally weak at that point.
//
// This pass detects aligned seams and re-splits the offending bricks to break
// the alignment. The key insight: it's better to use smaller bricks that
// create a staggered pattern than bigger bricks with aligned joints.

interface SeamEdge {
  /** Position key of the seam (e.g., "x=5,y=3-4" for a vertical seam) */
  key: string;
  /** The brick that could be re-split to break this seam */
  brickIdx: number;
  /** Axis of the seam: 'x' means the seam runs perpendicular to x axis */
  axis: 'x' | 'y';
  /** Position along the seam axis */
  pos: number;
}

/**
 * Extract seam positions from a layer of placed bricks.
 * A seam is any boundary between the end of one brick and the start of the next.
 * Returns a Set of seam keys for fast comparison.
 */
function extractSeams(bricks: PlacedBrick[]): Set<string> {
  const seams = new Set<string>();
  for (const b of bricks) {
    // Right edge of brick (seam in X direction)
    const rightX = b.x + b.w;
    for (let dy = 0; dy < b.d; dy++) {
      seams.add(`x=${rightX},y=${b.y + dy}`);
    }
    // Bottom edge of brick (seam in Y direction)
    const bottomY = b.y + b.d;
    for (let dx = 0; dx < b.w; dx++) {
      seams.add(`y=${bottomY},x=${b.x + dx}`);
    }
  }
  return seams;
}

/**
 * Find bricks in layerBricks that have seams aligning with prevSeams,
 * and re-split them to break the alignment.
 */
function staggerLayer(
  layerBricks: PlacedBrick[],
  prevSeams: Set<string>,
): PlacedBrick[] {
  if (prevSeams.size === 0) return layerBricks;

  const result: PlacedBrick[] = [];

  for (const brick of layerBricks) {
    // Check if this brick's left or top edge coincides with a seam from below
    let hasAlignedXSeam = false;
    let alignedXPos = -1;
    let hasAlignedYSeam = false;
    let alignedYPos = -1;

    // Check X-axis seams (right edges of bricks below)
    // A brick spanning x=[3,6] has an aligned seam if there's a seam at x=4 or x=5
    if (brick.w > 1) {
      for (let sx = brick.x + 1; sx < brick.x + brick.w; sx++) {
        let alignCount = 0;
        for (let dy = 0; dy < brick.d; dy++) {
          if (prevSeams.has(`x=${sx},y=${brick.y + dy}`)) {
            alignCount++;
          }
        }
        // If more than half the cells along this seam line are aligned, break it
        if (alignCount > brick.d / 2) {
          hasAlignedXSeam = true;
          alignedXPos = sx;
          break;
        }
      }
    }

    // Check Y-axis seams
    if (brick.d > 1 && !hasAlignedXSeam) {
      for (let sy = brick.y + 1; sy < brick.y + brick.d; sy++) {
        let alignCount = 0;
        for (let dx = 0; dx < brick.w; dx++) {
          if (prevSeams.has(`y=${sy},x=${brick.x + dx}`)) {
            alignCount++;
          }
        }
        if (alignCount > brick.w / 2) {
          hasAlignedYSeam = true;
          alignedYPos = sy;
          break;
        }
      }
    }

    if (hasAlignedXSeam && alignedXPos > brick.x) {
      // Split brick along X at the aligned seam position
      const leftW = alignedXPos - brick.x;
      const rightW = brick.w - leftW;
      // Only split if both halves are valid brick widths
      if (leftW >= 1 && rightW >= 1) {
        result.push({ ...brick, w: leftW });
        result.push({ ...brick, x: alignedXPos, w: rightW });
        continue;
      }
    }

    if (hasAlignedYSeam && alignedYPos > brick.y) {
      // Split brick along Y at the aligned seam position
      const topD = alignedYPos - brick.y;
      const bottomD = brick.d - topD;
      if (topD >= 1 && bottomD >= 1) {
        result.push({ ...brick, d: topD });
        result.push({ ...brick, y: alignedYPos, d: bottomD });
        continue;
      }
    }

    // No aligned seams or can't split — keep original
    result.push(brick);
  }

  return result;
}

// ─── Phase 3: Convert to Viewer Format ────────────────────────────────────────

/**
 * Convert placed bricks to BrickInstance format for the Three.js viewer.
 *
 * Viewer axes (Three.js):
 *   position[0] → viewer X (left-right)  = grid x
 *   position[1] → viewer Y (up)          = grid z * brick height
 *   position[2] → viewer Z (depth)       = grid y
 */
function toBrickInstances(placedBricks: PlacedBrick[], dims: GridDims): BrickInstance[] {
  const centerX = dims.sizeX / 2;
  const centerY = dims.sizeY / 2;

  return placedBricks.map((b) => {
    const brickId = brickIdForSize(b.w, b.d);
    return {
      id: uuid(),
      brickId,
      position: [
        b.x + (b.w / 2 - 0.5) - centerX,
        b.z * 3,
        b.y + (b.d / 2 - 0.5) - centerY,
      ] as Vector3,
      rotation: 0 as 0 | 90 | 180 | 270,
      studWidth: b.w,
      studDepth: b.d,
      color: b.color,
      step: b.z + 1,
      metadata: {
        ...(b.usedAny ? { usedAny: true } : {}),
        gx: b.x, gy: b.y, gz: b.z, gw: b.w, gd: b.d,
      },
    };
  });
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────

export function voxelGridToBrickModel(
  voxelData: VoxelGrid,
  name: string,
  description: string,
  options: { shell?: boolean } = {},
): BrickModelData {
  const { grid, colorLegend } = voxelData;
  const dims = getGridDims(grid);
  const shouldShell = options.shell !== false;

  console.log(`[pipeline] Grid: [${dims.sizeX}][${dims.sizeY}][${dims.sizeZ}]`);

  // Phase 0: Shell
  const shelledGrid = shouldShell ? shellGrid(grid, dims) : grid;

  // Phase 0.5: Mark interior voxels as wildcards for better brick combining
  const { grid: processedGrid, boundaryColorMap } = markInteriorWildcards(shelledGrid, dims);

  let filledCount = 0;
  for (let x = 0; x < dims.sizeX; x++) {
    for (let y = 0; y < dims.sizeY; y++) {
      for (let z = 0; z < dims.sizeZ; z++) {
        if (processedGrid[x][y][z] !== '0') filledCount++;
      }
    }
  }

  // Phase 1: Greedy brick combiner (layer by layer)
  const layerBricks: PlacedBrick[][] = [];
  for (let z = 0; z < dims.sizeZ; z++) {
    layerBricks.push(combineLayer(processedGrid, z, colorLegend, dims, boundaryColorMap));
  }

  // Phase 2: Structural staggering — break aligned seams between adjacent layers
  let totalSplits = 0;
  for (let z = 1; z < dims.sizeZ; z++) {
    if (layerBricks[z].length === 0 || layerBricks[z - 1].length === 0) continue;

    const prevSeams = extractSeams(layerBricks[z - 1]);
    const beforeCount = layerBricks[z].length;
    layerBricks[z] = staggerLayer(layerBricks[z], prevSeams);
    totalSplits += layerBricks[z].length - beforeCount;
  }

  if (totalSplits > 0) {
    console.log(`[stagger] Split ${totalSplits} bricks to break aligned seams`);
  }

  // Flatten all layers
  const allBricks = layerBricks.flat();

  console.log(`[pipeline] ${filledCount} voxels → ${allBricks.length} bricks (${(filledCount / Math.max(allBricks.length, 1)).toFixed(1)}x compression)`);

  // Phase 3: Convert to viewer format
  const bricks = toBrickInstances(allBricks, dims);

  return {
    name,
    description,
    totalBricks: bricks.length,
    bricks,
    voxelData: {
      grid: voxelData.grid,
      colorLegend: voxelData.colorLegend,
      gridSize: voxelData.gridSize,
    },
  };
}
