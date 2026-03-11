'use client';

import type { PipelineStage } from '@/lib/pipeline/types';
import { STAGE_LABELS, STAGE_PROGRESS } from '@/lib/pipeline/types';

interface GenerationProgressProps {
  stage: PipelineStage;
  error?: string;
}

const GENERATE_STAGES: PipelineStage[] = [
  'generating_model',
  'downloading_mesh',
  'voxelizing',
  'optimizing_bricks',
  'ready',
];

const UPLOAD_STAGES: PipelineStage[] = [
  'uploading',
  'validating',
  'voxelizing',
  'optimizing_bricks',
  'ready',
];

function getStageOrder(stage: PipelineStage): PipelineStage[] {
  if (stage === 'uploading' || stage === 'validating') return UPLOAD_STAGES;
  return GENERATE_STAGES;
}

export function GenerationProgress({ stage, error }: GenerationProgressProps) {
  const progress = STAGE_PROGRESS[stage];
  const label = error || STAGE_LABELS[stage];
  const isError = stage === 'error';
  const stageOrder = getStageOrder(stage);

  return (
    <div className="w-full flex flex-col gap-3">
      {/* Progress bar */}
      <div className="w-full h-2 bg-[#E8E8E8] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${
            isError ? 'bg-red-500' : stage === 'ready' ? 'bg-[#237841]' : 'bg-brick-red'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Stage label */}
      <div className={`text-sm font-medium text-center ${isError ? 'text-red-600' : 'text-[#666666]'}`}>
        {label}
      </div>

      {/* Stage dots */}
      <div className="flex justify-center gap-2">
        {stageOrder.map((s, i) => {
          const currentIdx = stageOrder.indexOf(stage);
          const isDone = currentIdx > i || stage === 'ready';
          const isCurrent = s === stage;
          return (
            <div
              key={s}
              className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                isDone
                  ? 'bg-[#237841]'
                  : isCurrent
                    ? 'bg-brick-red animate-pulse'
                    : 'bg-[#DDDDDD]'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
