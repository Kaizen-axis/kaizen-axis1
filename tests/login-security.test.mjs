import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkLoginRateLimit,
  enforceActiveProfile,
  isLoginCaptchaRequired,
} from '../supabase/functions/_shared/login-security.mjs';

function adminDouble({
  counter = 0,
  counterError = null,
  profile = { status: 'Ativo' },
  profileError = null,
  revokeError = null,
} = {}) {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ type: 'rpc', name, args });
      return { data: counter, error: counterError };
    },
    from: (table) => ({
      select: (columns) => ({
        eq: (column, value) => ({
          single: async () => {
            calls.push({ type: 'profile', table, columns, column, value });
            return { data: profile, error: profileError };
          },
        }),
      }),
    }),
    auth: {
      admin: {
        signOut: async (jwt, scope) => {
          calls.push({ type: 'revoke', jwt, scope });
          return { data: null, error: revokeError };
        },
      },
    },
  };
  return { client, calls };
}

test('login CAPTCHA defaults closed', () => {
  assert.equal(isLoginCaptchaRequired(undefined), true);
  assert.equal(isLoginCaptchaRequired('true'), true);
  assert.equal(isLoginCaptchaRequired('FALSE'), true);
});

test('only literal false opens login break-glass', () => {
  assert.equal(isLoginCaptchaRequired('false'), false);
});

test('rate limit permits a count below the threshold', async () => {
  const { client } = adminDouble({ counter: 9 });
  assert.deepEqual(
    await checkLoginRateLimit({
      adminClient: client,
      ip: '203.0.113.5',
      now: new Date('2026-09-01T15:00:05Z'),
    }),
    { ok: true, status: 200, count: 9, reason: null },
  );
});

test('rate limit blocks the threshold', async () => {
  const { client } = adminDouble({ counter: 10 });
  assert.deepEqual(
    await checkLoginRateLimit({ adminClient: client, ip: '203.0.113.5' }),
    { ok: false, status: 429, count: 10, reason: 'rate_limited' },
  );
});

test('rate limit fails closed on counter error', async () => {
  const { client } = adminDouble({ counterError: { message: 'rpc unavailable' } });
  assert.deepEqual(
    await checkLoginRateLimit({ adminClient: client, ip: '203.0.113.5' }),
    { ok: false, status: 500, count: null, reason: 'counter_error' },
  );
});

test('active profile is accepted without revocation', async () => {
  const { client, calls } = adminDouble({ profile: { status: 'Ativo' } });
  assert.deepEqual(
    await enforceActiveProfile({
      adminClient: client,
      userId: 'user-1',
      accessToken: 'jwt-1',
    }),
    { ok: true, status: 200, reason: null, revocationError: null },
  );
  assert.equal(calls.some((call) => call.type === 'revoke'), false);
});

for (const status of ['Inativo', 'inactive']) {
  test(`profile status ${status} is rejected and its issued session is revoked`, async () => {
    const { client, calls } = adminDouble({ profile: { status } });
    assert.deepEqual(
      await enforceActiveProfile({
        adminClient: client,
        userId: 'user-1',
        accessToken: 'jwt-1',
      }),
      { ok: false, status: 403, reason: 'inactive_profile', revocationError: null },
    );
    assert.deepEqual(
      calls.find((call) => call.type === 'revoke'),
      { type: 'revoke', jwt: 'jwt-1', scope: 'global' },
    );
  });
}

test('profile lookup errors fail closed and revoke the issued session', async () => {
  const { client, calls } = adminDouble({
    profileError: { message: 'database unavailable' },
  });
  assert.deepEqual(
    await enforceActiveProfile({
      adminClient: client,
      userId: 'user-1',
      accessToken: 'jwt-1',
    }),
    {
      ok: false,
      status: 500,
      reason: 'profile_lookup_failed',
      revocationError: null,
    },
  );
  assert.equal(calls.some((call) => call.type === 'revoke'), true);
});

test('invalid auth response fails closed without attempting an empty revocation', async () => {
  const { client, calls } = adminDouble();
  assert.deepEqual(
    await enforceActiveProfile({ adminClient: client, userId: '', accessToken: '' }),
    {
      ok: false,
      status: 500,
      reason: 'invalid_auth_response',
      revocationError: null,
    },
  );
  assert.equal(calls.length, 0);
});
