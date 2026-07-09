import { v4 as uuid } from 'uuid';
import type { BrickInstance, BrickModelData, Vector3, VoxelData } from '@/lib/engine/types';
import type { VoxelGrid } from '@/lib/pipeline/voxel-to-bricks';
import { buildLayoutDiagnostics } from '@/lib/pipeline/layout-diagnostics';
import type { ModelDiagnostics } from '@/lib/pipeline/model-diagnostics';
import { PipelineError } from '@/lib/pipeline/errors';
import { voxelGridToBrickModelV2, type StabilityV2Options, type StabilityV2Stats } from './stability-bricker';

export type RetileStyle = 'balanced' | 'fewer_parts' | 'stronger';

export interface RetileCell {
  x: number;
  y: number;
  z: number;
}

export interface RetileCandidate {
  id: string;
  label: string;
  description: string;
  style: RetileStyle;
  recommended: boolean;
  model: BrickModelData & { diagnostics?: ModelDiagnostics };
  metrics: {
    brickCountBefore: number;
    brickCountAfter: number;
    unsupportedBefore: number;
    unsupportedAfter: number;
    weakBefore: number;
    weakAfter: number;
    selectedCells: number;
    affectedBricks: number;
  };
}

export interface RetileSelectionResult {
  candidates: RetileCandidate[];
}

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function cellInGrid(voxelData: VoxelData, cell: RetileCell): boolean {
  return cell.x >= 0 &&
    cell.x < voxelData.grid.length &&
    cell.y >= 0 &&
    cell.y < (voxelData.grid[0]?.length ?? 0) &&
    cell.z >= 0 &&
    cell.z < (voxelData.grid[0]?.[0]?.length ?? 0);
}

function brickFootprint(brick: BrickInstance): string[] {
  const gx = brick.metadata?.gx;
  const layer = brick.metadata?.gy;
  const depth = brick.metadata?.gz;
  if (gx == null || layer == null || depth == null) return [];

  const gw = brick.metadata?.gw ?? brick.studWidth ?? 1;
  const gd = brick.metadata?.gd ?? brick.studDepth ?? 1;
  const cells: string[] = [];
  for (let dx = 0; dx < gw; dx++) {
    for (let dy = 0; dy < gd; dy++) {
      cells.push(key(gx + dx, depth + dy, layer));
    }
  }
  return cells;
}

function diagnosticsFor(model: BrickModelData, startedAt: number, voxelSize: number, stabilityV2?: StabilityV2Stats): ModelDiagnostics {
  const layoutDiagnostics = buildLayoutDiagnostics(model.bricks, stabilityV2);
  return {
    pipeline: 'brickforge-v3',
    timingMs: Date.now() - startedAt,
    voxelSize,
    gridSize: model.voxelData?.gridSize,
    voxelLayers: model.voxelData?.grid[0]?.[0]?.length ?? 0,
    totalBricks: model.totalBricks,
    shelled: false,
    brickerEngine: 'stability_v2',
    layout: layoutDiagnostics.layout,
    layoutIds: layoutDiagnostics.layoutIds,
    ...(stabilityV2 ? { stabilityV2 } : {}),
  };
}

function styleOptions(style: RetileStyle): { label: string; description: string; options: StabilityV2Options } {
  if (style === 'fewer_parts') {
    return {
      label: 'Fewer pieces',
      description: 'Prefers larger bricks and fewer seams in the selected area.',
      options: { shell: false, repair: false, refine: false, beamWidth: 12, variant: 'stability_v2' },
    };
  }
  if (style === 'stronger') {
    return {
      label: 'Stronger layout',
      description: 'Searches harder for support-friendly tiling in the selected area.',
      options: { shell: false, repair: false, refine: true, beamWidth: 72, variant: 'stability_v2' },
    };
  }
  return {
    label: 'Balanced',
    description: 'Balances part count, seams, and support for this selection.',
    options: { shell: false, repair: false, refine: true, beamWidth: 32, variant: 'stability_v2' },
  };
}

function localBrickToGlobal(
  brick: BrickInstance,
  offset: { x: number; y: number; z: number },
  fullDims: { sx: number; sy: number },
  candidateId: string,
  index: number,
): BrickInstance {
  const localGx = brick.metadata?.gx ?? 0;
  const localLayer = brick.metadata?.gy ?? 0;
  const localDepth = brick.metadata?.gz ?? 0;
  const gx = localGx + offset.x;
  const depth = localDepth + offset.y;
  const layer = localLayer + offset.z;
  return {
    ...brick,
    id: `retile-${candidateId}-${index}-${uuid()}`,
    position: [gx - fullDims.sx / 2, layer * 3, depth - fullDims.sy / 2] as Vector3,
    step: layer + 1,
    metadata: {
      ...brick.metadata,
      gx,
      gy: layer,
      gz: depth,
      gw: brick.metadata?.gw ?? brick.studWidth ?? 1,
      gd: brick.metadata?.gd ?? brick.studDepth ?? 1,
    },
  };
}

function buildCandidate(
  model: BrickModelData & { diagnostics?: ModelDiagnostics },
  selectedCells: RetileCell[],
  style: RetileStyle,
  affectedCellKeys: Set<string>,
  affectedBrickIds: Set<string>,
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number },
  startedAt: number,
): RetileCandidate {
  const voxelData = model.voxelData!;
  const styleConfig = styleOptions(style);
  const sx = bounds.maxX - bounds.minX + 1;
  const sy = bounds.maxY - bounds.minY + 1;
  const sz = bounds.maxZ - bounds.minZ + 1;
  const subGrid = Array.from({ length: sx }, () =>
    Array.from({ length: sy }, () => new Array<string>(sz).fill('0')),
  );

  for (const cellKey of affectedCellKeys) {
    const [x, y, z] = cellKey.split(',').map(Number);
    const symbol = voxelData.grid[x]?.[y]?.[z] ?? '0';
    if (symbol === '0') continue;
    subGrid[x - bounds.minX][y - bounds.minY][z - bounds.minZ] = symbol;
  }

  const voxelGrid: VoxelGrid = {
    grid: subGrid,
    colorLegend: voxelData.colorLegend,
    gridSize: Math.max(sx, sy, sz),
  };
  const localModel = voxelGridToBrickModelV2(
    voxelGrid,
    `${model.name} ${styleConfig.label}`,
    model.description,
    styleConfig.options,
  );
  const candidateId = style;
  const replacement = localModel.bricks.map((brick, index) =>
    localBrickToGlobal(
      brick,
      { x: bounds.minX, y: bounds.minY, z: bounds.minZ },
      { sx: voxelData.grid.length, sy: voxelData.grid[0]?.length ?? 0 },
      candidateId,
      index,
    ),
  );
  const bricks = [
    ...model.bricks.filter((brick) => !affectedBrickIds.has(brick.id)),
    ...replacement,
  ];
  const candidateModel: BrickModelData = {
    ...model,
    totalBricks: bricks.length,
    bricks,
    voxelData,
  };
  const stabilityV2 = (localModel as typeof localModel & { stabilityV2Stats?: StabilityV2Stats }).stabilityV2Stats;
  const diagnostics = diagnosticsFor(candidateModel, startedAt, model.diagnostics?.voxelSize ?? 0.06, stabilityV2);
  const beforeLayout = model.diagnostics?.layout;
  const afterLayout = diagnostics.layout;

  return {
    id: candidateId,
    label: styleConfig.label,
    description: styleConfig.description,
    style,
    recommended: style === 'balanced',
    model: { ...candidateModel, diagnostics },
    metrics: {
      brickCountBefore: model.totalBricks,
      brickCountAfter: candidateModel.totalBricks,
      unsupportedBefore: beforeLayout?.unsupportedBricks ?? 0,
      unsupportedAfter: afterLayout?.unsupportedBricks ?? 0,
      weakBefore: beforeLayout?.weakCantilevers ?? 0,
      weakAfter: afterLayout?.weakCantilevers ?? 0,
      selectedCells: selectedCells.length,
      affectedBricks: affectedBrickIds.size,
    },
  };
}

export function buildRetileSelectionCandidates(
  model: BrickModelData & { diagnostics?: ModelDiagnostics },
  selectedCells: RetileCell[],
  styles: RetileStyle[] = ['balanced', 'fewer_parts', 'stronger'],
): RetileSelectionResult {
  const startedAt = Date.now();
  if (!model.voxelData) throw new PipelineError('INVALID_INPUT', 'This build has no voxel grid to retile.');
  const validSelected = selectedCells.filter((cell) => cellInGrid(model.voxelData!, cell));
  if (validSelected.length === 0) throw new PipelineError('INVALID_INPUT', 'Select at least one filled area to retile.');

  const selectedKeys = new Set(validSelected.map((cell) => key(cell.x, cell.y, cell.z)));
  const affectedCellKeys = new Set<string>();
  const affectedBrickIds = new Set<string>();

  for (const brick of model.bricks) {
    const footprint = brickFootprint(brick);
    if (footprint.length === 0 || !footprint.some((cell) => selectedKeys.has(cell))) continue;
    affectedBrickIds.add(brick.id);
    for (const cell of footprint) affectedCellKeys.add(cell);
  }

  if (affectedBrickIds.size === 0) {
    for (const cell of validSelected) affectedCellKeys.add(key(cell.x, cell.y, cell.z));
  }

  const affectedCoords = [...affectedCellKeys].map((cellKey) => cellKey.split(',').map(Number) as [number, number, number]);
  const bounds = {
    minX: Math.min(...affectedCoords.map(([x]) => x)),
    maxX: Math.max(...affectedCoords.map(([x]) => x)),
    minY: Math.min(...affectedCoords.map(([, y]) => y)),
    maxY: Math.max(...affectedCoords.map(([, y]) => y)),
    minZ: Math.min(...affectedCoords.map(([, , z]) => z)),
    maxZ: Math.max(...affectedCoords.map(([, , z]) => z)),
  };

  const candidates = styles.map((style) =>
    buildCandidate(model, validSelected, style, affectedCellKeys, affectedBrickIds, bounds, startedAt),
  );

  candidates.sort((a, b) => {
    if (a.style === 'balanced') return -1;
    if (b.style === 'balanced') return 1;
    return a.metrics.brickCountAfter - b.metrics.brickCountAfter;
  });

  return { candidates };
}
