'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';
import type {
  RepairPreferences,
  RepairPreview,
  RepairSuggestion,
  RepairSuggestionsResult,
  RepairWeakRegion,
} from '@/lib/pipeline_v2/guided-repair-v2';

const DEFAULT_PREFERENCES: RepairPreferences = {
  style: 'balanced',
  allowRecolor: true,
  preserveSymmetry: true,
  allowVisibleBoundaryEdits: true,
  showLastResortSupports: false,
};

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
  onPreview,
  onClearPreview,
  isApplying,
  isBusy,
}: {
  suggestion: RepairSuggestion;
  onApply: (suggestion: RepairSuggestion) => Promise<void>;
  onPreview: (suggestion: RepairSuggestion) => void;
  onClearPreview: () => void;
  isApplying: boolean;
  isBusy: boolean;
}) {
  const badge = suggestion.recommendation === 'recommended'
    ? 'Recommended'
    : suggestion.recommendation === 'last_resort'
      ? 'Last resort'
      : 'Alternative';

  return (
    <div
      className="border border-[#E4E2DA] rounded-lg px-3 py-3 bg-white hover:border-brick-red transition-colors"
      onMouseEnter={() => onPreview(suggestion)}
      onMouseLeave={onClearPreview}
    >
      <div className="grid gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-[0.7px] rounded-full px-2 py-0.5 ${
              suggestion.recommendation === 'recommended'
                ? 'bg-[#E8F5E9] text-[#2E7D32]'
                : suggestion.recommendation === 'last_resort'
                  ? 'bg-[#FFEBEE] text-[#B71C1C]'
                  : 'bg-[#F5F5F0] text-[#666666]'
            }`}>
              {badge}
            </span>
            <div className="min-w-0 text-sm font-bold leading-snug text-[#1A1A1A] break-words">{suggestion.title}</div>
          </div>
          <div className="mt-1 text-xs leading-snug text-[#666666] break-words">{suggestion.description}</div>
          <div className="mt-1 text-[11px] leading-snug text-[#8A5A00] break-words">{suggestion.tradeoff}</div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={() => void onApply(suggestion)}
            disabled={isBusy}
            className="px-4 py-2 text-xs font-bold text-white bg-brick-red rounded-lg hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isApplying ? 'Applying...' : 'Apply'}
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 xl:grid-cols-5 gap-2">
        <RepairMetricDelta label="Detached" before={suggestion.metrics.before.detachedFloatingBricks ?? suggestion.metrics.before.floatingBricks} after={suggestion.metrics.after.detachedFloatingBricks ?? suggestion.metrics.after.floatingBricks} />
        <RepairMetricDelta label="Unsupported" before={suggestion.metrics.before.unsupportedBricks} after={suggestion.metrics.after.unsupportedBricks} />
        <RepairMetricDelta label="Critical" before={suggestion.metrics.before.criticalCantileverRegions ?? 0} after={suggestion.metrics.after.criticalCantileverRegions ?? 0} />
        <RepairMetricDelta label="Health" before={suggestion.metrics.before.healthScore} after={suggestion.metrics.after.healthScore} />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.5px] text-[#888888] truncate">Patch edits</div>
          <div className="text-sm font-bold text-[#444444]">
            +{suggestion.preview.addedCells.length} / {suggestion.preview.recoloredCells.length}
          </div>
        </div>
      </div>
      <div className="mt-2 text-[11px] leading-snug text-[#777777]">
        Hover to preview. Apply rebricks with stability_v2.
      </div>
    </div>
  );
}

export function GuidedRepairQueue({
  model,
  onApply,
  onFocusBrickIds,
  onPreview,
}: {
  model: GeneratedModel;
  onApply: (model: GeneratedModel) => void;
  onFocusBrickIds: (ids: string[]) => void;
  onPreview: (preview: RepairPreview | null) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [preferences, setPreferences] = useState<RepairPreferences>(DEFAULT_PREFERENCES);
  const [repairData, setRepairData] = useState<RepairSuggestionsResult | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);
  const issues = repairData?.queue ?? [];
  const activeIssue: RepairWeakRegion | undefined = issues[Math.min(activeIndex, Math.max(issues.length - 1, 0))];
  const suggestions = repairData?.suggestions ?? [];

  const loadSuggestions = useCallback(async (regionId?: string) => {
    setLoading(true);
    setRepairError(null);
    try {
      const res = await fetch('/api/repair/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, activeRegionId: regionId, preferences }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load repair suggestions');
      setRepairData(data as RepairSuggestionsResult);
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : 'Failed to load repair suggestions');
    } finally {
      setLoading(false);
    }
  }, [model, preferences]);

  useEffect(() => {
    setActiveIndex(0);
    onPreview(null);
    void loadSuggestions();
  }, [loadSuggestions, onPreview]);

  useEffect(() => {
    if (activeIndex >= issues.length) setActiveIndex(Math.max(0, issues.length - 1));
  }, [activeIndex, issues.length]);

  useEffect(() => {
    if (!activeIssue?.id || repairData?.activeRegion?.id === activeIssue.id) return;
    onPreview(null);
    void loadSuggestions(activeIssue.id);
  }, [activeIssue?.id, loadSuggestions, onPreview, repairData?.activeRegion?.id]);

  useEffect(() => {
    onFocusBrickIds(activeIssue ? [...activeIssue.targetBrickIds, ...activeIssue.anchorBrickIds] : []);
    return () => onFocusBrickIds([]);
  }, [activeIssue, onFocusBrickIds]);

  async function handleApply(suggestion: RepairSuggestion) {
    setRepairError(null);
    setApplyingId(suggestion.id);

    try {
      const res = await fetch('/api/repair/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, regionId: suggestion.regionId, suggestionId: suggestion.id, preferences }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Repair apply failed');
      onPreview(null);
      onApply(data as GeneratedModel);
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : 'Repair failed');
    } finally {
      setApplyingId(null);
    }
  }

  if (loading && !repairData) {
    return (
      <div className="h-full border-l border-border-subtle bg-white p-5 flex items-center justify-center text-sm text-[#666666]">
        Finding repair candidates...
      </div>
    );
  }

  if (issues.length === 0 || !activeIssue) {
    return (
      <div className="h-full border-l border-border-subtle bg-white p-5">
        <div className="text-xs font-bold uppercase tracking-[1px] text-[#555555]">Repair</div>
        <div className="mt-2 text-sm text-[#2E7D32] font-semibold">No weak regions need guided repair.</div>
      </div>
    );
  }

  return (
    <div className="h-full min-w-0 border-l border-border-subtle bg-[#FAFAF7] overflow-x-hidden overflow-y-auto">
      <div className="p-5 border-b border-border-subtle bg-white">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[1px] text-[#555555]">Repair Queue</div>
          <div className="text-[12px] text-[#777777] mt-0.5">
            Weak regions are handled bottom-up, one accepted rebuild at a time.
          </div>
        </div>
        <span className="shrink-0 text-[11px] font-semibold text-[#8A5A00] bg-[#FFF8E1] border border-[#FFE082] rounded-full px-2 py-1">
          Bottom-up
        </span>
      </div>

      <div className="border border-[#E4E2DA] rounded-lg px-3 py-3 bg-white">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.8px] text-[#777777]">
            Issue {Math.min(activeIndex + 1, issues.length)} of {issues.length}
          </div>
          <div className="mt-1 text-sm font-bold leading-snug text-[#1A1A1A] break-words">{activeIssue.title}</div>
          <div className="mt-1 text-[11px] leading-snug text-[#777777] break-words">{activeIssue.description}</div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.7px] text-[#8A5A00]">
            {activeIssue.connectionClass.replaceAll('_', ' ')} · {activeIssue.loadAboveStuds} load studs
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
            disabled={activeIndex === 0 || applyingId !== null}
            className="px-3 py-1.5 text-xs font-bold border border-[#DDDDDD] rounded-lg text-[#555555] disabled:opacity-40 disabled:cursor-not-allowed hover:border-brick-red"
          >
            Previous
          </button>
          <button
            onClick={() => setActiveIndex((index) => Math.min(issues.length - 1, index + 1))}
            disabled={activeIndex >= issues.length - 1 || applyingId !== null}
            className="px-3 py-1.5 text-xs font-bold border border-[#DDDDDD] rounded-lg text-[#555555] disabled:opacity-40 disabled:cursor-not-allowed hover:border-brick-red"
          >
            Next
          </button>
        </div>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] font-bold uppercase tracking-[0.8px] text-[#666666]">
          Repair preferences
        </summary>
        <div className="mt-2 grid gap-2 text-[12px] text-[#555555]">
          <select
            value={preferences.style}
            onChange={(event) => setPreferences((prev) => ({ ...prev, style: event.target.value as RepairPreferences['style'] }))}
            className="border border-[#DDDDDD] rounded-lg px-2 py-1 bg-white"
          >
            <option value="balanced">Balanced</option>
            <option value="conservative">Conservative</option>
            <option value="structural">Structural</option>
          </select>
          {([
            ['allowRecolor', 'Allow recolor repairs'],
            ['preserveSymmetry', 'Preserve visible symmetry'],
            ['allowVisibleBoundaryEdits', 'Allow visible boundary edits'],
            ['showLastResortSupports', 'Show last-resort supports'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={preferences[key]}
                onChange={(event) => setPreferences((prev) => ({ ...prev, [key]: event.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
      </details>
      </div>

      {suggestions.length > 0 ? (
        <div className="grid gap-3 p-4">
          {suggestions.map((suggestion) => (
            <RepairSuggestionCard
              key={suggestion.id}
              suggestion={suggestion}
              onApply={handleApply}
              onPreview={(candidate) => {
                onFocusBrickIds([
                  ...activeIssue.targetBrickIds,
                  ...candidate.preview.anchorBrickIds,
                  ...candidate.preview.dependentBrickIds,
                ]);
                onPreview(candidate.preview);
              }}
              onClearPreview={() => {
                onFocusBrickIds([...activeIssue.targetBrickIds, ...activeIssue.anchorBrickIds]);
                onPreview(null);
              }}
              isApplying={applyingId === suggestion.id}
              isBusy={applyingId !== null}
            />
          ))}
        </div>
      ) : (
        <div className="m-4 border border-[#E4E2DA] rounded-lg px-3 py-3 bg-white text-[12px] leading-snug text-[#666666]">
          {repairData?.warning ?? 'No rebuild candidate is available for this issue yet. Inspect it in the viewer or enable stronger repair preferences.'}
        </div>
      )}

      {repairError && (
        <div className="mx-4 mb-4 text-[12px] leading-snug text-[#B71C1C]">
          {repairError}
        </div>
      )}
    </div>
  );
}
