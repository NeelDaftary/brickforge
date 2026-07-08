import type { BrickModelData } from '@/lib/engine/types';
import type { BrickerVariant } from '@/lib/pipeline_v2/variants';

export interface ModelDiagnostics {
  pipeline?: string;
  timingMs?: number;
  voxelSize?: number;
  gridSize?: number;
  voxelLayers?: number;
  totalBricks?: number;
  shelled?: boolean;
  brickerEngine?: BrickerVariant;
  shadowComparison?: {
    compared?: boolean;
    primaryBricks?: number;
    shadowBricks?: number;
    primaryUnsupportedBricks?: number;
    shadowUnsupportedBricks?: number;
  };
  color?: {
    sourceType?: string;
    confidence?: number;
    achromaticRatio?: number;
    paletteEntropy?: number;
    warnings?: string[];
  };
  layout?: {
    connectedComponents?: number;
    floatingBricks?: number;
    detachedFloatingBricks?: number;
    unsupportedBricks?: number;
    attachedCantileverBricks?: number;
    criticalCantileverRegions?: number;
    loadWeightedUnsupportedPct?: number;
    supportedCantilevers?: number;
    weakCantilevers?: number;
    articulationBricks?: number;
    bridgeEdges?: number;
    internalSupportBricks?: number;
    internalSupportVoxels?: number;
    healthScore?: number;
    gateStatus?: 'pass' | 'warn' | 'fail';
    seamAlignment?: {
      repeatedAdjacentLayerSeams?: number;
      maxVerticalRun?: number;
    };
  };
  layoutIds?: {
    floating?: string[];
    detachedFloating?: string[];
    unsupported?: string[];
    attachedCantilever?: string[];
    criticalCantilever?: string[];
    weakCantilever?: string[];
    supportedCantilever?: string[];
    articulation?: string[];
    bridge?: string[];
    internalSupport?: string[];
  };
  stabilityV2?: {
    repair?: {
      iterations?: number;
      acceptedPatches?: number;
      rejectedPatches?: number;
      elapsedMs?: number;
    };
    internalSupport?: {
      internalSupportBricks?: number;
      internalSupportVoxels?: number;
      supportAddedReason?: string;
    };
  };
  warnings?: string[];
}

export interface GeneratedModel extends BrickModelData {
  diagnostics?: ModelDiagnostics;
}

export function layoutWarningIsCoveredByHealthPanel(warning: string): boolean {
  return warning.startsWith('Stability:') ||
    warning.startsWith('Stability V2:') ||
    warning.startsWith('Shadow compare');
}
