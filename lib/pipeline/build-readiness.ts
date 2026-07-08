export type BuildReadinessStatus = 'ready' | 'prototype' | 'needs_repair';

export function prototypeUnsupportedLimit(totalBricks: number): number {
  if (totalBricks < 100) return Math.max(1, Math.ceil(totalBricks * 0.05));
  return Math.min(10, Math.max(5, Math.ceil(totalBricks * 0.015)));
}

export function prototypeWeakLimit(totalBricks: number): number {
  if (totalBricks < 100) return Math.max(2, Math.ceil(totalBricks * 0.08));
  return Math.min(20, Math.max(8, Math.ceil(totalBricks * 0.03)));
}

export function buildReadinessStatus({
  totalBricks,
  floating,
  unsupported,
  weak,
  criticalCantilever = 0,
}: {
  totalBricks: number;
  floating: number;
  unsupported: number;
  weak: number;
  criticalCantilever?: number;
}): BuildReadinessStatus {
  if (floating > 0) return 'needs_repair';
  if (criticalCantilever > 0) return 'needs_repair';
  if (unsupported === 0 && weak === 0) return 'ready';
  if (
    unsupported <= prototypeUnsupportedLimit(totalBricks) &&
    weak <= prototypeWeakLimit(totalBricks)
  ) return 'prototype';
  return 'needs_repair';
}
