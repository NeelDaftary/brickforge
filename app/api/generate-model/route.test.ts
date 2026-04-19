import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pipeline/hyper3d-client', () => ({
  generateModel: vi.fn(),
}));

import { POST } from './route';
import { PipelineError } from '@/lib/pipeline/errors';
import { generateModel } from '@/lib/pipeline/hyper3d-client';

const generateModelMock = vi.mocked(generateModel);

function jsonReq(body: unknown): Request {
  return new Request('http://localhost/api/generate-model', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Drain an SSE response into parsed event objects. */
async function readSse(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  const events: Array<Record<string, unknown>> = [];
  for (const chunk of text.split('\n\n')) {
    const line = chunk.trim();
    if (!line.startsWith('data:')) continue;
    events.push(JSON.parse(line.slice('data:'.length).trim()));
  }
  return events;
}

beforeEach(() => {
  generateModelMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/generate-model', () => {
  it('returns 400 INVALID_INPUT for empty prompt', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(jsonReq({ prompt: '   ' }) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_INPUT');
    expect(generateModelMock).not.toHaveBeenCalled();
  });

  it('returns 400 when prompt is missing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(jsonReq({}) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('streams progress then complete events on success', async () => {
    generateModelMock.mockImplementation(async function* () {
      yield { stage: 'submitting', message: 'Submitting...', progress: 5 } as const;
      yield { stage: 'done', message: 'Model ready!', progress: 100 } as const;
      return { meshPath: '/tmp/m.glb', fileName: 'm.glb', prompt: 'a cube' };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(jsonReq({ prompt: 'a cube' }) as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);

    const events = await readSse(res);
    expect(events[0]).toMatchObject({ type: 'progress', stage: 'submitting' });
    expect(events[events.length - 1]).toMatchObject({
      type: 'complete',
      meshPath: '/tmp/m.glb',
      fileName: 'm.glb',
      prompt: 'a cube',
    });
    expect(events[events.length - 1].suggestedGridSize).toBeTypeOf('number');
  });

  it('emits a structured error event with code when the generator throws PipelineError', async () => {
    generateModelMock.mockImplementation(async function* () {
      yield { stage: 'submitting', message: 's', progress: 1 } as const;
      throw new PipelineError('HYPER3D_TIMEOUT', 'generation timed out');
      // eslint-disable-next-line @typescript-eslint/no-unreachable
      return { meshPath: '', fileName: '', prompt: '' };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(jsonReq({ prompt: 'spaceship' }) as any);
    const events = await readSse(res);
    const last = events[events.length - 1];
    expect(last.type).toBe('error');
    expect(last.code).toBe('HYPER3D_TIMEOUT');
    expect(last.error).toBe('generation timed out');
  });

  it('wraps generic Error as INTERNAL_ERROR in the SSE error event', async () => {
    generateModelMock.mockImplementation(async function* () {
      throw new Error('kaboom');
      // eslint-disable-next-line @typescript-eslint/no-unreachable
      yield { stage: 'submitting', message: 's', progress: 1 } as const;
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(jsonReq({ prompt: 'x' }) as any);
    const events = await readSse(res);
    const last = events[events.length - 1];
    expect(last.type).toBe('error');
    expect(last.code).toBe('INTERNAL_ERROR');
    expect(last.error).toBe('kaboom');
  });
});
