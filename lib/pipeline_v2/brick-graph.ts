import type { BrickInstance } from '@/lib/engine/types';

export interface GraphBrick {
  id: string;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  color: string;
  area: number;
  source: BrickInstance;
}

export interface ConnectionEdge {
  from: string;
  to: string;
  type: 'root' | 'vertical' | 'horizontal';
  weight: number;
}

export interface BrickSupportDiagnostic {
  brickId: string;
  supportRatio: number;
  supportedStuds: number;
  totalStuds: number;
  overhangStuds: number;
  longestUnsupportedRun: number;
  classification: 'grounded' | 'unsupported' | 'supported_cantilever' | 'weak_cantilever' | 'stable';
}

export interface BrickGraph {
  bricks: GraphBrick[];
  edges: ConnectionEdge[];
  support: Map<string, BrickSupportDiagnostic>;
  cellToBrick: Map<string, string>;
}

export interface GraphDiagnostics {
  brickCount: number;
  connectedComponents: string[][];
  anchoredBrickIds: Set<string>;
  floatingBrickIds: Set<string>;
  articulationBrickIds: Set<string>;
  bridgeEdges: ConnectionEdge[];
  unsupportedBrickIds: Set<string>;
  cantileveredBrickIds: Set<string>;
  weakCantileverBrickIds: Set<string>;
  support: Map<string, BrickSupportDiagnostic>;
  loadAbove: Map<string, { dependentBrickCount: number; loadAboveStuds: number }>;
  seamAlignment: {
    totalSeams: number;
    repeatedAdjacentLayerSeams: number;
    maxVerticalRun: number;
  };
  weakRegions: WeakRegionDiagnostic[];
}

export interface GraphDiagnosticsSummary {
  connectedComponents: number;
  largestComponentBricks: number;
  floatingBricks: number;
  unsupportedBricks: number;
  supportedCantilevers: number;
  weakCantilevers: number;
  articulationBricks: number;
  bridgeEdges: number;
  maxLoadAboveStuds: number;
  internalSupportBricks: number;
  internalSupportVoxels: number;
  healthScore: number;
  gateStatus: 'pass' | 'warn' | 'fail';
  seamAlignment: GraphDiagnostics['seamAlignment'];
}

export interface GraphDiagnosticBrickIds {
  floating: string[];
  unsupported: string[];
  weakCantilever: string[];
  supportedCantilever: string[];
  articulation: string[];
  bridge: string[];
  internalSupport: string[];
  oracle: string[];
}

export interface AttachmentTree {
  parentByBrickId: Map<string, string>;
  childrenByBrickId: Map<string, Set<string>>;
}

export type WeakRegionType = 'floating' | 'unsupported' | 'weak_cantilever' | 'articulation' | 'bridge';

export interface WeakRegionDiagnostic {
  defectType: WeakRegionType;
  primaryBrickId: string;
  severity: [number, number, number, number];
  loadAboveStuds: number;
  affectedSubtreeSize: number;
  suggestedRepairRadius: { xy: number; z: number };
}

const ROOT_ID = '__root__';

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function edgeKey(a: string, b: string, type: ConnectionEdge['type']): string {
  return `${type}:${a < b ? `${a}|${b}` : `${b}|${a}`}`;
}

function toGraphBrick(brick: BrickInstance): GraphBrick {
  const x = brick.metadata?.gx ?? Math.round(brick.position[0]);
  const y = brick.metadata?.gz ?? Math.round(brick.position[2]);
  const z = brick.metadata?.gy ?? Math.round(brick.position[1] / 3);
  const w = brick.metadata?.gw ?? brick.studWidth ?? 1;
  const d = brick.metadata?.gd ?? brick.studDepth ?? 1;

  return {
    id: brick.id,
    x,
    y,
    z,
    w,
    d,
    color: brick.color,
    area: w * d,
    source: brick,
  };
}

function occupiedCells(brick: GraphBrick): string[] {
  const cells: string[] = [];
  for (let dx = 0; dx < brick.w; dx++) {
    for (let dy = 0; dy < brick.d; dy++) {
      cells.push(key(brick.x + dx, brick.y + dy, brick.z));
    }
  }
  return cells;
}

function longestUnsupportedRun(brick: GraphBrick, supported: Set<string>): number {
  let longest = 0;

  for (let dy = 0; dy < brick.d; dy++) {
    let run = 0;
    for (let dx = 0; dx < brick.w; dx++) {
      const cellKey = `${brick.x + dx},${brick.y + dy}`;
      run = supported.has(cellKey) ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
  }

  for (let dx = 0; dx < brick.w; dx++) {
    let run = 0;
    for (let dy = 0; dy < brick.d; dy++) {
      const cellKey = `${brick.x + dx},${brick.y + dy}`;
      run = supported.has(cellKey) ? 0 : run + 1;
      longest = Math.max(longest, run);
    }
  }

  return longest;
}

function classifySupport(
  brick: GraphBrick,
  supportedStuds: number,
  longestRun: number,
): BrickSupportDiagnostic['classification'] {
  if (brick.z === 0) return 'grounded';
  if (supportedStuds === 0) return 'unsupported';

  const ratio = supportedStuds / brick.area;
  if (ratio < 0.25 || longestRun > Math.max(2, Math.ceil(Math.max(brick.w, brick.d) / 2))) {
    return 'weak_cantilever';
  }
  if (supportedStuds < brick.area) return 'supported_cantilever';
  return 'stable';
}

export function buildBrickGraph(bricks: BrickInstance[]): BrickGraph {
  const graphBricks = bricks.map(toGraphBrick);
  const cellToBrick = new Map<string, string>();

  for (const brick of graphBricks) {
    for (const cell of occupiedCells(brick)) {
      cellToBrick.set(cell, brick.id);
    }
  }

  const edgesByKey = new Map<string, ConnectionEdge>();
  const addEdge = (from: string, to: string, type: ConnectionEdge['type'], weight = 1) => {
    const id = edgeKey(from, to, type);
    const existing = edgesByKey.get(id);
    if (existing) {
      existing.weight += weight;
      return;
    }
    edgesByKey.set(id, { from, to, type, weight });
  };

  const support = new Map<string, BrickSupportDiagnostic>();

  for (const brick of graphBricks) {
    if (brick.z === 0) {
      addEdge(ROOT_ID, brick.id, 'root', brick.area);
    }

    const supportedCells = new Set<string>();

    for (let dx = 0; dx < brick.w; dx++) {
      for (let dy = 0; dy < brick.d; dy++) {
        const x = brick.x + dx;
        const y = brick.y + dy;
        const below = cellToBrick.get(key(x, y, brick.z - 1));
        if (below && below !== brick.id) {
          supportedCells.add(`${x},${y}`);
          addEdge(below, brick.id, 'vertical');
        }

        const east = cellToBrick.get(key(x + 1, y, brick.z));
        if (east && east !== brick.id) addEdge(brick.id, east, 'horizontal');

        const north = cellToBrick.get(key(x, y + 1, brick.z));
        if (north && north !== brick.id) addEdge(brick.id, north, 'horizontal');
      }
    }

    const supportedStuds = brick.z === 0 ? brick.area : supportedCells.size;
    const longestRun = brick.z === 0 ? 0 : longestUnsupportedRun(brick, supportedCells);
    const classification = classifySupport(brick, supportedStuds, longestRun);

    support.set(brick.id, {
      brickId: brick.id,
      supportRatio: supportedStuds / brick.area,
      supportedStuds,
      totalStuds: brick.area,
      overhangStuds: brick.area - supportedStuds,
      longestUnsupportedRun: longestRun,
      classification,
    });
  }

  return {
    bricks: graphBricks,
    edges: [...edgesByKey.values()],
    support,
    cellToBrick,
  };
}

function structuralAdjacency(graph: BrickGraph): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const ensure = (id: string) => {
    let set = adjacency.get(id);
    if (!set) {
      set = new Set<string>();
      adjacency.set(id, set);
    }
    return set;
  };

  ensure(ROOT_ID);
  for (const brick of graph.bricks) ensure(brick.id);

  for (const edge of graph.edges) {
    if (edge.type === 'horizontal') continue;
    ensure(edge.from).add(edge.to);
    ensure(edge.to).add(edge.from);
  }

  return adjacency;
}

function connectedFromRoot(adjacency: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>();
  const stack = [ROOT_ID];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (!seen.has(next)) stack.push(next);
    }
  }
  seen.delete(ROOT_ID);
  return seen;
}

function connectedComponents(graph: BrickGraph, adjacency: Map<string, Set<string>>): string[][] {
  const components: string[][] = [];
  const seen = new Set<string>([ROOT_ID]);

  for (const brick of graph.bricks) {
    if (seen.has(brick.id)) continue;
    const component: string[] = [];
    const stack = [brick.id];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      component.push(id);
      for (const next of adjacency.get(id) ?? []) {
        if (!seen.has(next) && next !== ROOT_ID) stack.push(next);
      }
    }
    components.push(component);
  }

  return components;
}

function articulationAndBridges(
  adjacency: Map<string, Set<string>>,
  edgeLookup: Map<string, ConnectionEdge>,
): { articulations: Set<string>; bridges: ConnectionEdge[] } {
  const visited = new Set<string>();
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const articulations = new Set<string>();
  const bridges: ConnectionEdge[] = [];
  let time = 0;

  const dfs = (u: string) => {
    visited.add(u);
    disc.set(u, ++time);
    low.set(u, disc.get(u)!);
    let childCount = 0;

    for (const v of adjacency.get(u) ?? []) {
      if (!visited.has(v)) {
        parent.set(v, u);
        childCount++;
        dfs(v);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));

        if (parent.get(u) == null && childCount > 1 && u !== ROOT_ID) articulations.add(u);
        if (parent.get(u) != null && low.get(v)! >= disc.get(u)! && u !== ROOT_ID) articulations.add(u);

        if (low.get(v)! > disc.get(u)!) {
          const edge = edgeLookup.get(edgeKey(u, v, 'vertical')) ?? edgeLookup.get(edgeKey(u, v, 'root'));
          if (edge && edge.type !== 'root') bridges.push(edge);
        }
      } else if (v !== parent.get(u)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  };

  parent.set(ROOT_ID, null);
  dfs(ROOT_ID);

  for (const id of adjacency.keys()) {
    if (!visited.has(id)) {
      parent.set(id, null);
      dfs(id);
    }
  }

  return { articulations, bridges };
}

function computeLoadAbove(graph: BrickGraph): Map<string, { dependentBrickCount: number; loadAboveStuds: number }> {
  const upward = new Map<string, Set<string>>();
  const area = new Map(graph.bricks.map((brick) => [brick.id, brick.area]));

  for (const brick of graph.bricks) upward.set(brick.id, new Set<string>());
  for (const edge of graph.edges) {
    if (edge.type !== 'vertical') continue;
    const from = graph.bricks.find((brick) => brick.id === edge.from);
    const to = graph.bricks.find((brick) => brick.id === edge.to);
    if (!from || !to) continue;
    if (from.z < to.z) upward.get(from.id)?.add(to.id);
    else upward.get(to.id)?.add(from.id);
  }

  const result = new Map<string, { dependentBrickCount: number; loadAboveStuds: number }>();
  for (const brick of graph.bricks) {
    const seen = new Set<string>();
    const stack = [...(upward.get(brick.id) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const next of upward.get(id) ?? []) stack.push(next);
    }
    let loadAboveStuds = 0;
    for (const id of seen) loadAboveStuds += area.get(id) ?? 0;
    result.set(brick.id, { dependentBrickCount: seen.size, loadAboveStuds });
  }
  return result;
}

function seamKeysForLayer(graph: BrickGraph, z: number): Set<string> {
  const seams = new Set<string>();
  const layerCells = new Map<string, string>();

  for (const brick of graph.bricks) {
    if (brick.z !== z) continue;
    for (let dx = 0; dx < brick.w; dx++) {
      for (let dy = 0; dy < brick.d; dy++) {
        layerCells.set(`${brick.x + dx},${brick.y + dy}`, brick.id);
      }
    }
  }

  for (const [cell, id] of layerCells) {
    const [xRaw, yRaw] = cell.split(',');
    const x = Number(xRaw);
    const y = Number(yRaw);
    const east = layerCells.get(`${x + 1},${y}`);
    if (east && east !== id) seams.add(`x:${x + 1}:y${y}`);
    const north = layerCells.get(`${x},${y + 1}`);
    if (north && north !== id) seams.add(`y:${y + 1}:x${x}`);
  }

  return seams;
}

function computeSeamAlignment(graph: BrickGraph): GraphDiagnostics['seamAlignment'] {
  const layerIds = [...new Set(graph.bricks.map((brick) => brick.z))].sort((a, b) => a - b);
  const byLayer = new Map<number, Set<string>>();
  let totalSeams = 0;

  for (const z of layerIds) {
    const seams = seamKeysForLayer(graph, z);
    byLayer.set(z, seams);
    totalSeams += seams.size;
  }

  let repeatedAdjacentLayerSeams = 0;
  const runBySeam = new Map<string, number>();
  let maxVerticalRun = 0;

  for (const z of layerIds) {
    const seams = byLayer.get(z) ?? new Set<string>();
    const prev = byLayer.get(z - 1) ?? new Set<string>();
    const nextRun = new Map<string, number>();

    for (const seam of seams) {
      if (prev.has(seam)) repeatedAdjacentLayerSeams++;
      const run = (prev.has(seam) ? runBySeam.get(seam) ?? 1 : 0) + 1;
      nextRun.set(seam, run);
      maxVerticalRun = Math.max(maxVerticalRun, run);
    }

    runBySeam.clear();
    for (const [seam, run] of nextRun) runBySeam.set(seam, run);
  }

  return { totalSeams, repeatedAdjacentLayerSeams, maxVerticalRun };
}

export function buildAttachmentTree(graph: BrickGraph): AttachmentTree {
  const byId = new Map(graph.bricks.map((brick) => [brick.id, brick]));
  const parentByBrickId = new Map<string, string>();
  const childrenByBrickId = new Map<string, Set<string>>();
  const ensureChildren = (id: string) => {
    let children = childrenByBrickId.get(id);
    if (!children) {
      children = new Set<string>();
      childrenByBrickId.set(id, children);
    }
    return children;
  };

  ensureChildren(ROOT_ID);
  for (const brick of graph.bricks) ensureChildren(brick.id);

  for (const brick of graph.bricks) {
    if (brick.z === 0) {
      parentByBrickId.set(brick.id, ROOT_ID);
      ensureChildren(ROOT_ID).add(brick.id);
      continue;
    }

    let bestParent: { id: string; weight: number } | null = null;
    for (const edge of graph.edges) {
      if (edge.type !== 'vertical') continue;
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) continue;
      const parent = from.z < to.z ? from : to;
      const child = from.z < to.z ? to : from;
      if (child.id !== brick.id) continue;
      if (!bestParent || edge.weight > bestParent.weight) bestParent = { id: parent.id, weight: edge.weight };
    }

    if (bestParent) {
      parentByBrickId.set(brick.id, bestParent.id);
      ensureChildren(bestParent.id).add(brick.id);
    }
  }

  return { parentByBrickId, childrenByBrickId };
}

export function descendantIds(tree: AttachmentTree, brickId: string): Set<string> {
  const descendants = new Set<string>();
  const stack = [...(tree.childrenByBrickId.get(brickId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (descendants.has(id)) continue;
    descendants.add(id);
    for (const child of tree.childrenByBrickId.get(id) ?? []) stack.push(child);
  }
  return descendants;
}

export function rankWeakRegions(graph: BrickGraph, diagnostics = analyzeBrickGraph(graph)): WeakRegionDiagnostic[] {
  const tree = buildAttachmentTree(graph);
  const byId = new Map(graph.bricks.map((brick) => [brick.id, brick]));
  const regions = new Map<string, WeakRegionDiagnostic>();

  const addRegion = (defectType: WeakRegionType, id: string, priority: number) => {
    const brick = byId.get(id);
    if (!brick) return;
    const loadAboveStuds = diagnostics.loadAbove.get(id)?.loadAboveStuds ?? 0;
    const affectedSubtreeSize = descendantIds(tree, id).size;
    const support = diagnostics.support.get(id);
    const supportPenalty = support ? Math.round((1 - support.supportRatio) * 100) : 100;
    const region: WeakRegionDiagnostic = {
      defectType,
      primaryBrickId: id,
      severity: [priority, loadAboveStuds, affectedSubtreeSize, supportPenalty],
      loadAboveStuds,
      affectedSubtreeSize,
      suggestedRepairRadius: {
        xy: Math.min(6, Math.max(3, Math.ceil(Math.max(brick.w, brick.d) / 2) + 2)),
        z: affectedSubtreeSize > 4 ? 2 : 1,
      },
    };
    const existing = regions.get(id);
    if (!existing || compareSeverity(region.severity, existing.severity) > 0) regions.set(id, region);
  };

  for (const id of diagnostics.floatingBrickIds) addRegion('floating', id, 5);
  for (const id of diagnostics.unsupportedBrickIds) addRegion('unsupported', id, 4);
  for (const id of diagnostics.weakCantileverBrickIds) addRegion('weak_cantilever', id, 3);
  for (const id of diagnostics.articulationBrickIds) addRegion('articulation', id, 2);
  for (const edge of diagnostics.bridgeEdges) {
    if (edge.from !== ROOT_ID) addRegion('bridge', edge.from, 1);
    if (edge.to !== ROOT_ID) addRegion('bridge', edge.to, 1);
  }

  return [...regions.values()].sort((a, b) => compareSeverity(b.severity, a.severity));
}

function compareSeverity(a: WeakRegionDiagnostic['severity'], b: WeakRegionDiagnostic['severity']): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function analyzeBrickGraph(input: BrickGraph | BrickInstance[]): GraphDiagnostics {
  const graph = Array.isArray(input) ? buildBrickGraph(input) : input;
  const adjacency = structuralAdjacency(graph);
  const edgeLookup = new Map(graph.edges.map((edge) => [edgeKey(edge.from, edge.to, edge.type), edge]));
  const anchoredBrickIds = connectedFromRoot(adjacency);
  const components = connectedComponents(graph, adjacency);
  const { articulations, bridges } = articulationAndBridges(adjacency, edgeLookup);

  const unsupportedBrickIds = new Set<string>();
  const cantileveredBrickIds = new Set<string>();
  const weakCantileverBrickIds = new Set<string>();

  for (const [id, support] of graph.support) {
    if (support.classification === 'unsupported') unsupportedBrickIds.add(id);
    if (support.classification === 'supported_cantilever') cantileveredBrickIds.add(id);
    if (support.classification === 'weak_cantilever') weakCantileverBrickIds.add(id);
  }

  const diagnostics: GraphDiagnostics = {
    brickCount: graph.bricks.length,
    connectedComponents: components,
    anchoredBrickIds,
    floatingBrickIds: new Set(graph.bricks.filter((brick) => !anchoredBrickIds.has(brick.id)).map((brick) => brick.id)),
    articulationBrickIds: articulations,
    bridgeEdges: bridges,
    unsupportedBrickIds,
    cantileveredBrickIds,
    weakCantileverBrickIds,
    support: graph.support,
    loadAbove: computeLoadAbove(graph),
    seamAlignment: computeSeamAlignment(graph),
    weakRegions: [],
  };
  diagnostics.weakRegions = rankWeakRegions(graph, diagnostics);
  return diagnostics;
}

export function scoreGraphDiagnostics(diagnostics: Pick<GraphDiagnosticsSummary,
  'floatingBricks' | 'unsupportedBricks' | 'weakCantilevers' | 'articulationBricks' | 'bridgeEdges' | 'seamAlignment'
> & { brickCount?: number }): number {
  return (
    diagnostics.floatingBricks * 10000 +
    diagnostics.unsupportedBricks * 5000 +
    diagnostics.weakCantilevers * 800 +
    diagnostics.articulationBricks * 250 +
    diagnostics.bridgeEdges * 200 +
    diagnostics.seamAlignment.repeatedAdjacentLayerSeams * 2 +
    (diagnostics.brickCount ?? 0)
  );
}

function gateStatusFor(summary: Pick<GraphDiagnosticsSummary,
  'floatingBricks' | 'unsupportedBricks' | 'weakCantilevers' | 'articulationBricks' | 'bridgeEdges'
>): GraphDiagnosticsSummary['gateStatus'] {
  if (summary.floatingBricks > 0 || summary.unsupportedBricks > 0) return 'fail';
  if (summary.weakCantilevers > 0 || summary.articulationBricks > 0 || summary.bridgeEdges > 0) return 'warn';
  return 'pass';
}

export function summarizeGraphDiagnostics(
  diagnostics: GraphDiagnostics,
  extras: { internalSupportBricks?: number; internalSupportVoxels?: number } = {},
): GraphDiagnosticsSummary {
  let maxLoadAboveStuds = 0;
  for (const load of diagnostics.loadAbove.values()) {
    maxLoadAboveStuds = Math.max(maxLoadAboveStuds, load.loadAboveStuds);
  }

  const summary = {
    connectedComponents: diagnostics.connectedComponents.length,
    largestComponentBricks: Math.max(0, ...diagnostics.connectedComponents.map((component) => component.length)),
    floatingBricks: diagnostics.floatingBrickIds.size,
    unsupportedBricks: diagnostics.unsupportedBrickIds.size,
    supportedCantilevers: diagnostics.cantileveredBrickIds.size,
    weakCantilevers: diagnostics.weakCantileverBrickIds.size,
    articulationBricks: diagnostics.articulationBrickIds.size,
    bridgeEdges: diagnostics.bridgeEdges.length,
    maxLoadAboveStuds,
    internalSupportBricks: extras.internalSupportBricks ?? 0,
    internalSupportVoxels: extras.internalSupportVoxels ?? 0,
    healthScore: 0,
    gateStatus: 'pass' as GraphDiagnosticsSummary['gateStatus'],
    seamAlignment: diagnostics.seamAlignment,
  };
  summary.healthScore = scoreGraphDiagnostics({ ...summary, brickCount: diagnostics.brickCount });
  summary.gateStatus = gateStatusFor(summary);
  return summary;
}

export function summarizeGraphDiagnosticBrickIds(
  diagnostics: GraphDiagnostics,
  graph?: BrickGraph,
  oracleBrickIds: string[] = [],
): GraphDiagnosticBrickIds {
  const bridge = new Set<string>();
  for (const edge of diagnostics.bridgeEdges) {
    if (edge.from !== ROOT_ID) bridge.add(edge.from);
    if (edge.to !== ROOT_ID) bridge.add(edge.to);
  }

  return {
    floating: [...diagnostics.floatingBrickIds],
    unsupported: [...diagnostics.unsupportedBrickIds],
    weakCantilever: [...diagnostics.weakCantileverBrickIds],
    supportedCantilever: [...diagnostics.cantileveredBrickIds],
    articulation: [...diagnostics.articulationBrickIds],
    bridge: [...bridge],
    internalSupport: graph?.bricks
      .filter((brick) => brick.source.metadata?.internalSupport)
      .map((brick) => brick.id) ?? [],
    oracle: oracleBrickIds,
  };
}
