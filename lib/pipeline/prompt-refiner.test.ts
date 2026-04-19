import { describe, expect, it } from 'vitest';
import { refinePrompt } from './prompt-refiner';

describe('refinePrompt', () => {
  it('classifies simple keywords as simple with grid size 20', () => {
    const r = refinePrompt('a cube');
    expect(r.estimatedComplexity).toBe('simple');
    expect(r.suggestedGridSize).toBe(20);
  });

  it('classifies complex keywords as complex with grid size 30', () => {
    const r = refinePrompt('medieval castle with towers');
    expect(r.estimatedComplexity).toBe('complex');
    expect(r.suggestedGridSize).toBe(30);
  });

  it('defaults ambiguous input to medium with grid size 25', () => {
    const r = refinePrompt('friendly looking turtle');
    expect(r.estimatedComplexity).toBe('medium');
    expect(r.suggestedGridSize).toBe(25);
  });

  it('is case-insensitive for keyword matching', () => {
    expect(refinePrompt('SPACESHIP').estimatedComplexity).toBe('complex');
    expect(refinePrompt('Pyramid').estimatedComplexity).toBe('simple');
  });

  it('preserves user input verbatim (trimmed)', () => {
    const r = refinePrompt('  a spaceship  ');
    expect(r.userInput).toBe('a spaceship');
  });

  it('prepends "a" when input does not start with an article', () => {
    const r = refinePrompt('dragon');
    expect(r.blenderPrompt.startsWith('Create A dragon ')).toBe(true);
  });

  it('does not double-prepend articles', () => {
    expect(refinePrompt('a cat').blenderPrompt.startsWith('Create A cat ')).toBe(true);
    expect(refinePrompt('an apple').blenderPrompt.startsWith('Create An apple ')).toBe(true);
    expect(refinePrompt('the tower').blenderPrompt.startsWith('Create The tower ')).toBe(true);
  });

  it('embeds LEGO palette material names', () => {
    const r = refinePrompt('cube');
    expect(r.blenderPrompt).toContain('LEGO_');
    expect(r.blenderPrompt).toContain('MATERIALS');
    // No whitespace inside material names
    const matches = r.blenderPrompt.match(/LEGO_[A-Za-z_]+/g) ?? [];
    expect(matches.length).toBeGreaterThan(5);
    for (const name of matches) {
      expect(name).not.toMatch(/\s/);
    }
  });
});
