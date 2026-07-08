import { describe, expect, it } from 'vitest';
import {
  DIAGNOSTIC_CATEGORY_KEYS,
  activeDiagnosticOverlay,
  buildHealthMetrics,
  diagnosticCount,
  isDangerousDiagnosticOverlay,
} from './diagnostic-categories';

describe('diagnostic categories', () => {
  it('chooses the first populated diagnostic category for auto overlay', () => {
    expect(activeDiagnosticOverlay('auto', { unsupported: ['u1'], floating: ['f1'] })).toBe('floating');
    expect(activeDiagnosticOverlay('auto', { bridge: ['b1'] })).toBe('bridge');
    expect(activeDiagnosticOverlay('auto', {})).toBe('off');
  });

  it('counts ids and marks dangerous overlays consistently', () => {
    expect(DIAGNOSTIC_CATEGORY_KEYS).toContain('internalSupport');
    expect(diagnosticCount('unsupported', { unsupported: ['a', 'b'] })).toBe(2);
    expect(diagnosticCount('off', { unsupported: ['a'] })).toBe(0);
    expect(isDangerousDiagnosticOverlay('unsupported')).toBe(true);
    expect(isDangerousDiagnosticOverlay('internalSupport')).toBe(false);
  });

  it('builds health metrics from the layout summary', () => {
    const metrics = buildHealthMetrics({
      connectedComponents: 1,
      floatingBricks: 0,
      unsupportedBricks: 2,
      supportedCantilevers: 1,
      weakCantilevers: 0,
      articulationBricks: 1,
      bridgeEdges: 0,
      internalSupportBricks: 1,
      internalSupportVoxels: 3,
      healthScore: 10,
      gateStatus: 'warn',
      seamAlignment: { repeatedAdjacentLayerSeams: 2, maxVerticalRun: 1 },
    });

    expect(metrics).toContainEqual({ label: 'Unsupported', value: 2 });
    expect(metrics).toContainEqual({ label: 'Repeated seams', value: 2 });
  });
});
