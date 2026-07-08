import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pipeline/run-voxel-pipeline', () => ({
  runVoxelPipeline: vi.fn(),
}));

// Stub filesystem writes so the route doesn't hit disk
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from './route';
import { PipelineError } from '@/lib/pipeline/errors';
import { runVoxelPipeline } from '@/lib/pipeline/run-voxel-pipeline';

const runVoxelPipelineMock = vi.mocked(runVoxelPipeline);

function meshFile(content: Uint8Array | string, name = 'cube.blend'): File {
  const blob = new Blob([typeof content === 'string' ? content : new Uint8Array(content)]);
  return new File([blob], name, { type: 'application/octet-stream' });
}

function blendFile(content: Uint8Array | string, name = 'cube.blend'): File {
  return meshFile(content, name);
}

function glbFile(name = 'cube.glb'): File {
  return meshFile(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]), name);
}

function formReq(form: FormData, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/upload', {
    method: 'POST',
    body: form,
    headers,
  });
}

beforeEach(() => {
  runVoxelPipelineMock.mockReset();
  runVoxelPipelineMock.mockResolvedValue({
    model: { name: 'cube', description: 'x', totalBricks: 1, bricks: [] },
    preflight: {
      inputPath: '/tmp/x.blend',
      resolvedPath: '/tmp/x.blend',
      format: 'blend',
      isSupported: true,
      shouldProceed: true,
      warnings: [],
      errors: [],
    },
    diagnostics: {
      pipeline: 'brickforge-v3',
      timingMs: 0,
      voxelSize: 0.06,
      gridSize: 1,
      voxelLayers: 1,
      totalBricks: 1,
      shelled: true,
      unsupportedBricks: 0,
      layout: {
        connectedComponents: 0,
        largestComponentBricks: 0,
        floatingBricks: 0,
        unsupportedBricks: 0,
        supportedCantilevers: 0,
        weakCantilevers: 0,
        articulationBricks: 0,
        bridgeEdges: 0,
        maxLoadAboveStuds: 0,
        internalSupportBricks: 0,
        internalSupportVoxels: 0,
        healthScore: 0,
        gateStatus: 'pass',
        seamAlignment: { totalSeams: 0, repeatedAdjacentLayerSeams: 0, maxVerticalRun: 0 },
      },
      warnings: [],
    },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/upload', () => {
  it('rejects oversized content-length before parsing body', async () => {
    const form = new FormData();
    form.append('mesh', blendFile('BLENDER-v30'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form, { 'content-length': String(100 * 1024 * 1024) }) as any);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('UPLOAD_TOO_LARGE');
    expect(runVoxelPipelineMock).not.toHaveBeenCalled();
  });

  it('returns INVALID_INPUT when mesh field is missing', async () => {
    const form = new FormData();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_INPUT');
  });

  it('returns UPLOAD_INVALID_FILE for unsupported mesh extension', async () => {
    const form = new FormData();
    form.append('mesh', meshFile('not supported', 'cube.fbx'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UPLOAD_INVALID_FILE');
    expect(body.error).toMatch(/\.blend, \.glb, \.obj, \.stl, \.ply/);
  });

  it('returns UPLOAD_INVALID_FILE when file lacks BLENDER magic bytes', async () => {
    const form = new FormData();
    form.append('mesh', blendFile('NOT_A_BLEND_FILE_AT_ALL'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UPLOAD_INVALID_FILE');
    expect(body.error).toMatch(/Blender/);
    expect(runVoxelPipelineMock).not.toHaveBeenCalled();
  });

  it('accepts gzip-compressed .blend magic (0x1f 0x8b)', async () => {
    const form = new FormData();
    form.append('mesh', blendFile(new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0])));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(200);
    expect(runVoxelPipelineMock).toHaveBeenCalledTimes(1);
  });

  it('accepts zstandard-compressed .blend magic (0x28 0xb5 0x2f 0xfd)', async () => {
    const form = new FormData();
    form.append('mesh', blendFile(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0, 0, 0])));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(200);
    expect(runVoxelPipelineMock).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid BLENDER-prefixed file and invokes the pipeline with clamped voxelSize', async () => {
    const form = new FormData();
    form.append('mesh', blendFile('BLENDER-v30 some binary junk'));
    // Out-of-range voxelSize — route clamps to [0.02, 0.5]
    form.append('voxelSize', '10');
    form.append('shell', 'false');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(200);
    expect(runVoxelPipelineMock).toHaveBeenCalledTimes(1);
    const callArgs = runVoxelPipelineMock.mock.calls[0][0];
    expect(callArgs.voxelSize).toBe(0.5);
    expect(callArgs.shell).toBe(false);
  });

  it('accepts valid .glb uploads and passes the glb path to the pipeline', async () => {
    const form = new FormData();
    form.append('mesh', glbFile('ship.glb'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(200);
    expect(runVoxelPipelineMock).toHaveBeenCalledTimes(1);
    expect(runVoxelPipelineMock.mock.calls[0][0].meshPath).toMatch(/ship\.glb$/);
  });

  it('accepts extension-validated .obj and .stl uploads', async () => {
    for (const file of [
      meshFile('o Cube\nv 0 0 0\n', 'cube.obj'),
      meshFile(new Uint8Array([0, 1, 2, 3, 4, 5]), 'cube.stl'),
    ]) {
      runVoxelPipelineMock.mockClear();
      const form = new FormData();
      form.append('mesh', file);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await POST(formReq(form) as any);
      expect(res.status).toBe(200);
      expect(runVoxelPipelineMock).toHaveBeenCalledTimes(1);
    }
  });

  it('rejects .glb uploads without GLB magic bytes', async () => {
    const form = new FormData();
    form.append('mesh', meshFile('not a glb', 'fake.glb'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UPLOAD_INVALID_FILE');
    expect(body.error).toMatch(/glTF/);
    expect(runVoxelPipelineMock).not.toHaveBeenCalled();
  });

  it('rejects .ply uploads without PLY magic bytes', async () => {
    const form = new FormData();
    form.append('mesh', meshFile('not a ply', 'fake.ply'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UPLOAD_INVALID_FILE');
    expect(body.error).toMatch(/PLY/);
    expect(runVoxelPipelineMock).not.toHaveBeenCalled();
  });

  it('falls back to legacy for removed experimental bricker engine options', async () => {
    const form = new FormData();
    form.append('mesh', blendFile('BLENDER-v30'));
    form.append('brickerEngine', 'v2_tree_repair');
    form.append('shadowCompare', 'true');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(200);
    expect(runVoxelPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        brickerEngine: 'legacy',
        shadowCompare: true,
      }),
    );
  });

  it('forwards PipelineError from the pipeline with its mapped status code', async () => {
    runVoxelPipelineMock.mockRejectedValueOnce(
      new PipelineError('BLENDER_FAILED', 'Blender crashed'),
    );
    const form = new FormData();
    form.append('mesh', blendFile('BLENDER-v30'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('BLENDER_FAILED');
  });

  it('rejects a fake gzip file that is under 2 bytes', async () => {
    // Content < 7 bytes and not gzip → invalid magic
    const form = new FormData();
    form.append('mesh', blendFile(new Uint8Array([0x00])));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UPLOAD_INVALID_FILE');
  });
});
