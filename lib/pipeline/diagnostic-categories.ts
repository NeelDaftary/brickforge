import type { ModelDiagnostics } from './model-diagnostics';
import type { GraphDiagnosticBrickIds } from '@/lib/pipeline_v2/brick-graph';

export type DiagnosticCategoryKey = keyof GraphDiagnosticBrickIds;
export type DiagnosticOverlayMode = 'auto' | 'off' | DiagnosticCategoryKey;

export interface DiagnosticCategoryDefinition {
  key: DiagnosticCategoryKey;
  label: string;
  shortLabel: string;
  layoutKey?: keyof NonNullable<ModelDiagnostics['layout']>;
  severity: 'danger' | 'warning' | 'info';
}

export const DIAGNOSTIC_CATEGORIES: readonly DiagnosticCategoryDefinition[] = [
  { key: 'detachedFloating', label: 'Detached floating', shortLabel: 'Detached', layoutKey: 'detachedFloatingBricks', severity: 'danger' },
  { key: 'unsupported', label: 'Unsupported', shortLabel: 'Unsupported', layoutKey: 'unsupportedBricks', severity: 'danger' },
  { key: 'criticalCantilever', label: 'Critical cantilevers', shortLabel: 'Critical', layoutKey: 'criticalCantileverRegions', severity: 'danger' },
  { key: 'weakCantilever', label: 'Weak cantilevers', shortLabel: 'Weak', layoutKey: 'weakCantilevers', severity: 'danger' },
  { key: 'oracle', label: 'Oracle failures', shortLabel: 'Oracle', severity: 'danger' },
  { key: 'articulation', label: 'Articulations', shortLabel: 'Joint', layoutKey: 'articulationBricks', severity: 'warning' },
  { key: 'bridge', label: 'Bridge edges', shortLabel: 'Bridge', layoutKey: 'bridgeEdges', severity: 'warning' },
  { key: 'attachedCantilever', label: 'Attached cantilevers', shortLabel: 'Attached', layoutKey: 'attachedCantileverBricks', severity: 'info' },
  { key: 'supportedCantilever', label: 'Supported cantilevers', shortLabel: 'Cantilever', layoutKey: 'supportedCantilevers', severity: 'info' },
  { key: 'internalSupport', label: 'Internal supports', shortLabel: 'Int support', layoutKey: 'internalSupportVoxels', severity: 'info' },
] as const;

export const DIAGNOSTIC_CATEGORY_KEYS = DIAGNOSTIC_CATEGORIES.map((category) => category.key);
export const DIAGNOSTIC_OVERLAY_MODES: DiagnosticOverlayMode[] = ['off', 'auto', ...DIAGNOSTIC_CATEGORY_KEYS];

export function diagnosticCount(
  mode: DiagnosticOverlayMode,
  ids?: Partial<GraphDiagnosticBrickIds>,
): number {
  if (mode === 'auto' || mode === 'off') return 0;
  return ids?.[mode]?.length ?? 0;
}

export function diagnosticShortLabel(mode: DiagnosticOverlayMode): string {
  if (mode === 'off') return 'Off';
  if (mode === 'auto') return 'Auto';
  return DIAGNOSTIC_CATEGORIES.find((category) => category.key === mode)?.shortLabel ?? mode;
}

export function activeDiagnosticOverlay(
  mode: DiagnosticOverlayMode,
  ids?: Partial<GraphDiagnosticBrickIds>,
): DiagnosticOverlayMode {
  if (mode !== 'auto') return mode;
  return DIAGNOSTIC_CATEGORY_KEYS.find((key) => diagnosticCount(key, ids) > 0) ?? 'off';
}

export function isDangerousDiagnosticOverlay(mode: DiagnosticOverlayMode): boolean {
  if (mode === 'auto' || mode === 'off') return false;
  return DIAGNOSTIC_CATEGORIES.find((category) => category.key === mode)?.severity === 'danger';
}

export function buildHealthMetrics(layout: NonNullable<ModelDiagnostics['layout']>) {
  const repeatedSeams = layout.seamAlignment?.repeatedAdjacentLayerSeams ?? 0;
  return [
    ...DIAGNOSTIC_CATEGORIES
      .filter((category) => category.layoutKey)
      .map((category) => ({
        label: category.label,
        value: Number(layout[category.layoutKey as keyof typeof layout] ?? 0),
      })),
    { label: 'Repeated seams', value: repeatedSeams },
  ];
}
