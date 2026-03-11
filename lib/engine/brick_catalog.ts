import { BrickDefinition } from './types';

export const BRICK_CATALOG: BrickDefinition[] = [
  // Standard Bricks (height = 3 plate units)
  { id: 'b_1x1', name: '1x1 Brick', bricklinkId: '3005', type: 'brick', width: 1, depth: 1, height: 3 },
  { id: 'b_1x2', name: '1x2 Brick', bricklinkId: '3004', type: 'brick', width: 2, depth: 1, height: 3 },
  { id: 'b_1x3', name: '1x3 Brick', bricklinkId: '3622', type: 'brick', width: 3, depth: 1, height: 3 },
  { id: 'b_1x4', name: '1x4 Brick', bricklinkId: '3010', type: 'brick', width: 4, depth: 1, height: 3 },
  { id: 'b_1x6', name: '1x6 Brick', bricklinkId: '3009', type: 'brick', width: 6, depth: 1, height: 3 },
  { id: 'b_1x8', name: '1x8 Brick', bricklinkId: '3008', type: 'brick', width: 8, depth: 1, height: 3 },
  { id: 'b_2x2', name: '2x2 Brick', bricklinkId: '3003', type: 'brick', width: 2, depth: 2, height: 3 },
  { id: 'b_2x3', name: '2x3 Brick', bricklinkId: '3002', type: 'brick', width: 3, depth: 2, height: 3 },
  { id: 'b_2x4', name: '2x4 Brick', bricklinkId: '3001', type: 'brick', width: 4, depth: 2, height: 3 },
  { id: 'b_2x6', name: '2x6 Brick', bricklinkId: '2456', type: 'brick', width: 6, depth: 2, height: 3 },
  { id: 'b_2x8', name: '2x8 Brick', bricklinkId: '3007', type: 'brick', width: 8, depth: 2, height: 3 },
  { id: 'b_4x4', name: '4x4 Brick', bricklinkId: '3011', type: 'brick', width: 4, depth: 4, height: 3 },

  // Plates (height = 1 plate unit)
  { id: 'p_1x1', name: '1x1 Plate', bricklinkId: '3024', type: 'plate', width: 1, depth: 1, height: 1 },
  { id: 'p_1x2', name: '1x2 Plate', bricklinkId: '3023', type: 'plate', width: 2, depth: 1, height: 1 },
  { id: 'p_1x3', name: '1x3 Plate', bricklinkId: '3623', type: 'plate', width: 3, depth: 1, height: 1 },
  { id: 'p_1x4', name: '1x4 Plate', bricklinkId: '3710', type: 'plate', width: 4, depth: 1, height: 1 },
  { id: 'p_1x6', name: '1x6 Plate', bricklinkId: '3666', type: 'plate', width: 6, depth: 1, height: 1 },
  { id: 'p_1x8', name: '1x8 Plate', bricklinkId: '3460', type: 'plate', width: 8, depth: 1, height: 1 },
  { id: 'p_2x2', name: '2x2 Plate', bricklinkId: '3022', type: 'plate', width: 2, depth: 2, height: 1 },
  { id: 'p_2x3', name: '2x3 Plate', bricklinkId: '3021', type: 'plate', width: 3, depth: 2, height: 1 },
  { id: 'p_2x4', name: '2x4 Plate', bricklinkId: '3020', type: 'plate', width: 4, depth: 2, height: 1 },
  { id: 'p_2x6', name: '2x6 Plate', bricklinkId: '3795', type: 'plate', width: 6, depth: 2, height: 1 },
  { id: 'p_2x8', name: '2x8 Plate', bricklinkId: '3034', type: 'plate', width: 8, depth: 2, height: 1 },
  { id: 'p_4x4', name: '4x4 Plate', bricklinkId: '3031', type: 'plate', width: 4, depth: 4, height: 1 },

  // Slopes
  { id: 's_2x2_45', name: '2x2 Slope 45', bricklinkId: '3039', type: 'slope', width: 2, depth: 2, height: 3 },
];

/** Helper to get brick definition by ID. */
export function getBrickDef(id: string): BrickDefinition | undefined {
  return BRICK_CATALOG.find(b => b.id === id);
}
