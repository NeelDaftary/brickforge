/**
 * Structured pipeline errors.
 *
 * Every error exposed to callers (route handlers, SSE streams) carries a
 * stable machine-readable code plus a human-readable message. Routes use
 * `toErrorPayload` to render a consistent JSON envelope:
 *
 *   { "error": "<message>", "code": "<CODE>", "details"?: { ... } }
 *
 * The top-level `error` string is kept for backwards compatibility — every
 * frontend call site already reads `data.error`. New code should prefer
 * switching on `code` instead.
 */

import { NextResponse } from 'next/server';
import type { MeshPreflightResult } from './mesh-preflight';

export type PipelineErrorCode =
  | 'INVALID_INPUT'
  | 'UPLOAD_TOO_LARGE'
  | 'UPLOAD_INVALID_FILE'
  | 'MESH_PREFLIGHT_FAILED'
  | 'BLENDER_UNAVAILABLE'
  | 'BLENDER_FAILED'
  | 'VOXELIZATION_FAILED'
  | 'HYPER3D_FAILED'
  | 'HYPER3D_TIMEOUT'
  | 'EXPORT_FAILED'
  | 'INTERNAL_ERROR';

const STATUS_FOR_CODE: Record<PipelineErrorCode, number> = {
  INVALID_INPUT: 400,
  UPLOAD_TOO_LARGE: 413,
  UPLOAD_INVALID_FILE: 400,
  MESH_PREFLIGHT_FAILED: 400,
  BLENDER_UNAVAILABLE: 503,
  BLENDER_FAILED: 500,
  VOXELIZATION_FAILED: 500,
  HYPER3D_FAILED: 502,
  HYPER3D_TIMEOUT: 504,
  EXPORT_FAILED: 500,
  INTERNAL_ERROR: 500,
};

export class PipelineError extends Error {
  readonly code: PipelineErrorCode;
  readonly preflight?: MeshPreflightResult;
  readonly details?: Record<string, unknown>;

  constructor(
    code: PipelineErrorCode,
    message: string,
    opts: { preflight?: MeshPreflightResult; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
    this.preflight = opts.preflight;
    this.details = opts.details;
  }
}

export interface ErrorPayload {
  error: string;
  code: PipelineErrorCode;
  details?: Record<string, unknown>;
  preflight?: MeshPreflightResult;
}

/**
 * Build the JSON envelope + HTTP status for any thrown value.
 * Unknown errors fall back to INTERNAL_ERROR so nothing leaks raw stacks.
 */
export function toErrorPayload(error: unknown, fallbackMessage = 'Request failed'): {
  status: number;
  payload: ErrorPayload;
} {
  if (error instanceof PipelineError) {
    return {
      status: STATUS_FOR_CODE[error.code],
      payload: {
        error: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
        ...(error.preflight ? { preflight: error.preflight } : {}),
      },
    };
  }

  const message = error instanceof Error ? error.message : fallbackMessage;
  return {
    status: 500,
    payload: { error: message, code: 'INTERNAL_ERROR' },
  };
}

export function errorResponse(error: unknown, fallbackMessage?: string): NextResponse {
  const { status, payload } = toErrorPayload(error, fallbackMessage);
  return NextResponse.json(payload, { status });
}
