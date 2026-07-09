import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GeneratedModel } from '@/lib/pipeline/model-diagnostics';

const DEMOS = [
  'squirtle-repaint.brickforge.json',
  'charmander2.brickforge.json',
  'cat.brickforge.json',
  'shiba.brickforge.json',
];

function isGeneratedModel(value: unknown): value is GeneratedModel {
  const data = value as Partial<GeneratedModel>;
  return typeof data.name === 'string' &&
    typeof data.description === 'string' &&
    typeof data.totalBricks === 'number' &&
    Array.isArray(data.bricks);
}

describe('demo builds', () => {
  it('ships valid BrickForge JSON demos with diagnostics and voxel data', async () => {
    for (const demo of DEMOS) {
      const raw = await readFile(path.join(process.cwd(), 'public', 'demos', demo), 'utf8');
      const parsed = JSON.parse(raw);

      expect(isGeneratedModel(parsed)).toBe(true);
      expect(parsed.bricks).toHaveLength(parsed.totalBricks);
      expect(parsed.voxelData?.grid).toBeTruthy();
      expect(parsed.diagnostics?.layout).toBeTruthy();
      expect(parsed.diagnostics?.color).toBeTruthy();
    }
  });
});
