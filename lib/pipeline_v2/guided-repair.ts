import type { BrickInstance, BrickModelData, Vector3, VoxelData } from '@/lib/engine/types';
import {
  analyzeBrickGraph,
  buildBrickGraph,
  summarizeGraphDiagnosticBrickIds,
  summarizeGraphDiagnostics,
  type BrickGraph,
  type GraphBrick,
  type GraphDiagnosticsSummary,
} from './brick-graph';

type GuidedRepairMode = 'minimal_support' | 'balanced_support' | 'full_support';
type GuidedRepairApplication = 'rebrick' | 'direct';

export interface GuidedRepairDiagnostics {
  layout: GraphDiagnosticsSummary;
  layoutIds: ReturnType<typeof summarizeGraphDiagnosticBrickIds>;
}

export interface GuidedRepairSuggestion {
  id: GuidedRepairMode;
  title: string;
  description: string;
  tradeoff: string;
  targetBrickIds: string[];
  addedBricks: number;
  addedVoxels: number;
  application: GuidedRepairApplication;
  intent: {
    type: 'add_support_cells';
    supportCells: SupportCell[];
    supportColor: string;
    supportSymbol: string;
  };
  editedVoxelData?: VoxelData;
  before: GraphDiagnosticsSummary;
  after: GraphDiagnosticsSummary;
  afterModel: BrickModelData & { diagnostics?: unknown };
}

export interface SupportCell {
  x: number;
  y: number;
  z: number;
}

const SUPPORT_COLOR = '#A0A5A9';
const SUPPORT_SYMBOL = 'E';

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function graphAndDiagnostics(model: BrickModelData): {
  graph: BrickGraph;
  summary: GraphDiagnosticsSummary;
  ids: GuidedRepairDiagnostics['layoutIds'];
} {
  const graph = buildBrickGraph(model.bricks);
  const diagnostics = analyzeBrickGraph(graph);
  return {
    graph,
    summary: summarizeGraphDiagnostics(diagnostics, internalSupportExtras(model.bricks)),
    ids: summarizeGraphDiagnosticBrickIds(diagnostics, graph),
  };
}

function internalSupportExtras(bricks: BrickInstance[]): { internalSupportBricks: number; internalSupportVoxels: number } {
  const internalSupportBricks = bricks.filter((brick) => brick.metadata?.internalSupport).length;
  const internalSupportVoxels = bricks
    .filter((brick) => brick.metadata?.internalSupport)
    .reduce((sum, brick) => sum + (brick.metadata?.gw ?? brick.studWidth ?? 1) * (brick.metadata?.gd ?? brick.studDepth ?? 1), 0);
  return { internalSupportBricks, internalSupportVoxels };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function modelGridCenter(model: BrickModelData): { cx: number; cy: number } {
  if (model.voxelData?.grid.length) {
    return {
      cx: model.voxelData.grid.length / 2,
      cy: (model.voxelData.grid[0]?.length ?? 0) / 2,
    };
  }

  const samples = model.bricks
    .map((brick) => {
      const gx = brick.metadata?.gx;
      const gy = brick.metadata?.gz;
      if (gx == null || gy == null) return null;
      const gw = brick.metadata?.gw ?? brick.studWidth ?? 1;
      const gd = brick.metadata?.gd ?? brick.studDepth ?? 1;
      return {
        cx: gx + (gw / 2 - 0.5) - brick.position[0],
        cy: gy + (gd / 2 - 0.5) - brick.position[2],
      };
    })
    .filter((sample): sample is { cx: number; cy: number } => Boolean(sample));

  if (samples.length === 0) return { cx: 0, cy: 0 };
  return {
    cx: samples.reduce((sum, sample) => sum + sample.cx, 0) / samples.length,
    cy: samples.reduce((sum, sample) => sum + sample.cy, 0) / samples.length,
  };
}

function supportBrick(model: BrickModelData, cell: SupportCell, index: number): BrickInstance {
  const { cx, cy } = modelGridCenter(model);
  return {
    id: `guided-support-${cell.x}-${cell.y}-${cell.z}-${index}`,
    brickId: 'b_1x1',
    position: [
      cell.x - cx,
      cell.z * 3,
      cell.y - cy,
    ] as Vector3,
    rotation: 0,
    studWidth: 1,
    studDepth: 1,
    color: SUPPORT_COLOR,
    step: cell.z + 1,
    metadata: { gx: cell.x, gy: cell.z, gz: cell.y, gw: 1, gd: 1, internalSupport: true },
  };
}

function occupiedSet(graph: BrickGraph): Set<string> {
  return new Set(graph.cellToBrick.keys());
}

function cellsForBrick(brick: GraphBrick): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [];
  for (let dx = 0; dx < brick.w; dx++) {
    for (let dy = 0; dy < brick.d; dy++) {
      cells.push({ x: brick.x + dx, y: brick.y + dy });
    }
  }
  return cells;
}

function columnToSupport(cell: { x: number; y: number }, targetZ: number, occupied: Set<string>): SupportCell[] {
  const additions: SupportCell[] = [];
  for (let z = targetZ - 1; z >= 0; z--) {
    const cellKey = key(cell.x, cell.y, z);
    if (occupied.has(cellKey)) break;
    additions.push({ x: cell.x, y: cell.y, z });
  }
  return additions;
}

function chooseShortestSupportColumn(brick: GraphBrick, occupied: Set<string>): SupportCell[] {
  let best: SupportCell[] | null = null;
  for (const cell of cellsForBrick(brick)) {
    const additions = columnToSupport(cell, brick.z, occupied);
    if (additions.length === 0) continue;
    if (!best || additions.length < best.length) best = additions;
  }
  return best ?? [];
}

function allUnsupportedFootprintColumns(brick: GraphBrick, occupied: Set<string>): SupportCell[] {
  const additionsByKey = new Map<string, SupportCell>();
  for (const cell of cellsForBrick(brick)) {
    if (brick.z === 0 || occupied.has(key(cell.x, cell.y, brick.z - 1))) continue;
    for (const addition of columnToSupport(cell, brick.z, occupied)) {
      additionsByKey.set(key(addition.x, addition.y, addition.z), addition);
    }
  }
  return [...additionsByKey.values()];
}

function addCellsToVoxelData(model: BrickModelData, cells: SupportCell[]): VoxelData | undefined {
  if (!model.voxelData) return undefined;
  const grid = model.voxelData.grid.map((plane) => plane.map((column) => [...column]));
  const colorLegend = { ...model.voxelData.colorLegend, [SUPPORT_SYMBOL]: SUPPORT_COLOR };

  for (const cell of cells) {
    if (grid[cell.x]?.[cell.y]?.[cell.z] == null) continue;
    grid[cell.x][cell.y][cell.z] = SUPPORT_SYMBOL;
  }

  return { ...model.voxelData, grid, colorLegend };
}

function withRecomputedDiagnostics(
  model: BrickModelData & { diagnostics?: unknown },
): BrickModelData & { diagnostics?: unknown } {
  const { summary, ids } = graphAndDiagnostics(model);
  const diagnostics = {
    ...objectRecord(model.diagnostics),
    totalBricks: model.totalBricks,
    layout: summary,
    layoutIds: ids,
    guidedRepair: {
      updatedAt: new Date().toISOString(),
    },
  };
  return { ...model, diagnostics };
}

function buildSuggestion(
  model: BrickModelData & { diagnostics?: unknown },
  mode: GuidedRepairMode,
): GuidedRepairSuggestion | null {
  const { graph, summary, ids } = graphAndDiagnostics(model);
  const criticalIds = [...new Set([...ids.floating, ...ids.unsupported])];
  const targetBrickIds = mode === 'full_support' || mode === 'balanced_support'
    ? [...new Set([...criticalIds, ...ids.weakCantilever])]
    : criticalIds;
  if (targetBrickIds.length === 0) return null;

  const bricksById = new Map(graph.bricks.map((brick) => [brick.id, brick]));
  const occupied = occupiedSet(graph);
  const addedCellsByKey = new Map<string, SupportCell>();

  for (const id of targetBrickIds) {
    const brick = bricksById.get(id);
    if (!brick) continue;
    const cells = mode === 'full_support'
      ? allUnsupportedFootprintColumns(brick, occupied)
      : chooseShortestSupportColumn(brick, occupied);
    for (const cell of cells) {
      const cellKey = key(cell.x, cell.y, cell.z);
      if (occupied.has(cellKey)) continue;
      occupied.add(cellKey);
      addedCellsByKey.set(cellKey, cell);
    }
  }

  const addedCells = [...addedCellsByKey.values()];
  if (addedCells.length === 0) return null;

  const supportBricks = addedCells.map((cell, index) => supportBrick(model, cell, index));
  const editedVoxelData = addCellsToVoxelData(model, addedCells);
  const repairedModel: BrickModelData & { diagnostics?: unknown } = {
    ...model,
    totalBricks: model.bricks.length + supportBricks.length,
    bricks: [...model.bricks, ...supportBricks],
    voxelData: editedVoxelData ?? model.voxelData,
  };
  const afterModel = withRecomputedDiagnostics(repairedModel);
  const after = (afterModel.diagnostics as { layout?: GraphDiagnosticsSummary } | undefined)?.layout ?? summary;
  const application: GuidedRepairApplication = editedVoxelData ? 'rebrick' : 'direct';

  return {
    id: mode,
    title: mode === 'full_support'
      ? 'Add full support columns'
      : mode === 'balanced_support'
        ? 'Add balanced support columns'
        : 'Add minimal support columns',
    description: mode === 'full_support'
      ? 'Adds support under every unsupported stud in floating, unsupported, and weak-cantilever bricks.'
      : mode === 'balanced_support'
        ? 'Adds one shortest support path under each floating, unsupported, or weak-cantilever brick.'
        : 'Adds the shortest visible support path under each floating or unsupported brick.',
    tradeoff: mode === 'full_support'
      ? 'Most reliable, but can add many visible grey support bricks.'
      : mode === 'balanced_support'
        ? 'Moderate visual change; may not eliminate every weak cantilever.'
        : 'Lowest visual change, but weak cantilevers may remain.',
    targetBrickIds,
    addedBricks: supportBricks.length,
    addedVoxels: addedCells.length,
    application,
    intent: {
      type: 'add_support_cells',
      supportCells: addedCells,
      supportColor: SUPPORT_COLOR,
      supportSymbol: SUPPORT_SYMBOL,
    },
    ...(editedVoxelData ? { editedVoxelData } : {}),
    before: summary,
    after,
    afterModel,
  };
}

export function guidedRepairDiagnostics(model: BrickModelData): GuidedRepairDiagnostics {
  const { summary, ids } = graphAndDiagnostics(model);
  return { layout: summary, layoutIds: ids };
}

export function buildGuidedRepairSuggestions(
  model: BrickModelData & { diagnostics?: unknown },
): GuidedRepairSuggestion[] {
  return [
    buildSuggestion(model, 'minimal_support'),
    buildSuggestion(model, 'balanced_support'),
    buildSuggestion(model, 'full_support'),
  ].filter((suggestion): suggestion is GuidedRepairSuggestion => Boolean(suggestion));
}
