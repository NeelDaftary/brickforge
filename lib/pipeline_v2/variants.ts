export const STABILITY_V2_VARIANTS = ['stability_v2'] as const;

export type StabilityV2Variant = typeof STABILITY_V2_VARIANTS[number];

export const BRICKER_VARIANTS = STABILITY_V2_VARIANTS;

export type BrickerVariant = typeof BRICKER_VARIANTS[number];

export function isBrickerVariant(value: string): value is BrickerVariant {
  return (BRICKER_VARIANTS as readonly string[]).includes(value);
}

export function isStabilityV2Variant(value: BrickerVariant): value is StabilityV2Variant {
  return value === 'stability_v2';
}
