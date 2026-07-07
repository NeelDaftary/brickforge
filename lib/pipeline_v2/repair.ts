import type { BrickInstance } from '@/lib/engine/types';
import {
  analyzeBrickGraph,
  buildBrickGraph,
  scoreGraphDiagnostics,
  summarizeGraphDiagnostics,
  type GraphBrick,
  type GraphDiagnosticsSummary,
} from './brick-graph';
import { solveLayer, type SolvedBrick } from './layer-solver';

export interface RepairGridContext {
  grid: string[][][];
  colorLegend: Record<string, string>;
  wildcardColors: ReadonlyMap<string, string>;
  surfaceCells: ReadonlySet<string>;
  supportOptionalCells: ReadonlySet<string>;
}

export interface RepairStats {
  iterations: number;
  acceptedPatches: number;
  rejectedPatches: number;
  before: GraphDiagnosticsSummary;
  after: GraphDiagnosticsSummary;
  elapsedMs: number;
}

export interface InternalSupportStats {
  internalSupportBricks: number;
  internalSupportVoxels: number;
  supportAddedReason?: string;
}

export interface RepairResult {
  layers: SolvedBrick[][];
  repair: RepairStats;
  internalSupport: InternalSupportStats;
}

interface Patch {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  reason: string;
  defectBrickId: string;
}

const PATCH_RADIUS_XY = 3;
const PATCH_RADIUS_Z = 1;
const NORMAL_MAX_ITERATIONS = 8;
const DEEP_MAX_ITERATIONS = 40;
const WILDCARD = '*';

function key2(x: number, y: number): string {
  return `${x},${y}`;
}

function key3(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function cloneLayers(layers: SolvedBrick[][]): SolvedBrick[][] {
  return layers.map((layer) => layer.map((brick) => ({ ...brick })));
}

function occupancyFromLayers(layers: SolvedBrick[][]): Set<string> {
  const occupied = new Set<string>();
  for (const layer of layers) {
    for (const brick of layer) {
      for (let dx = 0; dx < brick.w; dx++) {
        for (let dy = 0; dy < brick.d; dy++) {
          occupied.add(key3(brick.x + dx, brick.y + dy, brick.z));
        }
      }
    }
  }
  return occupied;
}

function solvedToInstances(layers: SolvedBrick[][]): BrickInstance[] {
  return layers.flatMap((layer) => layer).map((brick, index) => ({
    id: `repair-brick-${index}`,
    brickId: `b_${Math.min(brick.w, brick.d)}x${Math.max(brick.w, brick.d)}`,
    position: [0, 0, 0],
    rotation: 0,
    studWidth: brick.w,
    studDepth: brick.d,
    color: brick.color,
    step: brick.z + 1,
    metadata: { gx: brick.x, gy: brick.z, gz: brick.y, gw: brick.w, gd: brick.d },
  }));
}

function scoreLayers(layers: SolvedBrick[][]): { score: number; summary: GraphDiagnosticsSummary } {
  const diagnostics = analyzeBrickGraph(solvedToInstances(layers));
  const summary = summarizeGraphDiagnostics(diagnostics);
  return {
    summary,
    score: scoreGraphDiagnostics({ ...summary, brickCount: diagnostics.brickCount }),
  };
}

function findGraphBrick(layers: SolvedBrick[][], brickId: string): GraphBrick | undefined {
  const graph = buildBrickGraph(solvedToInstances(layers));
  return graph.bricks.find((brick) => brick.id === brickId);
}

function chooseDefect(layers: SolvedBrick[][]): { brick: GraphBrick; reason: string } | null {
  const graph = buildBrickGraph(solvedToInstances(layers));
  const diagnostics = analyzeBrickGraph(graph);
  const load = diagnostics.loadAbove;

  const byLoad = (ids: Iterable<string>) =>
    [...ids]
      .map((id) => graph.bricks.find((brick) => brick.id === id))
      .filter((brick): brick is GraphBrick => Boolean(brick))
      .sort((a, b) => (load.get(b.id)?.loadAboveStuds ?? 0) - (load.get(a.id)?.loadAboveStuds ?? 0))[0];

  const floating = byLoad(diagnostics.floatingBrickIds);
  if (floating) return { brick: floating, reason: 'floating' };

  const unsupported = byLoad(diagnostics.unsupportedBrickIds);
  if (unsupported) return { brick: unsupported, reason: 'unsupported' };

  const weak = byLoad(diagnostics.weakCantileverBrickIds);
  if (weak) return { brick: weak, reason: 'weak_cantilever' };

  const articulation = byLoad(diagnostics.articulationBrickIds);
  if (articulation) return { brick: articulation, reason: 'articulation' };

  const bridge = diagnostics.bridgeEdges[0];
  if (bridge) {
    const brick = graph.bricks.find((b) => b.id === bridge.from || b.id === bridge.to);
    if (brick) return { brick, reason: 'bridge' };
  }

  return null;
}

function patchFor(defect: { brick: GraphBrick; reason: string }, dims: { sx: number; sy: number; sz: number }): Patch {
  const { brick } = defect;
  return {
    minX: Math.max(0, brick.x - PATCH_RADIUS_XY),
    maxX: Math.min(dims.sx - 1, brick.x + brick.w - 1 + PATCH_RADIUS_XY),
    minY: Math.max(0, brick.y - PATCH_RADIUS_XY),
    maxY: Math.min(dims.sy - 1, brick.y + brick.d - 1 + PATCH_RADIUS_XY),
    minZ: Math.max(0, brick.z - PATCH_RADIUS_Z),
    maxZ: Math.min(dims.sz - 1, brick.z + PATCH_RADIUS_Z),
    reason: defect.reason,
    defectBrickId: brick.id,
  };
}

function intersectsPatch(brick: SolvedBrick, patch: Patch): boolean {
  const maxX = brick.x + brick.w - 1;
  const maxY = brick.y + brick.d - 1;
  return brick.z >= patch.minZ && brick.z <= patch.maxZ &&
    brick.x <= patch.maxX && maxX >= patch.minX &&
    brick.y <= patch.maxY && maxY >= patch.minY;
}

function layerOwnersFromFixed(bricks: SolvedBrick[]): Map<string, string> {
  const owners = new Map<string, string>();
  bricks.forEach((brick, index) => {
    for (let dx = 0; dx < brick.w; dx++) {
      for (let dy = 0; dy < brick.d; dy++) {
        owners.set(key2(brick.x + dx, brick.y + dy), `fixed-${index}`);
      }
    }
  });
  return owners;
}

function symbolForColor(color: string, colorLegend: Record<string, string>): string {
  const found = Object.entries(colorLegend).find(([, hex]) => hex.toLowerCase() === color.toLowerCase());
  return found?.[0] ?? 'G';
}

function supportColor(cellKey: string, context: RepairGridContext): string {
  const symbol = context.wildcardColors.get(cellKey) ?? 'G';
  return context.colorLegend[symbol] ?? '#A0A5A9';
}

function addAnchoredSupportColumn(
  layers: SolvedBrick[][],
  defectBrick: GraphBrick,
  context: RepairGridContext,
): { layers: SolvedBrick[][]; addedSupportVoxels: number } | null {
  const occupied = occupancyFromLayers(layers);
  let bestColumn: SolvedBrick[] | null = null;

  for (let dx = 0; dx < defectBrick.w; dx++) {
    for (let dy = 0; dy < defectBrick.d; dy++) {
      const x = defectBrick.x + dx;
      const y = defectBrick.y + dy;
      const additions: SolvedBrick[] = [];
      let viable = true;

      for (let z = 0; z < defectBrick.z; z++) {
        const cellKey = key3(x, y, z);
        if (occupied.has(cellKey)) continue;
        if (!context.supportOptionalCells.has(cellKey)) {
          viable = false;
          break;
        }
        additions.push({ x, y, z, w: 1, d: 1, color: supportColor(cellKey, context) });
      }

      if (!viable || additions.length === 0) continue;
      if (!bestColumn || additions.length < bestColumn.length) bestColumn = additions;
    }
  }

  if (!bestColumn) return null;

  const nextLayers = cloneLayers(layers);
  for (const brick of bestColumn) {
    while (nextLayers.length <= brick.z) nextLayers.push([]);
    nextLayers[brick.z].push(brick);
  }

  return { layers: nextLayers, addedSupportVoxels: bestColumn.length };
}

function addSupportColumnCells(
  targetGrid: string[][][],
  patch: Patch,
  defectBrick: GraphBrick,
  context: RepairGridContext,
): number {
  let added = 0;

  for (let dx = 0; dx < defectBrick.w; dx++) {
    for (let dy = 0; dy < defectBrick.d; dy++) {
      const x = defectBrick.x + dx;
      const y = defectBrick.y + dy;
      for (let z = defectBrick.z - 1; z >= patch.minZ; z--) {
        if (targetGrid[x]?.[y]?.[z] !== '0') break;
        if (!context.supportOptionalCells.has(key3(x, y, z))) continue;
        targetGrid[x][y][z] = WILDCARD;
        added++;
      }
    }
  }

  return added;
}

function solvePatch(
  layers: SolvedBrick[][],
  patch: Patch,
  context: RepairGridContext,
  dims: { sx: number; sy: number; sz: number },
): { layers: SolvedBrick[][]; addedSupportVoxels: number } | null {
  const nextLayers = cloneLayers(layers);
  const removedByLayer = new Map<number, SolvedBrick[]>();
  const fixedByLayer = new Map<number, SolvedBrick[]>();

  for (let z = patch.minZ; z <= patch.maxZ; z++) {
    const removed: SolvedBrick[] = [];
    const fixed: SolvedBrick[] = [];
    for (const brick of nextLayers[z] ?? []) {
      (intersectsPatch(brick, patch) ? removed : fixed).push(brick);
    }
    removedByLayer.set(z, removed);
    fixedByLayer.set(z, fixed);
  }

  const targetGrid = Array.from({ length: dims.sx }, () =>
    Array.from({ length: dims.sy }, () => new Array(dims.sz).fill('0')),
  );

  for (const [z, removed] of removedByLayer) {
    for (const brick of removed) {
      const symbol = symbolForColor(brick.color, context.colorLegend);
      for (let dx = 0; dx < brick.w; dx++) {
        for (let dy = 0; dy < brick.d; dy++) {
          targetGrid[brick.x + dx][brick.y + dy][z] = symbol;
        }
      }
    }
  }

  const defectBrick = findGraphBrick(layers, patch.defectBrickId);
  const addedSupportVoxels = defectBrick ? addSupportColumnCells(targetGrid, patch, defectBrick, context) : 0;

  const solvedByLayer = new Map<number, SolvedBrick[]>();
  for (let z = patch.minZ; z <= patch.maxZ; z++) {
    const belowFixed = z > 0
      ? [
        ...(z - 1 >= patch.minZ ? solvedByLayer.get(z - 1) ?? [] : []),
        ...(fixedByLayer.get(z - 1) ?? nextLayers[z - 1] ?? []),
      ]
      : [];
    const result = solveLayer({
      grid: targetGrid,
      z,
      colorLegend: context.colorLegend,
      wildcardColors: context.wildcardColors,
      surfaceCells: context.surfaceCells,
      belowOwners: layerOwnersFromFixed(belowFixed),
      nextGrid: targetGrid,
      beamWidth: 32,
    });
    solvedByLayer.set(z, result.bricks);
  }

  for (let z = patch.minZ; z <= patch.maxZ; z++) {
    nextLayers[z] = [...(fixedByLayer.get(z) ?? []), ...(solvedByLayer.get(z) ?? [])];
  }

  return { layers: nextLayers, addedSupportVoxels };
}

export function repairStabilityV2(
  initialLayers: SolvedBrick[][],
  context: RepairGridContext,
  options: { deep?: boolean } = {},
): RepairResult {
  const startedAt = Date.now();
  const dims = {
    sx: context.grid.length,
    sy: context.grid[0]?.length ?? 0,
    sz: context.grid[0]?.[0]?.length ?? 0,
  };
  const maxIterations = options.deep ? DEEP_MAX_ITERATIONS : NORMAL_MAX_ITERATIONS;
  let layers = cloneLayers(initialLayers);
  const before = scoreLayers(layers);
  let currentScore = before.score;
  let acceptedPatches = 0;
  let rejectedPatches = 0;
  let internalSupportVoxels = 0;
  let supportAddedReason: string | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const defect = chooseDefect(layers);
    if (!defect) break;

    const patch = patchFor(defect, dims);
    const candidates: Array<{ layers: SolvedBrick[][]; addedSupportVoxels: number }> = [];

    if (defect.reason === 'floating' || defect.reason === 'unsupported') {
      const supported = addAnchoredSupportColumn(layers, defect.brick, context);
      if (supported) candidates.push(supported);
    }

    const patchCandidate = solvePatch(layers, patch, context, dims);
    if (patchCandidate) candidates.push(patchCandidate);

    let bestCandidate: { layers: SolvedBrick[][]; addedSupportVoxels: number; score: number } | null = null;
    for (const candidate of candidates) {
      const score = scoreLayers(candidate.layers).score;
      if (score >= currentScore) continue;
      if (!bestCandidate || score < bestCandidate.score) bestCandidate = { ...candidate, score };
    }

    if (bestCandidate) {
      layers = bestCandidate.layers;
      currentScore = bestCandidate.score;
      acceptedPatches++;
      if (bestCandidate.addedSupportVoxels > 0) {
        internalSupportVoxels += bestCandidate.addedSupportVoxels;
        supportAddedReason = patch.reason;
      }
    } else {
      rejectedPatches++;
    }
  }

  const after = scoreLayers(layers).summary;

  return {
    layers,
    repair: {
      iterations: acceptedPatches + rejectedPatches,
      acceptedPatches,
      rejectedPatches,
      before: before.summary,
      after,
      elapsedMs: Date.now() - startedAt,
    },
    internalSupport: {
      internalSupportBricks: internalSupportVoxels,
      internalSupportVoxels,
      ...(supportAddedReason ? { supportAddedReason } : {}),
    },
  };
}
