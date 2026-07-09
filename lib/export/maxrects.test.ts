import { describe, expect, it } from 'vitest';
import { packMaxRects } from './maxrects';

describe('packMaxRects', () => {
  it('marks placements that only fit when rotated', () => {
    const result = packMaxRects([{ w: 80, h: 30, index: 0 }], 40, 90, 0, 'bssf');

    expect(result.placed).toEqual([{ x: 0, y: 0, index: 0, rotated: true }]);
    expect(result.remaining).toEqual([]);
  });
});
