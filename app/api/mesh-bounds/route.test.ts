import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/pipeline/run-voxel-pipeline', () => ({
  getMeshBounds: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from './route';
import { getMeshBounds } from '@/lib/pipeline/run-voxel-pipeline';

const getMeshBoundsMock = vi.mocked(getMeshBounds);

function meshFile(content: Uint8Array | string, name: string): File {
  const blob = new Blob([typeof content === 'string' ? content : new Uint8Array(content)]);
  return new File([blob], name, { type: 'application/octet-stream' });
}

function formReq(form: FormData): Request {
  return new Request('http://localhost/api/mesh-bounds', {
    method: 'POST',
    body: form,
  });
}

beforeEach(() => {
  getMeshBoundsMock.mockReset();
  getMeshBoundsMock.mockResolvedValue({ width: 1, depth: 2, height: 3, maxExtent: 3 });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/mesh-bounds', () => {
  it('accepts valid .glb uploads', async () => {
    const form = new FormData();
    form.append('mesh', meshFile(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02]), 'model.glb'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ width: 1, depth: 2, height: 3, maxExtent: 3 });
    expect(getMeshBoundsMock.mock.calls[0][0]).toMatch(/model\.glb$/);
  });

  it('rejects unsupported mesh extensions', async () => {
    const form = new FormData();
    form.append('mesh', meshFile('not supported', 'model.fbx'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(formReq(form) as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('UPLOAD_INVALID_FILE');
    expect(getMeshBoundsMock).not.toHaveBeenCalled();
  });
});
