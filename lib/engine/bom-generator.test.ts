import { describe, expect, it } from 'vitest';
import { generateBOM, getBOMForStep, type BOMItem } from './bom-generator';
import type { BrickInstance, BrickModelData } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand to build a BrickInstance with sensible defaults. */
function brick(
  brickId: string,
  color: string,
  opts: Partial<BrickInstance> = {},
): BrickInstance {
  return {
    id: opts.id ?? crypto.randomUUID(),
    brickId,
    position: opts.position ?? [0, 0, 0],
    rotation: opts.rotation ?? 0,
    color,
    step: opts.step ?? 1,
  };
}

/** Shorthand to build a BrickModelData from a list of bricks. */
function model(bricks: BrickInstance[]): BrickModelData {
  return {
    name: 'Test Model',
    description: 'Unit test fixture',
    totalBricks: bricks.length,
    bricks,
  };
}

// ---------------------------------------------------------------------------
// generateBOM
// ---------------------------------------------------------------------------

describe('generateBOM', () => {
  it('returns an empty array for a model with no bricks', () => {
    const bom = generateBOM(model([]));
    expect(bom).toEqual([]);
  });

  it('returns a single entry for one brick', () => {
    const bom = generateBOM(model([brick('b_2x4', '#DB0000')]));

    expect(bom).toHaveLength(1);
    expect(bom[0].brickId).toBe('b_2x4');
    expect(bom[0].bricklinkPartId).toBe('3001');
    expect(bom[0].color).toBe('#db0000');
    expect(bom[0].colorName).toBe('Red');
    expect(bom[0].bricklinkColorId).toBe(5);
    expect(bom[0].displayName).toBe('2x4 Brick');
    expect(bom[0].count).toBe(1);
  });

  it('has all expected BOMItem fields on every entry', () => {
    const bom = generateBOM(model([brick('p_2x4', '#0059CF')]));

    const keys = Object.keys(bom[0]).sort();
    const expected = [
      'brickId',
      'bricklinkColorId',
      'bricklinkPartId',
      'color',
      'colorName',
      'count',
      'displayName',
    ].sort();
    expect(keys).toEqual(expected);
  });

  it('groups multiple bricks of the same type and color', () => {
    const bom = generateBOM(
      model([
        brick('b_2x4', '#DB0000'),
        brick('b_2x4', '#DB0000'),
        brick('b_2x4', '#DB0000'),
      ]),
    );

    expect(bom).toHaveLength(1);
    expect(bom[0].count).toBe(3);
  });

  it('produces separate entries for the same brick in different colors', () => {
    const bom = generateBOM(
      model([
        brick('b_2x4', '#DB0000'), // Red
        brick('b_2x4', '#0059CF'), // Blue
      ]),
    );

    expect(bom).toHaveLength(2);

    const red = bom.find((b) => b.colorName === 'Red');
    const blue = bom.find((b) => b.colorName === 'Blue');

    expect(red).toBeDefined();
    expect(blue).toBeDefined();
    expect(red!.count).toBe(1);
    expect(blue!.count).toBe(1);
  });

  it('produces separate entries for different brick types with the same color', () => {
    const bom = generateBOM(
      model([
        brick('b_1x1', '#FFFFFF'),
        brick('b_2x4', '#FFFFFF'),
      ]),
    );

    expect(bom).toHaveLength(2);
    expect(bom.map((b) => b.brickId).sort()).toEqual(['b_1x1', 'b_2x4']);
    bom.forEach((b) => expect(b.count).toBe(1));
  });

  it('computes total piece count correctly across groups', () => {
    const bom = generateBOM(
      model([
        brick('b_2x4', '#DB0000'),
        brick('b_2x4', '#DB0000'),
        brick('b_1x2', '#0059CF'),
        brick('p_2x4', '#FFFFFF'),
        brick('p_2x4', '#FFFFFF'),
        brick('p_2x4', '#FFFFFF'),
      ]),
    );

    const total = bom.reduce((sum, item) => sum + item.count, 0);
    expect(total).toBe(6);

    expect(bom.find((b) => b.brickId === 'b_2x4')!.count).toBe(2);
    expect(bom.find((b) => b.brickId === 'b_1x2')!.count).toBe(1);
    expect(bom.find((b) => b.brickId === 'p_2x4')!.count).toBe(3);
  });

  it('normalizes color hex to lowercase', () => {
    const bom = generateBOM(
      model([
        brick('b_2x4', '#DB0000'),
        brick('b_2x4', '#db0000'),
      ]),
    );

    expect(bom).toHaveLength(1);
    expect(bom[0].count).toBe(2);
    expect(bom[0].color).toBe('#db0000');
  });

  it('defaults to #888888 when brick has no color', () => {
    const b = brick('b_1x1', '');
    // generateBOM treats empty/falsy color as '#888888'
    const bom = generateBOM(model([b]));

    expect(bom).toHaveLength(1);
    expect(bom[0].color).toBe('#888888');
  });

  it('skips bricks with unknown brickId', () => {
    const bom = generateBOM(
      model([
        brick('b_2x4', '#DB0000'),
        brick('nonexistent_99x99', '#DB0000'),
      ]),
    );

    expect(bom).toHaveLength(1);
    expect(bom[0].brickId).toBe('b_2x4');
  });

  it('sorts output by brickId then colorName', () => {
    const bom = generateBOM(
      model([
        brick('p_2x4', '#DB0000'),  // Red plate
        brick('b_1x1', '#0059CF'),  // Blue brick
        brick('b_1x1', '#DB0000'),  // Red brick (same brickId, different color)
        brick('b_2x4', '#FFFFFF'),  // White brick
      ]),
    );

    const order = bom.map((b) => `${b.brickId}|${b.colorName}`);
    expect(order).toEqual([
      'b_1x1|Blue',
      'b_1x1|Red',
      'b_2x4|White',
      'p_2x4|Red',
    ]);
  });

  it('maps plates to their correct BrickLink part IDs', () => {
    const bom = generateBOM(
      model([
        brick('p_1x1', '#FFFFFF'),
        brick('p_2x4', '#FFFFFF'),
      ]),
    );

    expect(bom.find((b) => b.brickId === 'p_1x1')!.bricklinkPartId).toBe('3024');
    expect(bom.find((b) => b.brickId === 'p_2x4')!.bricklinkPartId).toBe('3020');
  });

  it('returns bricklinkColorId as undefined for an unrecognized color', () => {
    const bom = generateBOM(model([brick('b_1x1', '#123456')]));

    expect(bom).toHaveLength(1);
    expect(bom[0].bricklinkColorId).toBeUndefined();
    expect(bom[0].colorName).toBe('Unknown');
  });
});

// ---------------------------------------------------------------------------
// getBOMForStep
// ---------------------------------------------------------------------------

describe('getBOMForStep', () => {
  const stepModel = model([
    brick('b_2x4', '#DB0000', { step: 1 }),
    brick('b_2x4', '#DB0000', { step: 1 }),
    brick('b_1x2', '#0059CF', { step: 2 }),
    brick('p_2x4', '#FFFFFF', { step: 2 }),
    brick('p_2x4', '#FFFFFF', { step: 3 }),
  ]);

  it('returns only bricks belonging to the requested step', () => {
    const step1 = getBOMForStep(stepModel, 1);
    expect(step1).toHaveLength(1);
    expect(step1[0].brickId).toBe('b_2x4');
    expect(step1[0].count).toBe(2);
  });

  it('handles a step with multiple brick types', () => {
    const step2 = getBOMForStep(stepModel, 2);
    expect(step2).toHaveLength(2);
    expect(step2.map((b) => b.brickId).sort()).toEqual(['b_1x2', 'p_2x4']);
  });

  it('returns an empty array for a step with no bricks', () => {
    const step99 = getBOMForStep(stepModel, 99);
    expect(step99).toEqual([]);
  });
});
