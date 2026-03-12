import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { preflightMeshPath } from './mesh-preflight';

describe('preflightMeshPath', () => {
  it('accepts supported formats (.blend, .glb)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mesh-preflight-'));
    try {
      for (const [ext, fmt] of [['blend', 'blend'], ['glb', 'glb']] as const) {
        const filePath = path.join(dir, `model.${ext}`);
        await writeFile(filePath, 'placeholder');
        const result = await preflightMeshPath(filePath);
        expect(result.shouldProceed).toBe(true);
        expect(result.format).toBe(fmt);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsupported formats', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mesh-preflight-'));
    try {
      const fbxPath = path.join(dir, 'model.fbx');
      await writeFile(fbxPath, 'placeholder');
      const result = await preflightMeshPath(fbxPath);
      expect(result.shouldProceed).toBe(false);
      expect(result.format).toBe('unknown');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('errors when file does not exist', async () => {
    const result = await preflightMeshPath('/tmp/nonexistent.blend');
    expect(result.shouldProceed).toBe(false);
    expect(result.errors[0]).toContain('does not exist');
  });
});
