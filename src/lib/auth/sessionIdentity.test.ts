import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSessionEmail,
  authEventRequiresProfileReload,
  hasStaleProfile,
  profileMatchesSession,
} from './sessionIdentity.ts';

const gustavo = {
  id: 'user-gustavo',
  name: 'Gustavo Maciel',
  email: 'gustavo@kaizen.com',
};
const marina = {
  id: 'user-marina',
  name: 'Marina Teste',
  email: 'marinateste@gmail.com',
};

describe('profileMatchesSession', () => {
  it('accepts a profile that belongs to the session user', () => {
    assert.equal(
      profileMatchesSession({ id: marina.id }, { user: { id: marina.id, email: marina.email } }),
      true,
    );
  });

  it('rejects Gustavo profile against Marina session', () => {
    assert.equal(
      profileMatchesSession({ id: gustavo.id }, { user: { id: marina.id, email: marina.email } }),
      false,
    );
  });

  it('rejects missing profile or session', () => {
    assert.equal(profileMatchesSession(null, { user: { id: marina.id } }), false);
    assert.equal(profileMatchesSession({ id: marina.id }, null), false);
    assert.equal(profileMatchesSession({ id: marina.id }, { user: null }), false);
  });
});

describe('hasStaleProfile', () => {
  it('detects the Gustavo-then-Marina mix-up', () => {
    assert.equal(
      hasStaleProfile({ id: gustavo.id }, { user: { id: marina.id, email: marina.email } }),
      true,
    );
  });

  it('is not stale when ids match or profile is still loading', () => {
    assert.equal(
      hasStaleProfile({ id: marina.id }, { user: { id: marina.id, email: marina.email } }),
      false,
    );
    assert.equal(
      hasStaleProfile(null, { user: { id: marina.id, email: marina.email } }),
      false,
    );
  });
});

describe('authEventRequiresProfileReload', () => {
  it('reloads on sign-in, sign-out and user update', () => {
    assert.equal(authEventRequiresProfileReload('SIGNED_IN', null, marina.id), true);
    assert.equal(authEventRequiresProfileReload('SIGNED_OUT', gustavo.id, null), true);
    assert.equal(authEventRequiresProfileReload('USER_UPDATED', marina.id, marina.id), true);
  });

  it('reloads TOKEN_REFRESHED when the user id changes (Gustavo → Marina)', () => {
    assert.equal(
      authEventRequiresProfileReload('TOKEN_REFRESHED', gustavo.id, marina.id),
      true,
    );
  });

  it('does not reload TOKEN_REFRESHED for the same user', () => {
    assert.equal(
      authEventRequiresProfileReload('TOKEN_REFRESHED', marina.id, marina.id),
      false,
    );
  });
});

describe('assertSessionEmail', () => {
  it('accepts matching emails ignoring case and spaces', () => {
    assert.doesNotThrow(() => {
      assertSessionEmail(
        { user: { email: 'MarinaTeste@gmail.com' } },
        '  marinateste@gmail.com  ',
      );
    });
  });

  it('rejects a session that still belongs to Gustavo', () => {
    assert.throws(
      () => assertSessionEmail({ user: { email: gustavo.email } }, marina.email),
      /Sessão não corresponde ao e-mail informado/,
    );
  });
});
