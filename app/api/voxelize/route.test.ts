import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Must mock before importing the route (which imports these modules).
vi.mock('@/lib/pipeline/run-voxel-pipeline', () => ({
  runVoxelPipeline: vi.fn(),
}));
vi.mock('@/lib/pipeline/voxel-to-bricks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pipeline/voxel-to-bricks')>(
    '@/lib/pipeline/voxel-to-bricks',
  );
  return {
    ...actual,
    voxelGridToBrickModel: vi.fn(),
  };
});
vi.mock('@/lib/pipeline_v2/stability-bricker', () => ({
  voxelGridToBrickModelV2: vi.fn(),
}));

import { POST } from './route';
import { PipelineError } from '@/lib/pipeline/errors';
import { runVoxelPipeline } from '@/lib/pipeline/run-voxel-pipeline';
import { voxelGridToBrickModel } from '@/lib/pipeline/voxel-to-bricks';
import { voxelGridToBrickModelV2 } from '@/lib/pipeline_v2/stability-bricker';

const runVoxelPipelineMock = vi.mocked(runVoxelPipeline);
const voxelGridToBrickModelMock = vi.mocked(voxelGridToBrickModel);
const voxelGridToBrickModelV2Mock = vi.mocked(voxelGridToBrickModelV2);

function makeReq(body: unknown): Parameters<typeof POST>[0] {
  return new Request('http://localhost/api/voxelize', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];
}

beforeEach(() => {
  runVoxelPipelineMock.mockReset();
  voxelGridToBrickModelMock.mockReset();
  voxelGridToBrickModelV2Mock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/voxelize', () => {
  it('returns 400 INVALID_INPUT when neither meshPath nor voxelData is provided', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_INPUT');
    expect(body.error).toMatch(/meshPath|voxelData/);
  });

  it('returns 400 with Zod issue details for invalid body shape', async () => {
    // voxelSize out of range
    const res = await POST(makeReq({ meshPath: '/tmp/x.blend', voxelSize: 5 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_INPUT');
    expect(body.details?.issues).toBeDefined();
  });

  it('returns the mapped status code for PipelineError from the pipeline', async () => {
    runVoxelPipelineMock.mockRejectedValueOnce(
      new PipelineError('BLENDER_UNAVAILABLE', 'Blender not found on PATH'),
    );
    const res = await POST(
      makeReq({ meshPath: '/tmp/x.blend' }),
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe('BLENDER_UNAVAILABLE');
    expect(body.error).toMatch(/Blender/);
  });

  it('returns 500 INTERNAL_ERROR for non-PipelineError thrown from the pipeline', async () => {
    runVoxelPipelineMock.mockRejectedValueOnce(new Error('unexpected crash'));
    const res = await POST(makeReq({ meshPath: '/tmp/x.blend' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.error).toBe('unexpected crash');
  });

  it('passes voxelData through voxelGridToBrickModel and returns diagnostics', async () => {
    voxelGridToBrickModelMock.mockReturnValue({
      name: 'Generated Build',
      description: 'LEGO build generated from 3D model',
      totalBricks: 3,
      bricks: [],
    });

    const res = await POST(makeReq({
      voxelData: {
        grid: [[['R']], [['R']], [['R']]],
        color_legend: { R: '#DB0000' },
      },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalBricks).toBe(3);
    expect(body.diagnostics).toBeDefined();
    expect(body.diagnostics.pipeline).toBe('brickforge-v3');
    expect(body.diagnostics.gridSize).toBe(3);
    expect(voxelGridToBrickModelMock).toHaveBeenCalledTimes(1);
  });

  it('uses the v2 bricker for voxelData when requested', async () => {
    voxelGridToBrickModelV2Mock.mockReturnValue({
      name: 'Generated Build',
      description: 'LEGO build generated from 3D model',
      totalBricks: 2,
      bricks: [],
    });

    const res = await POST(makeReq({
      brickerEngine: 'stability_v2',
      voxelData: {
        grid: [[['R']], [['R']]],
        color_legend: { R: '#DB0000' },
      },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalBricks).toBe(2);
    expect(body.diagnostics.brickerEngine).toBe('stability_v2');
    expect(voxelGridToBrickModelMock).not.toHaveBeenCalled();
    expect(voxelGridToBrickModelV2Mock).toHaveBeenCalledTimes(1);
  });

  it('passes meshPath through runVoxelPipeline', async () => {
    runVoxelPipelineMock.mockResolvedValueOnce({
      model: {
        name: 'Generated Build',
        description: 'LEGO build generated from 3D model',
        totalBricks: 42,
        bricks: [],
      },
      preflight: {
        inputPath: '/tmp/cube.blend',
        resolvedPath: '/tmp/cube.blend',
        format: 'blend',
        isSupported: true,
        shouldProceed: true,
        warnings: [],
        errors: [],
      },
      diagnostics: {
        pipeline: 'brickforge-v3',
        timingMs: 0,
        voxelSize: 0.08,
        gridSize: 5,
        voxelLayers: 5,
        totalBricks: 42,
        shelled: false,
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

    const res = await POST(makeReq({
      meshPath: '/tmp/cube.blend',
      voxelSize: 0.08,
      shell: false,
    }));
    expect(res.status).toBe(200);
    expect(runVoxelPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({ meshPath: '/tmp/cube.blend', voxelSize: 0.08, shell: false }),
    );
  });
});
