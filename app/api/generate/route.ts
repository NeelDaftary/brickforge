import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { refinePrompt } from '@/lib/pipeline/prompt-refiner';

const RequestSchema = z.object({
  prompt: z.string().min(1).max(500),
  gridSize: z.number().int().min(10).max(40).optional(),
});

/**
 * POST /api/generate
 *
 * Full pipeline:
 * 1. Refine prompt
 * 2. (Blender generation happens client-side via MCP tools)
 * 3. Accept voxel data OR mesh path for voxelization
 * 4. Run brick optimization
 * 5. Return BrickModelData
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { prompt, gridSize: requestedGridSize } = RequestSchema.parse(body);

    // Step 1: Refine the prompt
    const refined = refinePrompt(prompt);
    const gridSize = requestedGridSize ?? refined.suggestedGridSize;

    // Return the refined prompt for client-side Blender generation
    // The client will call back with voxel data or mesh path
    return NextResponse.json({
      stage: 'prompt_refined',
      refined: {
        blenderPrompt: refined.blenderPrompt,
        userInput: refined.userInput,
        suggestedGridSize: gridSize,
        estimatedComplexity: refined.estimatedComplexity,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
