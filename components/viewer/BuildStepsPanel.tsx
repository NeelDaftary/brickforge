'use client';

import { useMemo } from 'react';
import { getBOMForStep } from '@/lib/engine/bom-generator';
import type { BrickModelData } from '@/lib/engine/types';

interface BuildStepsPanelProps {
  model: BrickModelData;
  currentStep: number;
  maxStep: number;
  onPrev: () => void;
  onNext: () => void;
}

export function BuildStepsPanel({
  model,
  currentStep,
  maxStep,
  onPrev,
  onNext,
}: BuildStepsPanelProps) {
  const bom = useMemo(() => getBOMForStep(model, currentStep), [model, currentStep]);
  const stepBrickCount = useMemo(
    () => model.bricks.filter((brick) => brick.step === currentStep).length,
    [model, currentStep]
  );

  return (
    <aside className="w-full lg:w-[300px] border-t lg:border-t-0 lg:border-l border-border-subtle bg-[#FCFBF7] flex flex-col">
      <div className="p-4 border-b border-border-subtle">
        <div className="text-xs uppercase tracking-[1.2px] text-[#888888] font-semibold">Build Step</div>
        <div className="mt-1 text-lg font-bold text-[#1A1A1A]">
          Step {currentStep} of {maxStep}
        </div>
        <div className="text-sm text-[#666666] mt-1">{stepBrickCount} bricks in this step</div>
      </div>

      <div className="px-4 py-3 border-b border-border-subtle flex items-center justify-between">
        <button
          onClick={onPrev}
          className="h-9 w-9 rounded-button-sm border-2 border-[#E0DFD9] text-sm font-bold disabled:opacity-30"
          disabled={currentStep <= 1}
        >
          ◀
        </button>
        <span className="text-sm font-semibold text-[#1A1A1A]">Parts Needed</span>
        <button
          onClick={onNext}
          className="h-9 w-9 rounded-button-sm border-2 border-[#E0DFD9] text-sm font-bold disabled:opacity-30"
          disabled={currentStep >= maxStep}
        >
          ▶
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {bom.length === 0 ? (
          <div className="text-sm text-[#888888] p-2">No parts for this step.</div>
        ) : (
          <ul className="space-y-2">
            {bom.map((item) => (
              <li
                key={`${item.brickId}-${item.color}`}
                className="rounded-lg border border-border-subtle bg-white px-3 py-2 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#1A1A1A] truncate">{item.displayName}</div>
                  <div className="text-xs text-[#777777] flex items-center gap-1.5">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full border border-black/10"
                      style={{ backgroundColor: item.color }}
                    />
                    {item.colorName}
                  </div>
                </div>
                <div className="text-sm font-bold text-[#1A1A1A]">x{item.count}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
