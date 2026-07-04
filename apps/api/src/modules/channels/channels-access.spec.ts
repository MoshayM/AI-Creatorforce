import {
  accessLevelFromScopes, isAccessLevel, ACCESS_PRESETS,
  SCOPE_READONLY, SCOPE_UPLOAD, SCOPE_MANAGE, SCOPE_ANALYTICS,
} from './channels.service';

describe('accessLevelFromScopes', () => {
  it('derives FULL when the manage scope is granted', () => {
    expect(accessLevelFromScopes([SCOPE_READONLY, SCOPE_UPLOAD, SCOPE_MANAGE, SCOPE_ANALYTICS])).toBe('FULL');
  });

  it('derives PUBLISH when upload is granted without manage', () => {
    expect(accessLevelFromScopes([SCOPE_READONLY, SCOPE_UPLOAD])).toBe('PUBLISH');
  });

  it('derives READ_ONLY when only readonly is granted', () => {
    expect(accessLevelFromScopes([SCOPE_READONLY])).toBe('READ_ONLY');
  });

  it('derives NONE when the user unticked every YouTube scope', () => {
    expect(accessLevelFromScopes(['openid', 'email', 'profile'])).toBe('NONE');
  });

  it('round-trips every preset: requesting a level yields that level when fully granted', () => {
    for (const level of ['READ_ONLY', 'PUBLISH', 'FULL'] as const) {
      expect(accessLevelFromScopes(ACCESS_PRESETS[level])).toBe(level);
    }
  });

  it('each preset is a superset of the previous — downgrades never add scopes', () => {
    const ro = new Set(ACCESS_PRESETS.READ_ONLY);
    const pub = new Set(ACCESS_PRESETS.PUBLISH);
    for (const s of ro) expect(pub.has(s)).toBe(true);
    const full = new Set(ACCESS_PRESETS.FULL);
    for (const s of pub) expect(full.has(s)).toBe(true);
  });
});

describe('isAccessLevel', () => {
  it('accepts the three valid levels and rejects everything else', () => {
    expect(isAccessLevel('READ_ONLY')).toBe(true);
    expect(isAccessLevel('PUBLISH')).toBe(true);
    expect(isAccessLevel('FULL')).toBe(true);
    expect(isAccessLevel('ADMIN')).toBe(false);
    expect(isAccessLevel(undefined)).toBe(false);
    expect(isAccessLevel('')).toBe(false);
  });
});
