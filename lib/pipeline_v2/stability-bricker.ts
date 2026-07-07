import type { BrickInstance, BrickModelData, Vector3 } from '@/lib/engine/types';
import {
  DEFAULT_SHELL_ENABLED,
  SHELL_DEPTH,
  SHELL_THRESHOLD,
} from '@/lib/pipeline/constants';
import { brickId, type VoxelGrid } from '@/lib/pipeline/voxel-to-bricks';
import { refineStability, type RefinementStats } from '@/lib/pipeline/stability-refiner';
import { buildLayerOwners, solveLayer, type SolvedBrick } from './layer-solver';
import { repairStabilityV2, type InternalSupportStats, type RepairStats } from './repair';
import { analyzeBrickGraph, summarizeGraphDiagnostics, type GraphDiagnosticsSummary } from './brick-graph';

interface StabilityV2Options {
  shell?: boolean;
  refine?: boolean;
  beamWidth?: number;
  repair?: boolean;
  deepRepair?: boolean;
}

interface Dims {
  sx: number;
  sy: number;
  sz: number;
}

interface PreparedGrid {
  grid: string[][][];
  wildcardColors: Map<string, string>;
  surfaceCells: Set<string>;
  supportOptionalCells: Set<string>;
  dims: Dims;
}

export interface StabilityV2Stats {
  engine: 'stability_v2';
  layersSolved: number;
  candidateBranches: number;
  fallbackPlacements: number;
  finalLayerCost: number;
  initialLayout?: GraphDiagnosticsSummary;
  finalLayout?: GraphDiagnosticsSummary;
  repair?: RepairStats;
  internalSupport?: InternalSupportStats;
  refinement?: RefinementStats;
}

const WILDCARD = '*';
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

function shellGrid(grid: string[][][], d: Dims): string[][][] {
  if (Math.min(d.sx, d.sy, d.sz) <= SHELL_THRESHOLD) return grid;

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
  for (let x = 0; x < d.sx; x++) {
    for (let y = 0; y < d.sy; y++) {
      for (let z = 0; z < d.sz; z++) {
        if (dist[x][y][z] > SHELL_DEPTH) out[x][y][z] = '0';
      }
    }
  }
  return out;
}

function markWildcards(grid: string[][][], d: Dims, supportOptionalCells: Set<string>): PreparedGrid {
  const out = cloneGrid(grid);
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

  const surfaceCells = new Set<string>();
  for (let x = 0; x < d.sx; x++) {
    for (let y = 0; y < d.sy; y++) {
      for (let z = 0; z < d.sz; z++) {
        if (grid[x][y][z] === '0') continue;
        for (let i = 0; i < 6; i++) {
          const nx = x + DX[i], ny = y + DY[i], nz = z + DZ[i];
          if (!inBounds(nx, ny, nz, d) || exterior[nx][ny][nz]) {
            surfaceCells.add(`${x},${y},${z}`);
            break;
          }
        }
      }
    }
  }

  for (let x = 0; x < d.sx; x++) {
    for (let y = 0; y < d.sy; y++) {
      for (let z = 0; z < d.sz; z++) {
        if (grid[x][y][z] !== '0' && !surfaceCells.has(`${x},${y},${z}`)) out[x][y][z] = WILDCARD;
      }
    }
  }

  const wildcardColors = new Map<string, string>();
  const visited: boolean[][][] = Array.from({ length: d.sx }, () =>
    Array.from({ length: d.sy }, () => new Array(d.sz).fill(false)),
  );
  const queue: [number, number, number, string][] = [];

  for (let x = 0; x < d.sx; x++) {
    for (let y = 0; y < d.sy; y++) {
      for (let z = 0; z < d.sz; z++) {
        const symbol = out[x][y][z];
        if (symbol !== '0' && symbol !== WILDCARD) {
          queue.push([x, y, z, symbol]);
          visited[x][y][z] = true;
        }
      }
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

  return { grid: out, wildcardColors, surfaceCells, supportOptionalCells, dims: d };
}

function prepareGrid(voxelGrid: VoxelGrid, shellEnabled: boolean): PreparedGrid {
  const d = dims(voxelGrid.grid);
  const shelled = shellEnabled ? shellGrid(voxelGrid.grid, d) : voxelGrid.grid;
  const supportOptionalCells = new Set<string>();
  for (let x = 0; x < d.sx; x++) {
    for (let y = 0; y < d.sy; y++) {
      for (let z = 0; z < d.sz; z++) {
        if (voxelGrid.grid[x][y][z] !== '0' && shelled[x][y][z] === '0') {
          supportOptionalCells.add(`${x},${y},${z}`);
        }
      }
    }
  }
  return markWildcards(shelled, d, supportOptionalCells);
}

function toBrickInstances(placed: SolvedBrick[], d: Dims): BrickInstance[] {
  const cx = d.sx / 2;
  const cy = d.sy / 2;

  return placed.map((b, i) => ({
    id: `v2-brick-${i}`,
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

function buildLayers(
  prepared: PreparedGrid,
  colorLegend: Record<string, string>,
  beamWidth?: number,
): { layers: SolvedBrick[][]; stats: StabilityV2Stats } {
  const layers: SolvedBrick[][] = [];
  let belowOwners = new Map<string, string>();
  let candidateBranches = 0;
  let fallbackPlacements = 0;
  let finalLayerCost = 0;

  for (let z = 0; z < prepared.dims.sz; z++) {
    const result = solveLayer({
      grid: prepared.grid,
      z,
      colorLegend,
      wildcardColors: prepared.wildcardColors,
      surfaceCells: prepared.surfaceCells,
      belowOwners,
      nextGrid: prepared.grid,
      beamWidth,
    });
    layers.push(result.bricks);
    belowOwners = buildLayerOwners(result.bricks);
    candidateBranches += result.stats.candidateBranches;
    fallbackPlacements += result.stats.fallbackPlacements;
    finalLayerCost += result.stats.finalCost;
  }

  return {
    layers,
    stats: {
      engine: 'stability_v2',
      layersSolved: layers.length,
      candidateBranches,
      fallbackPlacements,
      finalLayerCost,
    },
  };
}

export function voxelGridToBrickModelV2(
  voxelGrid: VoxelGrid,
  name: string,
  description: string,
  options: StabilityV2Options = {},
): BrickModelData & { stabilityV2Stats?: StabilityV2Stats; refinementStats?: RefinementStats } {
  const shellEnabled = options.shell ?? DEFAULT_SHELL_ENABLED;
  const refineEnabled = options.refine ?? true;
  const repairEnabled = options.repair ?? true;
  const prepared = prepareGrid(voxelGrid, shellEnabled);
  const { layers: initialLayers, stats } = buildLayers(prepared, voxelGrid.colorLegend, options.beamWidth);

  let layers = initialLayers;
  stats.initialLayout = summarizeGraphDiagnostics(analyzeBrickGraph(toBrickInstances(layers.flat(), prepared.dims)));

  let refinementStats: RefinementStats | undefined;
  if (refineEnabled) {
    const refined = refineStability(layers);
    layers = refined.layers;
    refinementStats = refined.stats;
    stats.refinement = refined.stats;
  }

  if (repairEnabled) {
    const repaired = repairStabilityV2(layers, {
      grid: prepared.grid,
      colorLegend: voxelGrid.colorLegend,
      wildcardColors: prepared.wildcardColors,
      surfaceCells: prepared.surfaceCells,
      supportOptionalCells: prepared.supportOptionalCells,
    }, { deep: options.deepRepair });
    layers = repaired.layers;
    stats.repair = repaired.repair;
    stats.internalSupport = repaired.internalSupport;
  }

  const allBricks = layers.flat();
  const bricks = toBrickInstances(allBricks, prepared.dims);
  stats.finalLayout = summarizeGraphDiagnostics(
    analyzeBrickGraph(bricks),
    {
      internalSupportBricks: stats.internalSupport?.internalSupportBricks ?? 0,
      internalSupportVoxels: stats.internalSupport?.internalSupportVoxels ?? 0,
    },
  );

  console.log(`[pipeline:v2] ${allBricks.length} bricks, ${stats.candidateBranches} candidates explored`);

  return {
    name,
    description,
    totalBricks: bricks.length,
    bricks,
    voxelData: { grid: voxelGrid.grid, colorLegend: voxelGrid.colorLegend, gridSize: voxelGrid.gridSize },
    stabilityV2Stats: stats,
    ...(refinementStats ? { refinementStats } : {}),
  };
}
