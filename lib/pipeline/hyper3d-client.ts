/**
 * Hyper3D Rodin REST API Client
 *
 * Server-side module for text-to-3D generation via Hyper3D Rodin.
 * API docs: https://developer.hyper3d.ai/api-specification/
 *
 * Workflow:
 *   1. POST /rodin        → submit generation task
 *   2. POST /status        → poll until "Done"
 *   3. POST /download      → get file URLs
 *   4. Fetch .glb file     → save to disk
 *
 * This is additive — does NOT replace the existing MCP-based flow.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TMP_MESHES_DIR } from '@/lib/pipeline/paths';

const RODIN_API = 'https://api.hyper3d.com/api/v2';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120; // 10 minutes max

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerationProgress {
  stage: 'submitting' | 'waiting' | 'generating' | 'downloading' | 'done' | 'failed';
  message: string;
  /** 0-100 */
  progress: number;
}

export interface GenerationResult {
  meshPath: string;
  fileName: string;
  prompt: string;
}

interface RodinSubmitResponse {
  error: string | null;
  message: string;
  uuid: string;
  jobs: {
    uuids: string[];
    subscription_key: string;
  };
}

interface RodinStatusResponse {
  jobs: Record<string, string>[];
}

interface RodinDownloadResponse {
  error: string | null;
  list: Array<{ url: string; name: string }>;
}

// ─── API Key ──────────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.RODIN_API_KEY;
  if (!key) {
    throw new Error(
      'RODIN_API_KEY environment variable is not set. ' +
      'Get your API key at https://developer.hyper3d.ai/',
    );
  }
  return key;
}

// ─── API Calls ────────────────────────────────────────────────────────────────

async function submitTask(prompt: string): Promise<RodinSubmitResponse> {
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('geometry_file_format', 'glb');
  form.append('material', 'PBR');
  form.append('quality', 'medium');

  const res = await fetch(`${RODIN_API}/rodin`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getApiKey()}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Rodin submit failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<RodinSubmitResponse>;
}

async function checkStatus(subscriptionKey: string): Promise<Record<string, string>> {
  const res = await fetch(`${RODIN_API}/status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subscription_key: subscriptionKey }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Rodin status check failed (${res.status}): ${text}`);
  }

  const data = await res.json() as RodinStatusResponse;
  // Response: { jobs: [ { "uuid": "status" }, ... ] }
  // Flatten into a single record
  const statuses: Record<string, string> = {};
  if (Array.isArray(data.jobs)) {
    for (const job of data.jobs) {
      Object.assign(statuses, job);
    }
  }
  return statuses;
}

async function getDownloadUrls(taskUuid: string): Promise<RodinDownloadResponse> {
  const res = await fetch(`${RODIN_API}/download`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ task_uuid: taskUuid }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Rodin download failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<RodinDownloadResponse>;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Main Generator ───────────────────────────────────────────────────────────

/**
 * Generate a 3D model from a text prompt via Hyper3D Rodin.
 *
 * Yields GenerationProgress events for SSE streaming.
 * Returns the final GenerationResult with the local GLB path.
 */
export async function* generateModel(
  prompt: string,
): AsyncGenerator<GenerationProgress, GenerationResult> {
  // Step 1: Submit
  yield { stage: 'submitting', message: 'Submitting to Hyper3D Rodin...', progress: 5 };

  const submitRes = await submitTask(prompt);
  if (submitRes.error) {
    throw new Error(`Rodin error: ${submitRes.error}`);
  }

  const taskUuid = submitRes.uuid;
  const subscriptionKey = submitRes.jobs.subscription_key;
  console.log(`[hyper3d] Task submitted: uuid=${taskUuid}`);

  // Step 2: Poll for completion
  yield { stage: 'waiting', message: 'Waiting in queue...', progress: 10 };

  let lastStatus = 'Waiting';
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const statuses = await checkStatus(subscriptionKey);
    const statusValues = Object.values(statuses);

    // Check for failure
    if (statusValues.some((s) => s === 'Failed')) {
      throw new Error('Hyper3D Rodin generation failed');
    }

    // Check if all done
    const allDone = statusValues.length > 0 && statusValues.every((s) => s === 'Done');
    if (allDone) {
      lastStatus = 'Done';
      break;
    }

    // Report progress
    const isGenerating = statusValues.some((s) => s === 'Generating');
    if (isGenerating && lastStatus !== 'Generating') {
      lastStatus = 'Generating';
      yield { stage: 'generating', message: 'Generating 3D model...', progress: 30 };
    } else if (lastStatus === 'Generating') {
      // Increment progress while generating (30-70 range)
      const pct = Math.min(70, 30 + attempt * 2);
      yield { stage: 'generating', message: 'Generating 3D model...', progress: pct };
    }
  }

  if (lastStatus !== 'Done') {
    throw new Error('Hyper3D Rodin generation timed out');
  }

  yield { stage: 'downloading', message: 'Downloading 3D model...', progress: 75 };

  // Step 3: Get download URLs
  const downloadRes = await getDownloadUrls(taskUuid);
  if (downloadRes.error) {
    throw new Error(`Rodin download error: ${downloadRes.error}`);
  }

  // Find the GLB file
  const glbFile = downloadRes.list.find(
    (f) => f.name.toLowerCase().endsWith('.glb') || f.url.toLowerCase().includes('.glb'),
  );
  if (!glbFile) {
    // Fallback: take the first file
    if (downloadRes.list.length === 0) {
      throw new Error('No files returned from Rodin');
    }
    console.warn('[hyper3d] No .glb found, using first file:', downloadRes.list[0].name);
  }

  const fileToDownload = glbFile || downloadRes.list[0];

  // Step 4: Download the file
  const fileRes = await fetch(fileToDownload.url);
  if (!fileRes.ok) {
    throw new Error(`Failed to download model file: ${fileRes.status}`);
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer());

  // Save to .tmp/meshes/
  await mkdir(TMP_MESHES_DIR, { recursive: true });

  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const fileName = `${runId}.glb`;
  const meshPath = path.join(TMP_MESHES_DIR, fileName);

  await writeFile(meshPath, buffer);
  console.log(`[hyper3d] Model saved: ${meshPath} (${buffer.length} bytes)`);

  yield { stage: 'done', message: 'Model ready!', progress: 100 };

  return {
    meshPath,
    fileName,
    prompt,
  };
}
