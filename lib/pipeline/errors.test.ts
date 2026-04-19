import { describe, expect, it } from 'vitest';
import { PipelineError, toErrorPayload, errorResponse, type PipelineErrorCode } from './errors';
import type { MeshPreflightResult } from './mesh-preflight';

describe('PipelineError', () => {
  it('stores code, message, details, and preflight', () => {
    const preflight: MeshPreflightResult = {
      inputPath: '/tmp/x.blend',
      resolvedPath: '/tmp/x.blend',
      format: 'blend',
      isSupported: true,
      shouldProceed: true,
      warnings: [],
      errors: [],
    };
    const err = new PipelineError('MESH_PREFLIGHT_FAILED', 'boom', {
      details: { bytes: 42 },
      preflight,
    });
    expect(err.code).toBe('MESH_PREFLIGHT_FAILED');
    expect(err.message).toBe('boom');
    expect(err.details).toEqual({ bytes: 42 });
    expect(err.preflight).toBe(preflight);
    expect(err.name).toBe('PipelineError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('toErrorPayload', () => {
  it('maps each PipelineError code to the correct HTTP status', () => {
    const table: Array<[PipelineErrorCode, number]> = [
      ['INVALID_INPUT', 400],
      ['UPLOAD_TOO_LARGE', 413],
      ['UPLOAD_INVALID_FILE', 400],
      ['MESH_PREFLIGHT_FAILED', 400],
      ['BLENDER_UNAVAILABLE', 503],
      ['BLENDER_FAILED', 500],
      ['VOXELIZATION_FAILED', 500],
      ['HYPER3D_FAILED', 502],
      ['HYPER3D_TIMEOUT', 504],
      ['EXPORT_FAILED', 500],
      ['INTERNAL_ERROR', 500],
    ];
    for (const [code, status] of table) {
      const { status: got } = toErrorPayload(new PipelineError(code, 'x'));
      expect(got, `status for ${code}`).toBe(status);
    }
  });

  it('includes details only when present', () => {
    const withDetails = toErrorPayload(
      new PipelineError('INVALID_INPUT', 'bad', { details: { field: 'x' } }),
    );
    expect(withDetails.payload).toEqual({
      error: 'bad',
      code: 'INVALID_INPUT',
      details: { field: 'x' },
    });

    const withoutDetails = toErrorPayload(new PipelineError('INVALID_INPUT', 'bad'));
    expect(withoutDetails.payload).toEqual({ error: 'bad', code: 'INVALID_INPUT' });
    expect('details' in withoutDetails.payload).toBe(false);
  });

  it('includes preflight only when present', () => {
    const preflight: MeshPreflightResult = {
      inputPath: '/tmp/bad.blend',
      resolvedPath: '/tmp/bad.blend',
      format: 'blend',
      isSupported: true,
      shouldProceed: false,
      warnings: ['oops'],
      errors: ['missing'],
    };
    const { payload } = toErrorPayload(
      new PipelineError('MESH_PREFLIGHT_FAILED', 'bad mesh', { preflight }),
    );
    expect(payload.preflight).toBe(preflight);
  });

  it('wraps plain Error as INTERNAL_ERROR 500 while preserving message', () => {
    const { status, payload } = toErrorPayload(new Error('uh oh'));
    expect(status).toBe(500);
    expect(payload.code).toBe('INTERNAL_ERROR');
    expect(payload.error).toBe('uh oh');
  });

  it('falls back to provided message for non-Error values', () => {
    const { status, payload } = toErrorPayload('string thrown', 'fallback msg');
    expect(status).toBe(500);
    expect(payload.code).toBe('INTERNAL_ERROR');
    expect(payload.error).toBe('fallback msg');

    const { payload: p2 } = toErrorPayload(null, 'fallback msg');
    expect(p2.error).toBe('fallback msg');
  });

  it('does not leak raw stack traces through payload', () => {
    const e = new Error('secret\n  at internal/path.js:1:1');
    const { payload } = toErrorPayload(e);
    expect(payload.error).toBe('secret\n  at internal/path.js:1:1');
    // The stack itself is not copied into the payload.
    expect((payload as unknown as Record<string, unknown>).stack).toBeUndefined();
  });
});

describe('errorResponse', () => {
  it('returns a NextResponse with the right status and JSON envelope', async () => {
    const res = errorResponse(new PipelineError('UPLOAD_TOO_LARGE', 'too big'));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body).toEqual({ error: 'too big', code: 'UPLOAD_TOO_LARGE' });
  });

  it('uses fallback message when a non-PipelineError is passed without its own', async () => {
    const res = errorResponse('weird', 'default msg');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'default msg', code: 'INTERNAL_ERROR' });
  });
});
