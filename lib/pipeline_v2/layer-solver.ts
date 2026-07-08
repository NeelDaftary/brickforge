import { BRICK_SIZES } from '@/lib/pipeline/voxel-to-bricks';
import { buildCandidateMaskIndex, type CandidateMaskIndex, type CandidateMaskPlacement } from './candidate-masks';

export interface SolvedBrick {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  color: string;
  internalSupport?: boolean;
}

export interface LayerSolveInput {
  grid: string[][][];
  z: number;
  colorLegend: Record<string, string>;
  wildcardColors: ReadonlyMap<string, string>;
  surfaceCells: ReadonlySet<string>;
  belowOwners: ReadonlyMap<string, string>;
  supportOptionalCells?: ReadonlySet<string>;
  nextGrid?: string[][][];
  useCandidateMasks?: boolean;
  beamWidth?: number;
  maxCandidatesPerCell?: number;
}

export interface LayerSolveResult {
  bricks: SolvedBrick[];
  stats: {
    filledCells: number;
    candidateBranches: number;
    fallbackPlacements: number;
    finalCost: number;
    candidateCount: number;
    candidateMaskMs: number;
    maskCheckedPlacements: number;
  };
}

interface Candidate extends SolvedBrick {
  cells: string[];
  cost: number;
}

interface SearchState {
  covered: Set<string>;
  bricks: SolvedBrick[];
  cost: number;
}

const DEFAULT_BEAM_WIDTH = 24;
const DEFAULT_MAX_CANDIDATES_PER_CELL = 14;
const WILDCARD = '*';

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function voxelKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function dims(grid: string[][][]): { sx: number; sy: number } {
  const sx = grid.length;
  const sy = sx > 0 ? grid[0].length : 0;
  return { sx, sy };
}

function resolveSymbol(
  grid: string[][][],
  x: number,
  y: number,
  z: number,
  wildcardColors: ReadonlyMap<string, string>,
): string {
  const symbol = grid[x][y][z];
  if (symbol !== WILDCARD) return symbol;
  return wildcardColors.get(voxelKey(x, y, z)) ?? 'G';
}

function candidateColor(
  grid: string[][][],
  cells: string[],
  z: number,
  colorLegend: Record<string, string>,
  wildcardColors: ReadonlyMap<string, string>,
  surfaceCells: ReadonlySet<string>,
): { color: string; mismatchCount: number; visibleCount: number } {
  const counts = new Map<string, number>();
  let visibleCount = 0;

  for (const cell of cells) {
    const [xRaw, yRaw] = cell.split(',');
    const x = Number(xRaw), y = Number(yRaw);
    const isSurface = surfaceCells.has(voxelKey(x, y, z));
    const raw = grid[x][y][z];
    if (!isSurface && raw === WILDCARD) continue;
    const symbol = resolveSymbol(grid, x, y, z, wildcardColors);
    counts.set(symbol, (counts.get(symbol) ?? 0) + (isSurface ? 2 : 1));
    if (isSurface) visibleCount++;
  }

  let bestSymbol = 'G';
  let bestCount = -1;
  for (const [symbol, count] of counts) {
    if (count > bestCount) {
      bestSymbol = symbol;
      bestCount = count;
    }
  }

  let mismatchCount = 0;
  for (const cell of cells) {
    const [xRaw, yRaw] = cell.split(',');
    const x = Number(xRaw), y = Number(yRaw);
    if (!surfaceCells.has(voxelKey(x, y, z)) && grid[x][y][z] === WILDCARD) continue;
    if (resolveSymbol(grid, x, y, z, wildcardColors) !== bestSymbol) mismatchCount++;
  }

  return { color: colorLegend[bestSymbol] ?? '#A0A5A9', mismatchCount, visibleCount };
}

function longestUnsupportedRun(
  x: number,
  y: number,
  w: number,
  d: number,
  supportedCells: ReadonlySet<string>,
): number {
  let longest = 0;
  for (let dy = 0; dy < d; dy++) {
    let run = 0;
    for (let dx = 0; dx < w; dx++) {
      run = supportedCells.has(key(x + dx, y + dy)) ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
  }
  for (let dx = 0; dx < w; dx++) {
    let run = 0;
    for (let dy = 0; dy < d; dy++) {
      run = supportedCells.has(key(x + dx, y + dy)) ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
  }
  return longest;
}

function supportCost(
  z: number,
  x: number,
  y: number,
  w: number,
  d: number,
  belowOwners: ReadonlyMap<string, string>,
): number {
  if (z === 0) return -2;

  const supportedCells = new Set<string>();
  const belowBrickIds = new Set<string>();
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < d; dy++) {
      const owner = belowOwners.get(key(x + dx, y + dy));
      if (!owner) continue;
      supportedCells.add(key(x + dx, y + dy));
      belowBrickIds.add(owner);
    }
  }

  const area = w * d;
  const supported = supportedCells.size;
  if (supported === 0) return 180 + area * 8;

  const ratio = supported / area;
  const overhang = area - supported;
  const longestRun = longestUnsupportedRun(x, y, w, d, supportedCells);

  let cost = 0;
  if (ratio < 0.25) cost += 90;
  else if (ratio < 0.5) cost += 28;
  else if (overhang > 0) cost += 5;
  else cost -= 3;

  cost += overhang * 1.5;
  cost += Math.max(0, longestRun - 2) * 9;

  // Reward bricks that tie multiple lower bricks together.
  if (belowBrickIds.size >= 2) cost -= 8 + Math.min(8, belowBrickIds.size * 2);

  return cost;
}

function futureSupportBonus(candidate: Omit<Candidate, 'cost'>, nextGrid?: string[][][]): number {
  if (!nextGrid) return 0;
  let supportedAbove = 0;
  const nextZ = candidate.z + 1;
  for (let dx = 0; dx < candidate.w; dx++) {
    for (let dy = 0; dy < candidate.d; dy++) {
      if (nextGrid[candidate.x + dx]?.[candidate.y + dy]?.[nextZ] !== '0') supportedAbove++;
    }
  }
  return Math.min(18, supportedAbove * 3);
}

function candidateCost(
  candidate: Omit<Candidate, 'cost'>,
  colorMismatchCount: number,
  visibleCount: number,
  belowOwners: ReadonlyMap<string, string>,
  nextGrid?: string[][][],
): number {
  const area = candidate.w * candidate.d;
  const largerBrickReward = Math.max(0, area - 1) * 1.2;
  const shapePenalty = Math.max(candidate.w, candidate.d) >= 8 ? 2 : 0;
  const colorPenalty = colorMismatchCount * (visibleCount > 0 ? 18 : 3);

  return 24 - largerBrickReward + shapePenalty + colorPenalty +
    supportCost(candidate.z, candidate.x, candidate.y, candidate.w, candidate.d, belowOwners) -
    futureSupportBonus(candidate, nextGrid);
}

function generateCandidatesForCell(
  input: LayerSolveInput,
  anchorX: number,
  anchorY: number,
  covered: ReadonlySet<string>,
  maskIndex?: CandidateMaskIndex,
): Candidate[] {
  if (input.useCandidateMasks && maskIndex) {
    return generateMaskedCandidatesForCell(input, anchorX, anchorY, covered, maskIndex);
  }

  const { sx, sy } = dims(input.grid);
  const candidates: Candidate[] = [];

  for (const [baseW, baseD] of BRICK_SIZES) {
    const orientations: [number, number][] = [[baseW, baseD]];
    if (baseW !== baseD) orientations.push([baseD, baseW]);

    for (const [w, d] of orientations) {
      for (let x = anchorX - w + 1; x <= anchorX; x++) {
        for (let y = anchorY - d + 1; y <= anchorY; y++) {
          if (x < 0 || y < 0 || x + w > sx || y + d > sy) continue;

          const cells: string[] = [];
          let valid = true;
          for (let dx = 0; dx < w && valid; dx++) {
            for (let dy = 0; dy < d && valid; dy++) {
              const cx = x + dx, cy = y + dy;
              const cellKey = key(cx, cy);
              if (covered.has(cellKey) || input.grid[cx][cy][input.z] === '0') {
                valid = false;
                break;
              }
              cells.push(cellKey);
            }
          }
          if (!valid) continue;

          const { color, mismatchCount, visibleCount } = candidateColor(
            input.grid,
            cells,
            input.z,
            input.colorLegend,
            input.wildcardColors,
            input.surfaceCells,
          );
          const candidate = { x, y, z: input.z, w, d, color, cells };
          candidates.push({
            ...candidate,
            cost: candidateCost(candidate, mismatchCount, visibleCount, input.belowOwners, input.nextGrid),
          });
        }
      }
    }
  }

  candidates.sort((a, b) => a.cost - b.cost || b.w * b.d - a.w * a.d);
  return candidates.slice(0, input.maxCandidatesPerCell ?? DEFAULT_MAX_CANDIDATES_PER_CELL);
}

function generateMaskedCandidatesForCell(
  input: LayerSolveInput,
  anchorX: number,
  anchorY: number,
  covered: ReadonlySet<string>,
  maskIndex: CandidateMaskIndex,
): Candidate[] {
  const candidates: Candidate[] = [];
  const placements = maskIndex.placementsByCell.get(key(anchorX, anchorY)) ?? [];

  for (const placement of placements) {
    if (placement.cells.some((cell) => covered.has(cell))) continue;

    const { color, mismatchCount, visibleCount } = candidateColor(
      input.grid,
      placement.cells,
      input.z,
      input.colorLegend,
      input.wildcardColors,
      input.surfaceCells,
    );
    const candidate = placementToCandidate(input.z, placement, color);
    candidates.push({
      ...candidate,
      cost: candidateCost(candidate, mismatchCount, visibleCount, input.belowOwners, input.nextGrid),
    });
  }

  candidates.sort((a, b) => a.cost - b.cost || b.w * b.d - a.w * a.d);
  return candidates.slice(0, input.maxCandidatesPerCell ?? DEFAULT_MAX_CANDIDATES_PER_CELL);
}

function placementToCandidate(z: number, placement: CandidateMaskPlacement, color: string): Omit<Candidate, 'cost'> {
  return {
    x: placement.x,
    y: placement.y,
    z,
    w: placement.w,
    d: placement.d,
    color,
    cells: placement.cells,
  };
}

function filledLayerCells(grid: string[][][], z: number): string[] {
  const { sx, sy } = dims(grid);
  const cells: string[] = [];
  for (let y = 0; y < sy; y++) {
    for (let x = 0; x < sx; x++) {
      if (grid[x][y][z] !== '0') cells.push(key(x, y));
    }
  }
  return cells;
}

function firstUncovered(
  cells: string[],
  covered: ReadonlySet<string>,
  belowOwners: ReadonlyMap<string, string>,
  z: number,
): [number, number] | null {
  let first: [number, number] | null = null;

  for (const cell of cells) {
    if (covered.has(cell)) continue;
    const [xRaw, yRaw] = cell.split(',');
    const x = Number(xRaw), y = Number(yRaw);
    if (!first) first = [x, y];
    if (z > 0 && !belowOwners.has(cell)) return [x, y];
  }
  return first;
}

export function solveLayer(input: LayerSolveInput): LayerSolveResult {
  const cells = filledLayerCells(input.grid, input.z);
  if (cells.length === 0) {
    return {
      bricks: [],
      stats: {
        filledCells: 0,
        candidateBranches: 0,
        fallbackPlacements: 0,
        finalCost: 0,
        candidateCount: 0,
        candidateMaskMs: 0,
        maskCheckedPlacements: 0,
      },
    };
  }

  const maskIndex = input.useCandidateMasks
    ? buildCandidateMaskIndex({
      grid: input.grid,
      z: input.z,
      belowOwners: input.belowOwners,
      surfaceCells: input.surfaceCells,
      supportOptionalCells: input.supportOptionalCells,
    })
    : undefined;
  const beamWidth = input.beamWidth ?? DEFAULT_BEAM_WIDTH;
  let states: SearchState[] = [{ covered: new Set<string>(), bricks: [], cost: 0 }];
  let candidateBranches = 0;
  let candidateCount = 0;
  let fallbackPlacements = 0;

  while (states.length > 0) {
    const complete = states.find((state) => state.covered.size === cells.length);
    if (complete) {
      return {
        bricks: complete.bricks,
        stats: {
          filledCells: cells.length,
          candidateBranches,
          fallbackPlacements,
          finalCost: complete.cost,
          candidateCount,
          candidateMaskMs: maskIndex?.stats.elapsedMs ?? 0,
          maskCheckedPlacements: maskIndex?.stats.checkedPlacements ?? 0,
        },
      };
    }

    const nextStates: SearchState[] = [];

    for (const state of states) {
      const anchor = firstUncovered(cells, state.covered, input.belowOwners, input.z);
      if (!anchor) {
        nextStates.push(state);
        continue;
      }

      const candidates = generateCandidatesForCell(input, anchor[0], anchor[1], state.covered, maskIndex);
      candidateBranches += candidates.length;
      candidateCount += candidates.length;

      const usable = candidates.length > 0
        ? candidates
        : [{
          x: anchor[0],
          y: anchor[1],
          z: input.z,
          w: 1,
          d: 1,
          color: candidateColor(input.grid, [key(anchor[0], anchor[1])], input.z, input.colorLegend, input.wildcardColors, input.surfaceCells).color,
          cells: [key(anchor[0], anchor[1])],
          cost: 250,
        }];
      if (candidates.length === 0) fallbackPlacements++;

      for (const candidate of usable) {
        const covered = new Set(state.covered);
        for (const cell of candidate.cells) covered.add(cell);
        nextStates.push({
          covered,
          bricks: [...state.bricks, {
            x: candidate.x,
            y: candidate.y,
            z: candidate.z,
            w: candidate.w,
            d: candidate.d,
            color: candidate.color,
          }],
          cost: state.cost + candidate.cost,
        });
      }
    }

    states = nextStates
      .sort((a, b) => a.cost - b.cost || a.bricks.length - b.bricks.length)
      .slice(0, beamWidth);
  }

  return {
    bricks: [],
    stats: {
      filledCells: cells.length,
      candidateBranches,
      fallbackPlacements,
      finalCost: Infinity,
      candidateCount,
      candidateMaskMs: maskIndex?.stats.elapsedMs ?? 0,
      maskCheckedPlacements: maskIndex?.stats.checkedPlacements ?? 0,
    },
  };
}

export function buildLayerOwners(bricks: readonly SolvedBrick[]): Map<string, string> {
  const owners = new Map<string, string>();
  bricks.forEach((brick, index) => {
    const id = `z${brick.z}-b${index}`;
    for (let dx = 0; dx < brick.w; dx++) {
      for (let dy = 0; dy < brick.d; dy++) {
        owners.set(key(brick.x + dx, brick.y + dy), id);
      }
    }
  });
  return owners;
}
