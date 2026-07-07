'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildGuidedRepairIssues, type GuidedRepairIssue, type GuidedRepairSuggestion } from '@/lib/pipeline_v2/guided-repair';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';

function RepairMetricDelta({
  label,
  before,
  after,
}: {
  label: string;
  before: number;
  after: number;
}) {
  const improved = after < before;
  const worsened = after > before;
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.5px] text-[#888888] truncate">{label}</div>
      <div className={`text-sm font-bold ${improved ? 'text-[#2E7D32]' : worsened ? 'text-[#B71C1C]' : 'text-[#444444]'}`}>
        {before} &rarr; {after}
      </div>
    </div>
  );
}

function RepairSuggestionCard({
  suggestion,
  onApply,
  isApplying,
  isBusy,
}: {
  suggestion: GuidedRepairSuggestion;
  onApply: (suggestion: GuidedRepairSuggestion) => Promise<void>;
  isApplying: boolean;
  isBusy: boolean;
}) {
  const applicationLabel = suggestion.application === 'rebrick'
    ? 'Applies by rebricking the edited source grid.'
    : 'Applies as a direct brick edit fallback.';

  return (
    <div className="border border-[#E4E2DA] rounded-lg px-3 py-3 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-[#1A1A1A]">{suggestion.title}</div>
          <div className="mt-1 text-xs leading-snug text-[#666666]">{suggestion.description}</div>
          <div className="mt-1 text-[11px] leading-snug text-[#8A5A00]">{suggestion.tradeoff}</div>
          <div className="mt-1 text-[11px] leading-snug text-[#777777]">{applicationLabel}</div>
        </div>
        <button
          onClick={() => void onApply(suggestion)}
          disabled={isBusy}
          className="shrink-0 px-3 py-2 text-xs font-bold text-white bg-brick-red rounded-lg hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isApplying ? 'Applying...' : 'Apply'}
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2">
        <RepairMetricDelta label="Floating" before={suggestion.before.floatingBricks} after={suggestion.after.floatingBricks} />
        <RepairMetricDelta label="Unsupported" before={suggestion.before.unsupportedBricks} after={suggestion.after.unsupportedBricks} />
        <RepairMetricDelta label="Weak" before={suggestion.before.weakCantilevers} after={suggestion.after.weakCantilevers} />
        <RepairMetricDelta label="Health" before={suggestion.before.healthScore} after={suggestion.after.healthScore} />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.5px] text-[#888888] truncate">
            {suggestion.application === 'rebrick' ? 'Added voxels' : 'Added bricks'}
          </div>
          <div className="text-sm font-bold text-[#444444]">
            +{suggestion.application === 'rebrick' ? suggestion.addedVoxels : suggestion.addedBricks}
          </div>
        </div>
      </div>
      {suggestion.application === 'rebrick' && (
        <div className="mt-2 text-[11px] leading-snug text-[#777777]">
          Estimated preview. Final diagnostics are recalculated after the source grid is rebricked.
        </div>
      )}
    </div>
  );
}

export function GuidedRepairQueue({
  model,
  onApply,
  onFocusBrickIds,
}: {
  model: GeneratedModel;
  onApply: (model: GeneratedModel) => void;
  onFocusBrickIds: (ids: string[]) => void;
}) {
  const issues = useMemo(() => buildGuidedRepairIssues(model), [model]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);
  const activeIssue: GuidedRepairIssue | undefined = issues[Math.min(activeIndex, Math.max(issues.length - 1, 0))];

  useEffect(() => {
    setActiveIndex(0);
  }, [model]);

  useEffect(() => {
    if (activeIndex >= issues.length) setActiveIndex(Math.max(0, issues.length - 1));
  }, [activeIndex, issues.length]);

  useEffect(() => {
    onFocusBrickIds(activeIssue?.targetBrickIds ?? []);
    return () => onFocusBrickIds([]);
  }, [activeIssue, onFocusBrickIds]);

  async function handleApply(suggestion: GuidedRepairSuggestion) {
    setRepairError(null);
    setApplyingId(suggestion.id);

    try {
      if (suggestion.application === 'rebrick' && suggestion.editedVoxelData) {
        const res = await fetch('/api/voxelize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voxelData: {
              grid: suggestion.editedVoxelData.grid,
              color_legend: suggestion.editedVoxelData.colorLegend,
            },
            voxelSize: model.diagnostics?.voxelSize ?? 0.06,
            name: model.name,
            description: model.description,
            shell: true,
            brickerEngine: 'stability_v2',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Repair rebrick failed');
        onApply(data as GeneratedModel);
        return;
      }

      onApply(suggestion.afterModel as GeneratedModel);
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : 'Repair failed');
    } finally {
      setApplyingId(null);
    }
  }

  if (issues.length === 0 || !activeIssue) return null;

  return (
    <div className="w-full border border-[#E0DFD9] rounded-lg px-4 py-3 bg-[#FAFAF7]">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[1px] text-[#555555]">Guided Repair Queue</div>
          <div className="text-[12px] text-[#777777] mt-0.5">
            Work from the lowest unresolved issue upward.
          </div>
        </div>
        <span className="text-[11px] font-semibold text-[#8A5A00] bg-[#FFF8E1] border border-[#FFE082] rounded-full px-2 py-1">
          Bottom-up
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 mb-3 border border-[#E4E2DA] rounded-lg px-3 py-2 bg-white">
        <button
          onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
          disabled={activeIndex === 0 || applyingId !== null}
          className="px-3 py-1.5 text-xs font-bold border border-[#DDDDDD] rounded-lg text-[#555555] disabled:opacity-40 disabled:cursor-not-allowed hover:border-brick-red"
        >
          Previous
        </button>
        <div className="min-w-0 text-center">
          <div className="text-[11px] font-bold uppercase tracking-[0.8px] text-[#777777]">
            Issue {Math.min(activeIndex + 1, issues.length)} of {issues.length}
          </div>
          <div className="text-sm font-bold text-[#1A1A1A] truncate">{activeIssue.title}</div>
          <div className="text-[11px] leading-snug text-[#777777] truncate">{activeIssue.description}</div>
        </div>
        <button
          onClick={() => setActiveIndex((index) => Math.min(issues.length - 1, index + 1))}
          disabled={activeIndex >= issues.length - 1 || applyingId !== null}
          className="px-3 py-1.5 text-xs font-bold border border-[#DDDDDD] rounded-lg text-[#555555] disabled:opacity-40 disabled:cursor-not-allowed hover:border-brick-red"
        >
          Next
        </button>
      </div>

      {activeIssue.suggestions.length > 0 ? (
        <div className="grid gap-2">
          {activeIssue.suggestions.map((suggestion) => (
            <RepairSuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              onApply={handleApply}
              isApplying={applyingId === suggestion.id}
              isBusy={applyingId !== null}
            />
          ))}
        </div>
      ) : (
        <div className="border border-[#E4E2DA] rounded-lg px-3 py-3 bg-white text-[12px] leading-snug text-[#666666]">
          No one-click structural edit is available for this issue yet. Inspect it in the viewer, use manual build/paint if needed, or move to the next issue.
        </div>
      )}

      {repairError && (
        <div className="mt-3 text-[12px] leading-snug text-[#B71C1C]">
          {repairError}
        </div>
      )}
    </div>
  );
}
