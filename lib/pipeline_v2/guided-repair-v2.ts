import type { BrickInstance, BrickModelData, Vector3, VoxelData } from '@/lib/engine/types';
import { buildLayoutDiagnostics } from '@/lib/pipeline/layout-diagnostics';
import type { GeneratedModel, ModelDiagnostics } from '@/lib/pipeline/model-diagnostics';
import { voxelGridToBrickModelV2, type StabilityV2Stats } from '@/lib/pipeline_v2/stability-bricker';
import {
  analyzeBrickGraph,
  buildAttachmentTree,
  buildBrickGraph,
  descendantIds,
  summarizeGraphDiagnosticBrickIds,
  summarizeGraphDiagnostics,
  type BrickGraph,
  type GraphBrick,
  type GraphDiagnosticsSummary,
  type StabilityConnectionClass,
  type WeakRegionDiagnostic,
  type WeakRegionType,
} from './brick-graph';

export type RepairCandidateFamily =
  'retile_same_voxels' |
  'recolor_retile' |
  'hidden_internal_brace' |
  'tapered_support' |
  'strengthen_attachment_root' |
  'symmetric_visible_support' |
  'boundary_thickening' |
  'column_stand';

export type RepairStyle = 'conservative' | 'balanced' | 'structural';

export interface RepairPreferences {
  style: RepairStyle;
  allowRecolor: boolean;
  preserveSymmetry: boolean;
  allowVisibleBoundaryEdits: boolean;
  showLastResortSupports: boolean;
}

export interface RepairPreviewCell {
  x: number;
  y: number;
  z: number;
  color: string;
}

export interface RepairPreview {
  addedCells: RepairPreviewCell[];
  recoloredCells: RepairPreviewCell[];
  removedBrickIds: string[];
  anchorBrickIds: string[];
  dependentBrickIds: string[];
  mirrored: boolean;
}

export interface RepairCandidateMetrics {
  before: GraphDiagnosticsSummary;
  after: GraphDiagnosticsSummary;
  score: number;
  stabilityGain: number;
  visibleGeometryCost: number;
  negativeSpaceFillCost: number;
  symmetryMismatchCost: number;
  colorChangeCost: number;
  brickCountDelta: number;
  smallPieceDelta: number;
  columnPenalty: number;
  patchSizePenalty: number;
  loadWeightedUnsupportedPct: number;
}

export interface RepairGateStatus {
  passed: boolean;
  reasons: string[];
}

export interface RepairWeakRegion {
  id: string;
  type: WeakRegionType;
  title: string;
  description: string;
  connectionClass: StabilityConnectionClass;
  layer: number;
  rootBrickIds: string[];
  targetBrickIds: string[];
  dependentBrickIds: string[];
  anchorBrickIds: string[];
  loadAboveStuds: number;
  affectedSubtreeSize: number;
  severityScore: number;
  canApply: boolean;
}

export interface RepairSuggestion {
  id: string;
  regionId: string;
  family: RepairCandidateFamily;
  title: string;
  description: string;
  tradeoff: string;
  recommendation: 'recommended' | 'alternative' | 'last_resort';
  preview: RepairPreview;
  metrics: RepairCandidateMetrics;
  gate: RepairGateStatus;
}

export interface RepairSuggestionsResult {
  queue: RepairWeakRegion[];
  activeRegion?: RepairWeakRegion;
  suggestions: RepairSuggestion[];
  diagnostics: {
    layout: GraphDiagnosticsSummary;
    layoutIds: ReturnType<typeof summarizeGraphDiagnosticBrickIds>;
  };
  warning?: string;
}

const SUPPORT_SYMBOL = 'E';
const SUPPORT_COLOR = '#A0A5A9';
const MAX_REGION_BRICKS = 18;

export const DEFAULT_REPAIR_PREFERENCES: RepairPreferences = {
  style: 'balanced',
  allowRecolor: true,
  preserveSymmetry: true,
  allowVisibleBoundaryEdits: true,
  showLastResortSupports: false,
};

function key3(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function cloneGrid(grid: string[][][]): string[][][] {
  return grid.map((plane) => plane.map((column) => [...column]));
}

function graphBundle(model: BrickModelData) {
  const graph = buildBrickGraph(model.bricks);
  const diagnostics = analyzeBrickGraph(graph);
  const summary = summarizeGraphDiagnostics(diagnostics);
  const ids = summarizeGraphDiagnosticBrickIds(diagnostics, graph);
  return { graph, diagnostics, summary, ids };
}

function brickCenter(brick: GraphBrick): { x: number; y: number; z: number } {
  return {
    x: brick.x + (brick.w - 1) / 2,
    y: brick.y + (brick.d - 1) / 2,
    z: brick.z,
  };
}

function regionTitle(type: WeakRegionType, connectionClass: StabilityConnectionClass, layer: number): string {
  if (type === 'detached_floating') return `Detached component on layer ${layer + 1}`;
  if (type === 'critical_cantilever') return `Critical cantilever on layer ${layer + 1}`;
  if (connectionClass === 'attached_cantilever') return `Attached cantilever on layer ${layer + 1}`;
  if (type === 'unsupported') return `Unsupported region on layer ${layer + 1}`;
  if (type === 'weak_cantilever') return `Weak cantilever on layer ${layer + 1}`;
  if (type === 'articulation') return `Weak joint on layer ${layer + 1}`;
  return `Bridge edge on layer ${layer + 1}`;
}

function connectionDescription(connectionClass: StabilityConnectionClass): string {
  if (connectionClass === 'detached_floating') return 'This region is detached from the grounded build.';
  if (connectionClass === 'attached_cantilever') return 'This region is attached to the body, but lacks direct support from below.';
  if (connectionClass === 'weak_cantilever') return 'This region has some support, but the overhang/load path is weak.';
  if (connectionClass === 'unsupported') return 'This region lacks meaningful vertical support.';
  return 'This region is connected, but nearby graph diagnostics flagged a weak structural path.';
}

function regionSeverity(type: WeakRegionType, loadAboveStuds: number, affectedSubtreeSize: number, layer: number): number {
  const typeWeight = type === 'detached_floating' ? 10_000 :
    type === 'critical_cantilever' ? 7_000 :
    type === 'unsupported' ? 5_000 :
    type === 'weak_cantilever' || type === 'attached_cantilever' ? 3_000 :
    type === 'articulation' ? 2_000 :
    1_000;
  return typeWeight + loadAboveStuds * 20 + affectedSubtreeSize * 50 - layer;
}

function graphBrickById(graph: BrickGraph): Map<string, GraphBrick> {
  return new Map(graph.bricks.map((brick) => [brick.id, brick]));
}

function nearbyRegionBrickIds(
  graph: BrickGraph,
  region: WeakRegionDiagnostic,
  diagnostics = analyzeBrickGraph(graph),
): string[] {
  const byId = graphBrickById(graph);
  const root = byId.get(region.primaryBrickId);
  if (!root) return [];
  const center = brickCenter(root);
  const ids = new Set<string>([root.id]);
  const radius = region.suggestedRepairRadius.xy;
  const layerRadius = Math.max(1, region.suggestedRepairRadius.z);
  const defectIds = new Set([
    ...diagnostics.detachedFloatingBrickIds,
    ...diagnostics.unsupportedBrickIds,
    ...diagnostics.attachedCantileverBrickIds,
    ...diagnostics.criticalCantileverBrickIds,
    ...diagnostics.weakCantileverBrickIds,
  ]);

  for (const brick of graph.bricks) {
    if (!defectIds.has(brick.id)) continue;
    const candidate = brickCenter(brick);
    if (Math.abs(candidate.z - center.z) > layerRadius) continue;
    if (Math.abs(candidate.x - center.x) <= radius && Math.abs(candidate.y - center.y) <= radius) ids.add(brick.id);
    if (ids.size >= MAX_REGION_BRICKS) break;
  }

  const tree = buildAttachmentTree(graph);
  for (const id of descendantIds(tree, root.id)) {
    ids.add(id);
    if (ids.size >= MAX_REGION_BRICKS) break;
  }

  return [...ids];
}

function anchorIdsForRegion(graph: BrickGraph, targetIds: string[]): string[] {
  const target = new Set(targetIds);
  const anchors = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === 'horizontal') {
      if (target.has(edge.from)) anchors.add(edge.to);
      if (target.has(edge.to)) anchors.add(edge.from);
    }
    if (edge.type === 'vertical') {
      if (target.has(edge.to)) anchors.add(edge.from);
      if (target.has(edge.from)) anchors.add(edge.to);
    }
  }
  return [...anchors].filter((id) => !target.has(id)).slice(0, 12);
}

function buildWeakRegion(
  graph: BrickGraph,
  region: WeakRegionDiagnostic,
  diagnostics = analyzeBrickGraph(graph),
  hasVoxelData: boolean,
): RepairWeakRegion | null {
  const byId = graphBrickById(graph);
  const brick = byId.get(region.primaryBrickId);
  if (!brick) return null;
  const targetBrickIds = nearbyRegionBrickIds(graph, region, diagnostics);
  const tree = buildAttachmentTree(graph);
  const dependentBrickIds = [...descendantIds(tree, brick.id)].slice(0, 24);
  const anchorBrickIds = anchorIdsForRegion(graph, targetBrickIds);
  const connectionClass = diagnostics.connectionClassByBrickId.get(brick.id) ?? 'stable';

  return {
    id: `${region.defectType}:${region.primaryBrickId}`,
    type: region.defectType,
    title: regionTitle(region.defectType, connectionClass, brick.z),
    description: `${connectionDescription(connectionClass)} Load above estimate: ${region.loadAboveStuds} studs.`,
    connectionClass,
    layer: brick.z,
    rootBrickIds: [brick.id],
    targetBrickIds,
    dependentBrickIds,
    anchorBrickIds,
    loadAboveStuds: region.loadAboveStuds,
    affectedSubtreeSize: region.affectedSubtreeSize,
    severityScore: regionSeverity(region.defectType, region.loadAboveStuds, region.affectedSubtreeSize, brick.z),
    canApply: hasVoxelData,
  };
}

function buildRegionQueue(model: BrickModelData): RepairWeakRegion[] {
  const { graph, diagnostics } = graphBundle(model);
  return diagnostics.weakRegions
    .map((region) => buildWeakRegion(graph, region, diagnostics, Boolean(model.voxelData)))
    .filter((region): region is RepairWeakRegion => Boolean(region))
    .sort((a, b) => a.layer - b.layer || b.severityScore - a.severityScore);
}

function cellOccupied(grid: string[][][], x: number, y: number, z: number): boolean {
  const value = grid[x]?.[y]?.[z];
  return Boolean(value && value !== '0');
}

function gridDims(grid: string[][][]): { sx: number; sy: number; sz: number } {
  return { sx: grid.length, sy: grid[0]?.length ?? 0, sz: grid[0]?.[0]?.length ?? 0 };
}

function graphCellsForBrick(brick: GraphBrick): Array<{ x: number; y: number; z: number }> {
  const cells: Array<{ x: number; y: number; z: number }> = [];
  for (let dx = 0; dx < brick.w; dx++) {
    for (let dy = 0; dy < brick.d; dy++) cells.push({ x: brick.x + dx, y: brick.y + dy, z: brick.z });
  }
  return cells;
}

function unsupportedFootprintCells(graph: BrickGraph, brick: GraphBrick): Array<{ x: number; y: number; z: number }> {
  return graphCellsForBrick(brick).filter((cell) => brick.z > 0 && !graph.cellToBrick.has(key3(cell.x, cell.y, brick.z - 1)));
}

function supportSymbol(voxelData: VoxelData): string {
  if (voxelData.colorLegend[SUPPORT_SYMBOL]) return SUPPORT_SYMBOL;
  const existing = Object.entries(voxelData.colorLegend).find(([, color]) => color.toLowerCase() === SUPPORT_COLOR.toLowerCase());
  return existing?.[0] ?? SUPPORT_SYMBOL;
}

function addCell(target: Map<string, RepairPreviewCell>, grid: string[][][], cell: { x: number; y: number; z: number }, color: string): void {
  const dims = gridDims(grid);
  if (cell.x < 0 || cell.y < 0 || cell.z < 0 || cell.x >= dims.sx || cell.y >= dims.sy || cell.z >= dims.sz) return;
  if (cellOccupied(grid, cell.x, cell.y, cell.z)) return;
  target.set(key3(cell.x, cell.y, cell.z), { ...cell, color });
}

interface RepairDraft {
  family: RepairCandidateFamily;
  title: string;
  description: string;
  tradeoff: string;
  addedCells: RepairPreviewCell[];
  recoloredCells: RepairPreviewCell[];
  columnPenalty?: number;
  mirrored?: boolean;
}

function dominantSymbol(voxelData: VoxelData, cells: Array<{ x: number; y: number; z: number }>): string | null {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    const symbol = voxelData.grid[cell.x]?.[cell.y]?.[cell.z];
    if (!symbol || symbol === '0') continue;
    counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function generateDrafts(
  model: BrickModelData,
  region: RepairWeakRegion,
  preferences: RepairPreferences,
): RepairDraft[] {
  if (!model.voxelData) return [];
  const { graph } = graphBundle(model);
  const byId = graphBrickById(graph);
  const root = byId.get(region.rootBrickIds[0]);
  if (!root) return [];
  const grid = model.voxelData.grid;
  const colorLegend: Record<string, string> = { ...model.voxelData.colorLegend, [SUPPORT_SYMBOL]: SUPPORT_COLOR };
  const symbol = supportSymbol({ ...model.voxelData, colorLegend });
  const supportColor = colorLegend[symbol] ?? SUPPORT_COLOR;
  const unsupported = unsupportedFootprintCells(graph, root);
  const drafts: RepairDraft[] = [];

  drafts.push({
    family: 'retile_same_voxels',
    title: 'Retile this region',
    description: 'Rebuilds the same source voxels with the stability bricker and no shape or color change.',
    tradeoff: 'Cleanest visual option, but it only helps if the current tiling got stuck in a weak layout.',
    addedCells: [],
    recoloredCells: [],
  });

  if (preferences.allowRecolor) {
    const regionCells = region.targetBrickIds
      .map((id) => byId.get(id))
      .filter((brick): brick is GraphBrick => Boolean(brick))
      .flatMap(graphCellsForBrick);
    const dominant = dominantSymbol(model.voxelData, regionCells);
    if (dominant) {
      const recolored = regionCells
        .filter((cell) => model.voxelData?.grid[cell.x]?.[cell.y]?.[cell.z] !== dominant)
        .slice(0, 24)
        .map((cell) => ({ ...cell, color: colorLegend[dominant] ?? supportColor }));
      if (recolored.length > 0) {
        drafts.push({
          family: 'recolor_retile',
          title: 'Recolor and retile patch',
          description: `Simplifies ${recolored.length} nearby color cells so the layer can use stronger brick runs.`,
          tradeoff: 'Can improve structure and part count, but may soften small color details.',
          addedCells: [],
          recoloredCells: recolored,
        });
      }
    }
  }

  const rootSupportCells = new Map<string, RepairPreviewCell>();
  for (const cell of unsupported.slice(0, 6)) {
    addCell(rootSupportCells, grid, { x: cell.x, y: cell.y, z: cell.z - 1 }, supportColor);
  }
  if (rootSupportCells.size > 0 && region.connectionClass === 'attached_cantilever') {
    drafts.push({
      family: 'strengthen_attachment_root',
      title: 'Strengthen attachment root',
      description: 'Adds a short backing strip near the body connection instead of building a column to the ground.',
      tradeoff: 'Good for tails, arms, ears, and fins. Usually less visually intrusive than a support pillar.',
      addedCells: [...rootSupportCells.values()],
      recoloredCells: [],
    });
  }

  const hiddenCells = new Map<string, RepairPreviewCell>();
  for (const cell of unsupported.slice(0, 8)) {
    const below = { x: cell.x, y: cell.y, z: cell.z - 1 };
    if (below.x > 0 && below.y > 0 && below.x < grid.length - 1 && below.y < (grid[0]?.length ?? 0) - 1) {
      addCell(hiddenCells, grid, below, supportColor);
    }
  }
  if (hiddenCells.size > 0) {
    drafts.push({
      family: 'hidden_internal_brace',
      title: 'Add hidden internal brace',
      description: 'Routes support through likely interior cells while preserving the visible silhouette where possible.',
      tradeoff: 'Preferred geometric repair when the model has enough interior volume.',
      addedCells: [...hiddenCells.values()],
      recoloredCells: [],
    });
  }

  const taperedCells = new Map<string, RepairPreviewCell>();
  for (const cell of unsupported.slice(0, 6)) {
    addCell(taperedCells, grid, { x: cell.x, y: cell.y, z: cell.z - 1 }, supportColor);
  }
  for (const cell of unsupported.slice(0, 3)) {
    addCell(taperedCells, grid, { x: cell.x, y: cell.y, z: cell.z - 2 }, supportColor);
  }
  if (taperedCells.size > 0 && preferences.allowVisibleBoundaryEdits) {
    drafts.push({
      family: 'tapered_support',
      title: 'Add tapered support',
      description: 'Adds a stepped support envelope under the weak region without extending a full pillar to the floor.',
      tradeoff: 'More visible than hidden bracing, but usually cleaner than a vertical support column.',
      addedCells: [...taperedCells.values()],
      recoloredCells: [],
    });
  }

  const lowLayerColumnAllowed = root.z <= Math.max(1, Math.ceil((grid[0]?.[0]?.length ?? 1) * 0.05));
  if (preferences.showLastResortSupports || lowLayerColumnAllowed) {
    const columnCells = new Map<string, RepairPreviewCell>();
    const columnSeed = unsupported[0];
    if (columnSeed) {
      for (let z = columnSeed.z - 1; z >= 0; z--) {
        if (cellOccupied(grid, columnSeed.x, columnSeed.y, z)) break;
        addCell(columnCells, grid, { x: columnSeed.x, y: columnSeed.y, z }, supportColor);
      }
    }
    if (columnCells.size > 0) {
      drafts.push({
        family: 'column_stand',
        title: lowLayerColumnAllowed ? 'Add low support post' : 'Last resort: visible stand',
        description: 'Adds a direct support path when cleaner local repairs are insufficient.',
        tradeoff: 'Structurally strong, but visually expensive. Use only when the repair is low or intentionally stand-like.',
        addedCells: [...columnCells.values()],
        recoloredCells: [],
        columnPenalty: lowLayerColumnAllowed ? 10 : 80,
      });
    }
  }

  return drafts;
}

function applyDraft(voxelData: VoxelData, draft: RepairDraft): VoxelData {
  const grid = cloneGrid(voxelData.grid);
  const colorLegend = { ...voxelData.colorLegend, [SUPPORT_SYMBOL]: SUPPORT_COLOR };
  const symbol = supportSymbol({ ...voxelData, colorLegend });

  for (const cell of draft.addedCells) {
    if (grid[cell.x]?.[cell.y]?.[cell.z] != null) grid[cell.x][cell.y][cell.z] = symbol;
  }

  for (const cell of draft.recoloredCells) {
    const recolorSymbol = Object.entries(colorLegend).find(([, color]) => color.toLowerCase() === cell.color.toLowerCase())?.[0] ?? symbol;
    if (grid[cell.x]?.[cell.y]?.[cell.z] != null && grid[cell.x][cell.y][cell.z] !== '0') {
      grid[cell.x][cell.y][cell.z] = recolorSymbol;
    }
  }

  return { ...voxelData, grid, colorLegend };
}

function withDiagnostics(model: BrickModelData, startedAt: number, voxelSize: number, shell: boolean): GeneratedModel {
  const stats = (model as BrickModelData & { stabilityV2Stats?: StabilityV2Stats }).stabilityV2Stats;
  const layoutDiagnostics = buildLayoutDiagnostics(model.bricks, stats);
  const grid = model.voxelData?.grid ?? [];
  const diagnostics: ModelDiagnostics = {
    pipeline: 'brickforge-v3',
    timingMs: Date.now() - startedAt,
    voxelSize,
    gridSize: model.voxelData?.gridSize,
    voxelLayers: grid[0]?.[0]?.length ?? 0,
    totalBricks: model.totalBricks,
    shelled: shell,
    brickerEngine: 'stability_v2',
    layout: layoutDiagnostics.layout,
    layoutIds: layoutDiagnostics.layoutIds,
    ...(stats ? { stabilityV2: stats } : {}),
  };
  return { ...model, diagnostics };
}

function rebrickVoxelData(base: BrickModelData, voxelData: VoxelData, voxelSize: number, shell: boolean): GeneratedModel {
  const startedAt = Date.now();
  const model = voxelGridToBrickModelV2(
    { grid: voxelData.grid, colorLegend: voxelData.colorLegend, gridSize: voxelData.gridSize },
    base.name,
    base.description,
    { shell, variant: 'stability_v2' },
  );
  return withDiagnostics(model, startedAt, voxelSize, shell);
}

function countSmallPieces(model: BrickModelData): number {
  return model.bricks.filter((brick) => (brick.studWidth ?? 1) * (brick.studDepth ?? 1) <= 1).length;
}

function scoreCandidate(
  before: GraphDiagnosticsSummary,
  beforeModel: BrickModelData,
  after: GraphDiagnosticsSummary,
  afterModel: BrickModelData,
  draft: RepairDraft,
): RepairCandidateMetrics {
  const beforeDetached = before.detachedFloatingBricks ?? before.floatingBricks;
  const afterDetached = after.detachedFloatingBricks ?? after.floatingBricks;
  const stabilityGain =
    (beforeDetached - afterDetached) * 10_000 +
    ((before.criticalCantileverRegions ?? 0) - (after.criticalCantileverRegions ?? 0)) * 2_000 +
    (before.unsupportedBricks - after.unsupportedBricks) * 1_000 +
    (before.weakCantilevers - after.weakCantilevers) * 300;
  const visibleGeometryCost = draft.family === 'hidden_internal_brace' ? Math.ceil(draft.addedCells.length * 0.3) : draft.addedCells.length;
  const colorChangeCost = draft.recoloredCells.length * 2;
  const brickCountDelta = afterModel.totalBricks - beforeModel.totalBricks;
  const smallPieceDelta = countSmallPieces(afterModel) - countSmallPieces(beforeModel);
  const columnPenalty = draft.columnPenalty ?? 0;
  const patchSizePenalty = draft.addedCells.length + draft.recoloredCells.length;
  const negativeSpaceFillCost = draft.family === 'tapered_support' ? Math.ceil(draft.addedCells.length * 0.4) : 0;
  const symmetryMismatchCost = draft.family === 'symmetric_visible_support' && !draft.mirrored ? 20 : 0;
  const score =
    -stabilityGain * 0.35 +
    visibleGeometryCost * 30 +
    Math.max(0, brickCountDelta) * 20 +
    colorChangeCost * 10 +
    Math.max(0, smallPieceDelta) * 8 +
    columnPenalty * 12 +
    patchSizePenalty * 4 +
    negativeSpaceFillCost * 8 +
    symmetryMismatchCost * 10;

  return {
    before,
    after,
    score: Math.round(score),
    stabilityGain,
    visibleGeometryCost,
    negativeSpaceFillCost,
    symmetryMismatchCost,
    colorChangeCost,
    brickCountDelta,
    smallPieceDelta,
    columnPenalty,
    patchSizePenalty,
    loadWeightedUnsupportedPct: after.loadWeightedUnsupportedPct ?? 0,
  };
}

function gateCandidate(region: RepairWeakRegion, before: GraphDiagnosticsSummary, after: GraphDiagnosticsSummary): RepairGateStatus {
  const reasons: string[] = [];
  const beforeDetached = before.detachedFloatingBricks ?? before.floatingBricks;
  const afterDetached = after.detachedFloatingBricks ?? after.floatingBricks;
  if (afterDetached > beforeDetached) reasons.push('Creates a new detached floating component.');
  if ((after.criticalCantileverRegions ?? 0) > (before.criticalCantileverRegions ?? 0)) {
    reasons.push('Creates a new critical cantilever.');
  }

  const targetImproved = region.type === 'detached_floating'
    ? afterDetached < beforeDetached
    : after.unsupportedBricks < before.unsupportedBricks ||
      after.weakCantilevers < before.weakCantilevers ||
      (after.criticalCantileverRegions ?? 0) < (before.criticalCantileverRegions ?? 0);
  if (!targetImproved) reasons.push('Does not improve the selected weak region.');

  return { passed: reasons.length === 0, reasons };
}

function suggestionCopy(family: RepairCandidateFamily): { title: string; recommendation: RepairSuggestion['recommendation'] } {
  if (family === 'hidden_internal_brace') return { title: 'Recommended: hidden internal brace', recommendation: 'recommended' };
  if (family === 'strengthen_attachment_root') return { title: 'Recommended: strengthen attachment root', recommendation: 'recommended' };
  if (family === 'column_stand') return { title: 'Last resort: visible support', recommendation: 'last_resort' };
  return { title: 'Alternative repair', recommendation: 'alternative' };
}

function buildSuggestion(
  model: GeneratedModel,
  region: RepairWeakRegion,
  draft: RepairDraft,
  preferences: RepairPreferences,
): RepairSuggestion | null {
  if (!model.voxelData) return null;
  const before = graphBundle(model).summary;
  const editedVoxelData = applyDraft(model.voxelData, draft);
  const shell = preferences.style !== 'conservative';
  const afterModel = rebrickVoxelData(model, editedVoxelData, model.diagnostics?.voxelSize ?? 0.06, shell);
  const after = graphBundle(afterModel).summary;
  const gate = gateCandidate(region, before, after);
  if (!gate.passed) return null;
  const metrics = scoreCandidate(before, model, after, afterModel, draft);
  const copy = suggestionCopy(draft.family);

  return {
    id: `${region.id}:${draft.family}:${draft.addedCells.map((cell) => key3(cell.x, cell.y, cell.z)).join('|')}:${draft.recoloredCells.length}`,
    regionId: region.id,
    family: draft.family,
    title: copy.recommendation === 'alternative' ? draft.title : copy.title,
    description: draft.description,
    tradeoff: draft.tradeoff,
    recommendation: copy.recommendation,
    preview: {
      addedCells: draft.addedCells,
      recoloredCells: draft.recoloredCells,
      removedBrickIds: region.targetBrickIds,
      anchorBrickIds: region.anchorBrickIds,
      dependentBrickIds: region.dependentBrickIds,
      mirrored: Boolean(draft.mirrored),
    },
    metrics,
    gate,
  };
}

export function buildRepairSuggestions(
  model: GeneratedModel,
  options: { activeRegionId?: string; preferences?: Partial<RepairPreferences> } = {},
): RepairSuggestionsResult {
  const preferences = { ...DEFAULT_REPAIR_PREFERENCES, ...options.preferences };
  const { summary, ids } = graphBundle(model);
  const queue = buildRegionQueue(model);
  const activeRegion = queue.find((region) => region.id === options.activeRegionId) ?? queue[0];

  if (!activeRegion) {
    return {
      queue,
      suggestions: [],
      diagnostics: { layout: summary, layoutIds: ids },
    };
  }

  if (!model.voxelData) {
    return {
      queue,
      activeRegion,
      suggestions: [],
      diagnostics: { layout: summary, layoutIds: ids },
      warning: 'This build has no source voxel grid, so Guided Repair can inspect issues but cannot apply rebuild suggestions.',
    };
  }

  const suggestions = generateDrafts(model, activeRegion, preferences)
    .map((draft) => buildSuggestion(model, activeRegion, draft, preferences))
    .filter((suggestion): suggestion is RepairSuggestion => Boolean(suggestion))
    .sort((a, b) => a.metrics.score - b.metrics.score)
    .slice(0, 4)
    .map((suggestion, index) => ({
      ...suggestion,
      recommendation: index === 0 && suggestion.recommendation !== 'last_resort'
        ? 'recommended' as const
        : suggestion.recommendation,
      title: index === 0 && suggestion.recommendation !== 'last_resort'
        ? suggestion.title.replace(/^Alternative repair$/, `Recommended: ${suggestion.family.replaceAll('_', ' ')}`)
        : suggestion.title,
    }));

  return {
    queue,
    activeRegion,
    suggestions,
    diagnostics: { layout: summary, layoutIds: ids },
    ...(suggestions.length === 0 ? { warning: 'No candidate passed the current repair gates. Try enabling stronger visible support options.' } : {}),
  };
}

export function applyRepairSuggestion(
  model: GeneratedModel,
  regionId: string,
  suggestionId: string,
  preferences?: Partial<RepairPreferences>,
): GeneratedModel {
  const result = buildRepairSuggestions(model, { activeRegionId: regionId, preferences });
  const suggestion = result.suggestions.find((candidate) => candidate.id === suggestionId);
  if (!suggestion || !model.voxelData) {
    throw new Error('Repair suggestion is no longer available. Refresh suggestions and try again.');
  }
  const draft: RepairDraft = {
    family: suggestion.family,
    title: suggestion.title,
    description: suggestion.description,
    tradeoff: suggestion.tradeoff,
    addedCells: suggestion.preview.addedCells,
    recoloredCells: suggestion.preview.recoloredCells,
    columnPenalty: suggestion.metrics.columnPenalty,
    mirrored: suggestion.preview.mirrored,
  };
  const editedVoxelData = applyDraft(model.voxelData, draft);
  return rebrickVoxelData(model, editedVoxelData, model.diagnostics?.voxelSize ?? 0.06, (preferences?.style ?? DEFAULT_REPAIR_PREFERENCES.style) !== 'conservative');
}

export function previewCellsToBricks(model: BrickModelData, cells: RepairPreviewCell[]): BrickInstance[] {
  const sx = model.voxelData?.grid.length ?? 0;
  const sy = model.voxelData?.grid[0]?.length ?? 0;
  const cx = sx / 2;
  const cy = sy / 2;
  return cells.map((cell, index) => ({
    id: `repair-preview-${cell.x}-${cell.y}-${cell.z}-${index}`,
    brickId: 'b_1x1',
    position: [cell.x - cx, cell.z * 3, cell.y - cy] as Vector3,
    rotation: 0,
    studWidth: 1,
    studDepth: 1,
    color: cell.color,
    step: cell.z + 1,
    metadata: { gx: cell.x, gy: cell.z, gz: cell.y, gw: 1, gd: 1, internalSupport: true },
  }));
}
