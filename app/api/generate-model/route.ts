import { NextRequest } from 'next/server';
import { generateModel } from '@/lib/pipeline/hyper3d-client';
import { refinePrompt } from '@/lib/pipeline/prompt-refiner';

/**
 * POST /api/generate-model
 *
 * Server-side text-to-3D generation via Hyper3D Rodin REST API.
 * Returns an SSE stream with progress events.
 *
 * Additive — does NOT replace /api/generate or /api/upload.
 *
 * Input: { prompt: string, gridSize?: number }
 * Output: SSE stream of JSON events:
 *   { type: "progress", stage, message, progress }
 *   { type: "complete", meshPath, fileName, prompt, suggestedGridSize }
 *   { type: "error", error }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = body.prompt?.trim();

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Missing prompt' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Quick metadata from prompt refiner (grid size, complexity)
    const refined = refinePrompt(prompt);
    const suggestedGridSize = body.gridSize ?? refined.suggestedGridSize;

    // Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        function send(data: Record<string, unknown>) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        }

        try {
          const gen = generateModel(prompt);

          let result;
          while (true) {
            const { value, done } = await gen.next();
            if (done) {
              result = value;
              break;
            }
            // value is a GenerationProgress
            send({
              type: 'progress',
              stage: value.stage,
              message: value.message,
              progress: value.progress,
            });
          }

          // Send final result
          send({
            type: 'complete',
            meshPath: result.meshPath,
            fileName: result.fileName,
            prompt: result.prompt,
            suggestedGridSize,
            estimatedComplexity: refined.estimatedComplexity,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Generation failed';
          console.error('[generate-model] Error:', error);
          send({ type: 'error', error: message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
