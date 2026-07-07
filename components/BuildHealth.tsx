import {
  buildReadinessStatus,
  prototypeUnsupportedLimit,
  prototypeWeakLimit,
} from '@/lib/pipeline/build-readiness';
import type { ModelDiagnostics } from '@/lib/pipeline/model-diagnostics';

export function BuildHealth({ diagnostics }: { diagnostics?: ModelDiagnostics }) {
  const layout = diagnostics?.layout;
  if (!layout) return null;

  const totalBricks = diagnostics?.totalBricks ?? 0;
  const unsupported = layout.unsupportedBricks ?? 0;
  const floating = layout.floatingBricks ?? 0;
  const weak = layout.weakCantilevers ?? 0;
  const unsupportedLimit = prototypeUnsupportedLimit(totalBricks);
  const weakLimit = prototypeWeakLimit(totalBricks);
  const readiness = buildReadinessStatus({ totalBricks, floating, unsupported, weak });
  const readinessLabel = readiness === 'ready'
    ? 'Ready to build'
    : readiness === 'prototype'
      ? 'Prototype-ready'
      : 'Needs repair';
  const statusClass = readiness === 'ready'
    ? 'bg-[#E8F5E9] text-[#2E7D32] border-[#C8E6C9]'
    : readiness === 'needs_repair'
      ? 'bg-[#FFEBEE] text-[#B71C1C] border-[#FFCDD2]'
      : 'bg-[#FFF8E1] text-[#8A5A00] border-[#FFE082]';
  const guidance = readiness === 'ready'
    ? 'No floating or unsupported bricks detected. This is a good candidate for a physical build.'
    : readiness === 'prototype'
      ? `Floating is zero and unsupported is within the prototype limit (${unsupported}/${unsupportedLimit}). Inspect weak spots before building.`
      : floating > 0
        ? 'Floating bricks remain. Add internal/external support, increase scale, thicken geometry, or reorient before building.'
        : `Unsupported or weak spots exceed the prototype limits (${unsupported}/${unsupportedLimit} unsupported, ${weak}/${weakLimit} weak).`;

  const metrics = [
    ['Unsupported', unsupported],
    ['Floating', floating],
    ['Weak cantilevers', weak],
    ['Supported cantilevers', layout.supportedCantilevers ?? 0],
    ['Articulations', layout.articulationBricks ?? 0],
    ['Repeated seams', layout.seamAlignment?.repeatedAdjacentLayerSeams ?? 0],
    ['Internal supports', layout.internalSupportVoxels ?? 0],
  ];

  return (
    <div className={`w-full border rounded-lg px-4 py-3 ${statusClass}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-xs font-bold uppercase tracking-[1px]">Build Health</span>
        <span className="text-xs font-bold uppercase">{readinessLabel}</span>
      </div>
      <div className="mb-3 text-[12px] leading-snug opacity-85">
        {guidance}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {metrics.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.5px] opacity-75 truncate">{label}</div>
            <div className="text-sm font-bold">{value}</div>
          </div>
        ))}
      </div>
      {diagnostics?.stabilityV2?.repair && (
        <div className="mt-2 text-[11px] opacity-80">
          Repair: {diagnostics.stabilityV2.repair.acceptedPatches ?? 0} accepted / {diagnostics.stabilityV2.repair.iterations ?? 0} attempted
        </div>
      )}
      {diagnostics?.shadowComparison?.compared && (
        <div className="mt-1 text-[11px] opacity-80">
          Legacy compare: {diagnostics.shadowComparison.shadowUnsupportedBricks ?? 0} unsupported vs {diagnostics.shadowComparison.primaryUnsupportedBricks ?? 0} in this build
        </div>
      )}
    </div>
  );
}
