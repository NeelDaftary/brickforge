import { NextRequest } from 'next/server';
import { generateModel } from '@/lib/pipeline/hyper3d-client';
import { refinePrompt } from '@/lib/pipeline/prompt-refiner';
import { PipelineError, toErrorPayload } from '@/lib/pipeline/errors';

/**
 * POST /api/generate-model
 *
 * Server-side text-to-3D generation via Hyper3D Rodin REST API.
 * Returns an SSE stream with progress events.
 *
 * Input: { prompt: string, gridSize?: number }
 * Output: SSE stream of JSON events:
 *   { type: "progress", stage, message, progress }
 *   { type: "complete", meshPath, fileName, prompt, suggestedGridSize }
 *   { type: "error", error, code }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = body.prompt?.trim();

    if (!prompt) {
      const { status, payload } = toErrorPayload(new PipelineError('INVALID_INPUT', 'Missing prompt'));
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const refined = refinePrompt(prompt);
    const suggestedGridSize = body.gridSize ?? refined.suggestedGridSize;

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
            send({
              type: 'progress',
              stage: value.stage,
              message: value.message,
              progress: value.progress,
            });
          }

          send({
            type: 'complete',
            meshPath: result.meshPath,
            fileName: result.fileName,
            prompt: result.prompt,
            suggestedGridSize,
            estimatedComplexity: refined.estimatedComplexity,
          });
        } catch (error) {
          if (!(error instanceof PipelineError)) {
            console.error('[generate-model] Error:', error);
          }
          const { payload } = toErrorPayload(error, 'Generation failed');
          send({ type: 'error', error: payload.error, code: payload.code, ...(payload.details ? { details: payload.details } : {}) });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[generate-model] Setup error:', error);
    const { status, payload } = toErrorPayload(error, 'Generation failed');
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
