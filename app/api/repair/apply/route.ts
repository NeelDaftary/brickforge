import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';
import { applyRepairSuggestion, DEFAULT_REPAIR_PREFERENCES } from '@/lib/pipeline_v2/guided-repair-v2';

const RepairPreferencesSchema = z.object({
  style: z.enum(['conservative', 'balanced', 'structural']).default(DEFAULT_REPAIR_PREFERENCES.style),
  allowRecolor: z.boolean().default(DEFAULT_REPAIR_PREFERENCES.allowRecolor),
  preserveSymmetry: z.boolean().default(DEFAULT_REPAIR_PREFERENCES.preserveSymmetry),
  allowVisibleBoundaryEdits: z.boolean().default(DEFAULT_REPAIR_PREFERENCES.allowVisibleBoundaryEdits),
  showLastResortSupports: z.boolean().default(DEFAULT_REPAIR_PREFERENCES.showLastResortSupports),
}).partial();

const RepairApplySchema = z.object({
  model: z.custom<GeneratedModel>((value) => Boolean(value && typeof value === 'object' && 'bricks' in value)),
  regionId: z.string(),
  suggestionId: z.string(),
  preferences: RepairPreferencesSchema.optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = RepairApplySchema.parse(await req.json());
    return NextResponse.json(applyRepairSuggestion(body.model, body.regionId, body.suggestionId, body.preferences));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((issue) => issue.message).join('; ') }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Repair apply failed' }, { status: 409 });
  }
}
