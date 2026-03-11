import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { preflightMeshPath } from './mesh-preflight';

describe('preflightMeshPath', () => {
  it('passes OBJ + MTL with usemtl as ready', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mesh-preflight-'));
    try {
      const objPath = path.join(dir, 'model.obj');
      const mtlPath = path.join(dir, 'model.mtl');

      await writeFile(mtlPath, 'newmtl Red\nKd 1.0 0.0 0.0\n');
      await writeFile(
        objPath,
        [
          'mtllib model.mtl',
          'v 0 0 0',
          'v 1 0 0',
          'v 0 1 0',
          'usemtl Red',
          'f 1 2 3',
          '',
        ].join('\n'),
      );

      const result = await preflightMeshPath(objPath);
      expect(result.shouldProceed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.objMeta?.missingMtlFiles).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('warns when OBJ is missing MTL', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mesh-preflight-'));
    try {
      const objPath = path.join(dir, 'model.obj');
      await writeFile(
        objPath,
        [
          'v 0 0 0',
          'v 1 0 0',
          'v 0 1 0',
          'f 1 2 3',
          '',
        ].join('\n'),
      );

      const result = await preflightMeshPath(objPath);
      expect(result.shouldProceed).toBe(true);
      expect(result.warnings.join(' ')).toContain('does not reference an MTL');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts glb as supported format', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'mesh-preflight-'));
    try {
      const glbPath = path.join(dir, 'model.glb');
      await writeFile(glbPath, 'placeholder');

      const result = await preflightMeshPath(glbPath);
      expect(result.shouldProceed).toBe(true);
      expect(result.format).toBe('glb');
      expect(result.errors).toHaveLength(0);
      expect(result.recommendations.join(' ')).toContain('Best format');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
