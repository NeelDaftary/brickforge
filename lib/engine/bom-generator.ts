import type { BrickModelData } from './types';
import { getBrickDef } from './brick_catalog';
import { getBrickLinkColorId, getColorName } from './color-palette';

export interface BOMItem {
  brickId: string;
  bricklinkPartId: string;
  color: string;
  colorName: string;
  bricklinkColorId: number | undefined;
  displayName: string;
  count: number;
}

/**
 * Generates a Bill of Materials from a BrickModel.
 * Groups identical parts (same brickId + color) and maps to BrickLink IDs.
 */
export function generateBOM(model: BrickModelData): BOMItem[] {
  const counts = new Map<string, number>();

  for (const brick of model.bricks) {
    const def = getBrickDef(brick.brickId);
    if (!def) continue;

    const color = (brick.color || '#888888').toLowerCase();
    const key = `${brick.brickId}|${color}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const items: BOMItem[] = [];
  for (const [key, count] of counts) {
    const [brickId, color] = key.split('|');
    const def = getBrickDef(brickId);
    if (!def) continue;

    const colorHex = color.startsWith('#') ? color : `#${color}`;
    items.push({
      brickId,
      bricklinkPartId: def.bricklinkId,
      color: colorHex,
      colorName: getColorName(colorHex) ?? 'Unknown',
      bricklinkColorId: getBrickLinkColorId(colorHex),
      displayName: def.name,
      count,
    });
  }

  // Sort by brick type then color for consistent output
  items.sort((a, b) => {
    if (a.brickId !== b.brickId) return a.brickId.localeCompare(b.brickId);
    return a.colorName.localeCompare(b.colorName);
  });

  return items;
}

/**
 * Get BOM items for a specific step (bricks added in that step).
 */
export function getBOMForStep(model: BrickModelData, step: number): BOMItem[] {
  const stepBricks = model.bricks.filter((b) => b.step === step);
  const subModel: BrickModelData = { ...model, bricks: stepBricks };
  return generateBOM(subModel);
}
