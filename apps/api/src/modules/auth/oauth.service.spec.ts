import { createHash } from 'node:crypto';
import { decideSignIn, canUnlink, pkcePair } from './oauth.service';

describe('decideSignIn — sign-in path resolution', () => {
  const link = { userId: 'user-1' };
  const sameEmailUser = { id: 'user-2' };

  it('returns LOGIN when an existing link is found (regardless of email match)', () => {
    expect(decideSignIn(link, sameEmailUser, true)).toBe('LOGIN');
    expect(decideSignIn(link, null, false)).toBe('LOGIN');
  });

  it('returns LINK_REQUIRED when no link exists but verified email matches an existing user', () => {
    expect(decideSignIn(null, sameEmailUser, true)).toBe('LINK_REQUIRED');
  });

  it('returns CREATE when no link and email is unverified (no auto-match on unverified email)', () => {
    expect(decideSignIn(null, sameEmailUser, false)).toBe('CREATE');
  });

  it('returns CREATE when no link and no email match', () => {
    expect(decideSignIn(null, null, true)).toBe('CREATE');
    expect(decideSignIn(null, null, false)).toBe('CREATE');
  });
});

describe('canUnlink — last-method guard', () => {
  it('returns false when user has no password and only one link', () => {
    expect(canUnlink(false, 1)).toBe(false);
  });

  it('returns true when user has a password (even with one link)', () => {
    expect(canUnlink(true, 1)).toBe(true);
  });

  it('returns true when user has no password but multiple links', () => {
    expect(canUnlink(false, 2)).toBe(true);
    expect(canUnlink(false, 3)).toBe(true);
  });

  it('returns true when user has password and multiple links', () => {
    expect(canUnlink(true, 3)).toBe(true);
  });
});

describe('pkcePair — PKCE S256', () => {
  it('challenge equals base64url(sha256(verifier)) with no padding', () => {
    const { verifier, challenge } = pkcePair();
    const expected = createHash('sha256').update(verifier).digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('challenge contains no base64 padding characters', () => {
    const { challenge } = pkcePair();
    expect(challenge).not.toMatch(/[+/=]/);
  });

  it('verifier contains no base64 padding characters', () => {
    const { verifier } = pkcePair();
    expect(verifier).not.toMatch(/[+/=]/);
  });

  it('generates unique pairs each call', () => {
    const a = pkcePair();
    const b = pkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });
});
