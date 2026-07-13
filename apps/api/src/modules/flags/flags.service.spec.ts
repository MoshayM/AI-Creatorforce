import { resolveFlag, isValidFlagKey } from './flags.service';

describe('resolveFlag — env > db > default precedence', () => {
  it('returns the default when neither env nor db define the flag', () => {
    expect(resolveFlag('new-editor', undefined, undefined, false)).toBe(false);
    expect(resolveFlag('new-editor', undefined, undefined, true)).toBe(true);
  });

  it('db value overrides the default', () => {
    expect(resolveFlag('new-editor', undefined, 'true', false)).toBe(true);
    expect(resolveFlag('new-editor', undefined, 'false', true)).toBe(false);
  });

  it('env boolean overrides the db value', () => {
    expect(resolveFlag('new-editor', '{"new-editor":false}', 'true', true)).toBe(false);
    expect(resolveFlag('new-editor', '{"new-editor":true}', 'false', false)).toBe(true);
  });

  it('env entry for a different key does not apply', () => {
    expect(resolveFlag('new-editor', '{"other-flag":true}', undefined, false)).toBe(false);
  });

  it('non-boolean env entry is ignored', () => {
    expect(resolveFlag('new-editor', '{"new-editor":"yes"}', 'true', false)).toBe(true);
    expect(resolveFlag('new-editor', '{"new-editor":1}', undefined, false)).toBe(false);
  });

  it('malformed env JSON falls through to db/default', () => {
    expect(resolveFlag('new-editor', 'not-json{', 'true', false)).toBe(true);
    expect(resolveFlag('new-editor', 'not-json{', undefined, true)).toBe(true);
  });

  it('db value must be exactly "true" to enable', () => {
    expect(resolveFlag('new-editor', undefined, 'TRUE', false)).toBe(false);
    expect(resolveFlag('new-editor', undefined, '1', false)).toBe(false);
  });
});

describe('isValidFlagKey', () => {
  it('accepts kebab-case identifiers', () => {
    expect(isValidFlagKey('new-editor')).toBe(true);
    expect(isValidFlagKey('a')).toBe(true);
    expect(isValidFlagKey('shorts-v2-pipeline')).toBe(true);
  });

  it('rejects uppercase, spaces, and symbols', () => {
    expect(isValidFlagKey('NewEditor')).toBe(false);
    expect(isValidFlagKey('new editor')).toBe(false);
    expect(isValidFlagKey('flag:sneaky')).toBe(false);
    expect(isValidFlagKey('')).toBe(false);
  });

  it('rejects keys that do not start with a letter or exceed 64 chars', () => {
    expect(isValidFlagKey('1flag')).toBe(false);
    expect(isValidFlagKey('-flag')).toBe(false);
    expect(isValidFlagKey('a'.repeat(65))).toBe(false);
    expect(isValidFlagKey('a'.repeat(64))).toBe(true);
  });
});
