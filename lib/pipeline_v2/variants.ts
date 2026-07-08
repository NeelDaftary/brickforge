export const STABILITY_V2_VARIANTS = [
  'stability_v2',
  'v2_masks',
  'v2_tree_repair',
  'v2_lexicographic',
  'v2_oracle',
] as const;

export type StabilityV2Variant = typeof STABILITY_V2_VARIANTS[number];

export const BRICKER_VARIANTS = ['legacy', ...STABILITY_V2_VARIANTS] as const;

export type BrickerVariant = typeof BRICKER_VARIANTS[number];

export function isBrickerVariant(value: string): value is BrickerVariant {
  return (BRICKER_VARIANTS as readonly string[]).includes(value);
}

export function isStabilityV2Variant(value: BrickerVariant): value is StabilityV2Variant {
  return value !== 'legacy';
}
