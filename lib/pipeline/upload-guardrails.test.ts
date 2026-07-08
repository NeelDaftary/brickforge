import { describe, expect, it } from 'vitest';
import { buildGuardrails, fileGuardrails } from './upload-guardrails';

describe('upload guardrails', () => {
  it('warns that STL uploads cannot preserve colors', () => {
    const guardrails = fileGuardrails('dragon.stl', 1024);

    expect(guardrails.some((item) => item.tone === 'warning' && item.message.includes('no material or color data'))).toBe(true);
  });

  it('notes large files before processing', () => {
    const guardrails = fileGuardrails('scene.blend', 40 * 1024 * 1024);

    expect(guardrails.some((item) => item.message.includes('Large file'))).toBe(true);
  });

  it('warns when a measured build is likely too large or thin', () => {
    const guardrails = buildGuardrails({ width: 10, depth: 0.1, height: 10, maxExtent: 10 }, 0.1);

    expect(guardrails.some((item) => item.message.includes('Large voxel grid'))).toBe(true);
    expect(guardrails.some((item) => item.message.includes('very thin'))).toBe(true);
  });

  it('sets compact-build expectations', () => {
    const guardrails = buildGuardrails({ width: 1, depth: 1, height: 1, maxExtent: 1 }, 0.05);

    expect(guardrails.some((item) => item.message.includes('compact build'))).toBe(true);
  });
});
