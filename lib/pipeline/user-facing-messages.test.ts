import { describe, expect, it } from 'vitest';
import { buildNotesFromWarnings, userFacingErrorMessage } from './user-facing-messages';

describe('user-facing messages', () => {
  it('groups stability warnings without exposing engine names in the main copy', () => {
    const notes = buildNotesFromWarnings([
      'stability_v2: defects remain after repair. This model may need external support.',
    ]);

    expect(notes).toHaveLength(1);
    expect(notes[0].category).toBe('stability');
    expect(`${notes[0].title} ${notes[0].message}`).not.toContain('stability_v2');
  });

  it('maps color warnings to color notes', () => {
    const notes = buildNotesFromWarnings(['Color: materials may not have been recognized']);

    expect(notes[0].category).toBe('color');
    expect(notes[0].title).toBe('Colors may be simplified');
  });

  it('maps pipeline error codes to actionable copy', () => {
    expect(userFacingErrorMessage({ code: 'BLENDER_UNAVAILABLE', error: 'raw' })).toContain('Blender');
    expect(userFacingErrorMessage({ code: 'UPLOAD_INVALID_FILE', error: 'raw' })).toContain('.blend');
  });
});
