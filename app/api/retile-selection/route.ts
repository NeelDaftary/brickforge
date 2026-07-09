import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { BrickModelData } from '@/lib/engine/types';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';
import { PipelineError, errorResponse } from '@/lib/pipeline/errors';
import { buildRetileSelectionCandidates } from '@/lib/pipeline_v2/retile-selection';

const RetileRequestSchema = z.object({
  model: z.custom<GeneratedModel>((value) => {
    const data = value as Partial<BrickModelData>;
    return typeof data?.name === 'string' && Array.isArray(data.bricks);
  }, 'Invalid BrickForge model'),
  selectedCells: z.array(z.object({
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
  })).min(1),
  styles: z.array(z.enum(['balanced', 'fewer_parts', 'stronger'])).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = RetileRequestSchema.parse(await req.json());
    const result = buildRetileSelectionCandidates(body.model, body.selectedCells, body.styles);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        new PipelineError('INVALID_INPUT', error.issues.map((issue) => issue.message).join('; '), {
          details: { issues: error.issues },
        }),
      );
    }
    if (!(error instanceof PipelineError)) {
      console.error('Retile selection error:', error);
    }
    return errorResponse(error, 'Retile failed');
  }
}
