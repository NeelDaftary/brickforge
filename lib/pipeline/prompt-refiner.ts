/**
 * Prompt Refiner: Takes a user description and generates optimized
 * instructions for Blender MCP model generation.
 *
 * The output is structured for the Blender MCP pipeline:
 * 1. Clean scene + create LEGO materials
 * 2. Generate low-poly, blocky geometry with LEGO materials assigned
 * 3. Apply transforms, verify watertight
 * 4. Bake colors to vertex attributes
 * 5. Export GLB
 */

import { COLOR_PALETTE } from '@/lib/engine/color-palette';

export interface RefinedPrompt {
  blenderPrompt: string;
  userInput: string;
  suggestedGridSize: number;
  estimatedComplexity: 'simple' | 'medium' | 'complex';
}

function classifyComplexity(input: string): 'simple' | 'medium' | 'complex' {
  const lower = input.toLowerCase();

  const simpleKeywords = [
    'cube', 'box', 'sphere', 'ball', 'pyramid', 'cone', 'cylinder',
    'heart', 'star', 'diamond', 'ring', 'donut', 'brick', 'block',
  ];
  const complexKeywords = [
    'castle', 'dragon', 'spaceship', 'city', 'village', 'landscape',
    'mech', 'robot', 'ship', 'building', 'cathedral', 'bridge',
    'train', 'airplane', 'helicopter',
  ];

  if (simpleKeywords.some((k) => lower.includes(k))) return 'simple';
  if (complexKeywords.some((k) => lower.includes(k))) return 'complex';
  return 'medium';
}

function suggestGridSize(complexity: 'simple' | 'medium' | 'complex'): number {
  switch (complexity) {
    case 'simple': return 20;
    case 'medium': return 25;
    case 'complex': return 30;
  }
}

/**
 * Build the list of available LEGO material names for the prompt.
 * Format: "LEGO_Red, LEGO_Blue, LEGO_Green, ..."
 */
function legoMaterialList(): string {
  return COLOR_PALETTE.map((c) => `LEGO_${c.name.replace(/\s+/g, '_')}`).join(', ');
}

/**
 * Refine a user's text description into a Blender MCP generation prompt.
 *
 * The prompt tells the LLM how to build the model in Blender:
 * - Geometry style (low-poly, blocky, LEGO-like)
 * - Material constraints (only LEGO palette)
 * - Mesh requirements (watertight, centered, applied transforms)
 * - Export format (GLB with vertex colors)
 */
export function refinePrompt(userInput: string): RefinedPrompt {
  const trimmed = userInput.trim();
  const complexity = classifyComplexity(trimmed);
  const gridSize = suggestGridSize(complexity);

  const startsWithArticle = /^(a |an |the )/i.test(trimmed);
  const subject = startsWithArticle ? trimmed : `a ${trimmed}`;
  const Subject = subject.charAt(0).toUpperCase() + subject.slice(1);

  const blenderPrompt = `Create ${Subject} as a 3D model in Blender.

STYLE: Low-poly, blocky, LEGO-like. Flat faces, sharp edges, no smooth shading, no subdivisions. Think of how this would look as a real LEGO set — simplified shapes only. Avoid thin features that would be less than 2 studs wide.

MATERIALS: Use ONLY these pre-created LEGO palette materials (already in the scene): ${legoMaterialList()}. Assign materials per-face in Edit Mode. No textures, no gradients, no transparency.

MESH: Single watertight mesh (all parts joined with Ctrl+J). Apply all transforms. Center at origin, bottom at Z=0. Largest dimension ~2 Blender units.

EXPORT: After building, bake material colors into a FLOAT_COLOR vertex attribute named "LEGO_Colors" (CORNER domain, sRGB values), then export as GLB with export_colors='ACTIVE'.`;

  return {
    blenderPrompt,
    userInput: trimmed,
    suggestedGridSize: gridSize,
    estimatedComplexity: complexity,
  };
}
