import type { BrickModelData } from '@/lib/engine/types';

const STORAGE_KEY = 'brickforge:saved-builds';
const MAX_STORAGE_BYTES = 4.5 * 1024 * 1024; // 4.5MB safety margin

export interface SavedBuild {
  id: string;
  name: string;
  description: string;
  totalBricks: number;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  model: BrickModelData;
}

export interface SavedBuildMeta {
  id: string;
  name: string;
  totalBricks: number;
  prompt: string;
  createdAt: string;
  updatedAt: string;
}

/** Read all saved builds from localStorage. Returns empty array on error. */
export function loadAllBuilds(): SavedBuild[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedBuild[];
  } catch {
    return [];
  }
}

/** Metadata-only list for the "My Builds" UI (avoids holding full models in memory). */
export function loadBuildMetaList(): SavedBuildMeta[] {
  return loadAllBuilds().map(({ id, name, totalBricks, prompt, createdAt, updatedAt }) => ({
    id, name, totalBricks, prompt, createdAt, updatedAt,
  }));
}

/** Load a single build by ID. */
export function loadBuild(id: string): SavedBuild | null {
  return loadAllBuilds().find((b) => b.id === id) ?? null;
}

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Save a build. If `existingId` is provided, updates that build in place.
 * Strips diagnostics to save space.
 */
export function saveBuild(
  model: BrickModelData & { diagnostics?: unknown },
  prompt: string,
  existingId?: string,
): SaveResult {
  try {
    const builds = loadAllBuilds();
    const now = new Date().toISOString();

    // Strip diagnostics — pipeline debug data, not needed for rehydration
    const cleanModel = { ...model };
    delete cleanModel.diagnostics;

    const existingIdx = existingId
      ? builds.findIndex((b) => b.id === existingId)
      : -1;

    if (existingIdx >= 0) {
      builds[existingIdx] = {
        ...builds[existingIdx],
        name: cleanModel.name,
        description: cleanModel.description,
        totalBricks: cleanModel.totalBricks,
        model: cleanModel,
        updatedAt: now,
      };
    } else {
      builds.unshift({
        id: crypto.randomUUID().slice(0, 8),
        name: cleanModel.name,
        description: cleanModel.description,
        totalBricks: cleanModel.totalBricks,
        prompt,
        createdAt: now,
        updatedAt: now,
        model: cleanModel,
      });
    }

    const json = JSON.stringify(builds);
    const sizeBytes = json.length * 2; // localStorage uses UTF-16

    if (sizeBytes > MAX_STORAGE_BYTES) {
      return {
        ok: false,
        error: `Storage limit reached (${(sizeBytes / 1024 / 1024).toFixed(1)}MB of ~5MB). Delete some saved builds first.`,
      };
    }

    localStorage.setItem(STORAGE_KEY, json);
    const savedId = existingIdx >= 0 ? builds[existingIdx].id : builds[0].id;
    return { ok: true, id: savedId };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      return { ok: false, error: 'Storage is full. Delete some saved builds to make room.' };
    }
    return { ok: false, error: 'Failed to save build.' };
  }
}

/** Delete a build by ID. Returns true if found and deleted. */
export function deleteBuild(id: string): boolean {
  try {
    const builds = loadAllBuilds();
    const filtered = builds.filter((b) => b.id !== id);
    if (filtered.length === builds.length) return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch {
    return false;
  }
}

/** Approximate storage usage for display. */
export function getStorageInfo(): { usedKB: number; buildCount: number } {
  if (typeof window === 'undefined') return { usedKB: 0, buildCount: 0 };
  const builds = loadAllBuilds();
  const raw = localStorage.getItem(STORAGE_KEY) ?? '';
  return {
    usedKB: Math.round((raw.length * 2) / 1024),
    buildCount: builds.length,
  };
}
