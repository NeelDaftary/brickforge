import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';
import { buildRepairSuggestions, DEFAULT_REPAIR_PREFERENCES } from '@/lib/pipeline_v2/guided-repair-v2';

const RepairPreferencesSchema = z.object({
  style: z.enum(['conservative', 'balanced', 'structural']).default(DEFAULT_REPAIR_PREFERENCES.style),
  allowRecolor: z.boolean().default(DEFAULT_REPAIR_PREFERENCES.allowRecolor),
  preserveSymmetry: z.boolean().default(DEFAULT_REPAIR_PREFERENCES.preserveSymmetry),
  allowVisibleBoundaryEdits: z.boolean().default(DEFAULT_REPAIR_PREFERENCES.allowVisibleBoundaryEdits),
  showLastResortSupports: z.boolean().default(DEFAULT_REPAIR_PREFERENCES.showLastResortSupports),
}).partial();

const RepairSuggestionsSchema = z.object({
  model: z.custom<GeneratedModel>((value) => Boolean(value && typeof value === 'object' && 'bricks' in value)),
  activeRegionId: z.string().optional(),
  preferences: RepairPreferencesSchema.optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = RepairSuggestionsSchema.parse(await req.json());
    return NextResponse.json(buildRepairSuggestions(body.model, {
      activeRegionId: body.activeRegionId,
      preferences: body.preferences,
    }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((issue) => issue.message).join('; ') }, { status: 400 });
    }
    console.error('Repair suggestions error:', error);
    return NextResponse.json({ error: 'Failed to build repair suggestions' }, { status: 500 });
  }
}
