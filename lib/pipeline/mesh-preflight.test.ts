import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { preflightMeshPath } from './mesh-preflight';

describe('preflightMeshPath', () => {
  it('accepts .blend as supported format', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mesh-preflight-'));
    try {
      const blendPath = path.join(dir, 'model.blend');
      await writeFile(blendPath, 'placeholder');

      const result = await preflightMeshPath(blendPath);
      expect(result.shouldProceed).toBe(true);
      expect(result.format).toBe('blend');
      expect(result.errors).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts .glb as supported format', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mesh-preflight-'));
    try {
      const glbPath = path.join(dir, 'model.glb');
      await writeFile(glbPath, 'placeholder');

      const result = await preflightMeshPath(glbPath);
      expect(result.shouldProceed).toBe(true);
      expect(result.format).toBe('glb');
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
