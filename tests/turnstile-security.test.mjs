import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const verifierPath = new URL('../supabase/functions/_shared/turnstile.mjs', import.meta.url);

test('provides a shared server-side Turnstile verifier', async () => {
  assert.equal(existsSync(verifierPath), true, 'shared Turnstile verifier is missing');
  const module = await import(verifierPath.href);
  assert.equal(typeof module.verifyTurnstile, 'function');
});

const { verifyTurnstile } = await import(verifierPath.href);

function resultResponse(result, status = 200) {
  return new Response(JSON.stringify(result), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('redeems a token with the canonical fields and accepts the expected action and hostname', async () => {
  let request;
  const accepted = await verifyTurnstile({
    secret: 'secret-value',
    token: 'fresh-token',
    remoteIp: '203.0.113.5',
    expectedAction: 'axis_auth',
    expectedHostnames: 'app.imobkaizen.com.br,kaizen-axis.space',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return resultResponse({
        success: true,
        action: 'axis_auth',
        hostname: 'app.imobkaizen.com.br',
      });
    },
  });

  assert.equal(accepted, true);
  assert.equal(request.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(request.options.method, 'POST');
  assert.match(String(request.options.body), /secret=secret-value/);
  assert.match(String(request.options.body), /response=fresh-token/);
  assert.match(String(request.options.body), /remoteip=203.0.113.5/);
  assert.ok(request.options.signal, 'siteverify request must have a timeout signal');
});

test('rejects empty and oversized tokens before calling Siteverify', async () => {
  let calls = 0;
  const options = {
    secret: 'secret-value',
    remoteIp: '203.0.113.5',
    expectedAction: 'axis_auth',
    expectedHostnames: 'app.imobkaizen.com.br',
    fetchImpl: async () => {
      calls += 1;
      return resultResponse({ success: true, action: 'axis_auth', hostname: 'app.imobkaizen.com.br' });
    },
  };

  assert.equal(await verifyTurnstile({ ...options, token: '' }), false);
  assert.equal(await verifyTurnstile({ ...options, token: 'x'.repeat(2049) }), false);
  assert.equal(calls, 0);
});

test('rejects a mismatched action or unapproved hostname', async () => {
  const options = {
    secret: 'secret-value',
    token: 'fresh-token',
    remoteIp: '203.0.113.5',
    expectedAction: 'axis_auth',
    expectedHostnames: 'app.imobkaizen.com.br',
  };
  assert.equal(await verifyTurnstile({
    ...options,
    fetchImpl: async () => resultResponse({ success: true, action: 'wrong', hostname: 'app.imobkaizen.com.br' }),
  }), false);
  assert.equal(await verifyTurnstile({
    ...options,
    fetchImpl: async () => resultResponse({ success: true, action: 'axis_auth', hostname: 'evil.example' }),
  }), false);
});

test('fails closed when Siteverify is unavailable or returns invalid data', async () => {
  const options = {
    secret: 'secret-value',
    token: 'fresh-token',
    remoteIp: '203.0.113.5',
    expectedAction: 'axis_auth',
    expectedHostnames: 'app.imobkaizen.com.br',
  };
  assert.equal(await verifyTurnstile({
    ...options,
    fetchImpl: async () => { throw new Error('network unavailable'); },
  }), false);
  assert.equal(await verifyTurnstile({
    ...options,
    fetchImpl: async () => new Response('bad gateway', { status: 502 }),
  }), false);
  assert.equal(await verifyTurnstile({
    ...options,
    fetchImpl: async () => new Response('not json', { status: 200 }),
  }), false);
});

test('binds the shared frontend widget to the stable axis_auth action', () => {
  const login = readFileSync(new URL('../src/pages/Login.tsx', import.meta.url), 'utf8');
  assert.match(login, /const TURNSTILE_ACTION = ['"]axis_auth['"]/);
  assert.match(login, /action:\s*TURNSTILE_ACTION/);
});

for (const functionName of ['secure-login', 'send-password-reset']) {
  test(`${functionName} validates action and hostname through the shared verifier`, () => {
    const source = readFileSync(
      new URL(`../supabase/functions/${functionName}/index.ts`, import.meta.url),
      'utf8',
    );
    assert.match(source, /import \{ verifyTurnstile \} from ['"]\.\.\/_shared\/turnstile\.mjs['"]/);
    assert.match(source, /Deno\.env\.get\(['"]TURNSTILE_HOSTNAMES['"]\)/);
    assert.match(source, /expectedAction:\s*['"]axis_auth['"]/);
    assert.match(source, /await verifyTurnstile\(/);
    assert.doesNotMatch(source, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
  });
}

test('secure-login uses a login-only fail-closed CAPTCHA flag', () => {
  const source = readFileSync(
    new URL('../supabase/functions/secure-login/index.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /Deno\.env\.get\(['"]LOGIN_REQUIRE_CAPTCHA['"]\)/);
  assert.match(source, /isLoginCaptchaRequired\(/);
  assert.doesNotMatch(source, /if \(turnstileSecret\) \{/);
});

test('secure-login rate-limits before password grant', () => {
  const source = readFileSync(
    new URL('../supabase/functions/secure-login/index.ts', import.meta.url),
    'utf8',
  );
  const rateLimitAt = source.indexOf('checkLoginRateLimit(');
  const passwordGrantAt = source.indexOf('/auth/v1/token?grant_type=password');
  assert.ok(rateLimitAt >= 0 && rateLimitAt < passwordGrantAt);
});

test('secure-login gates active status before returning tokens', () => {
  const source = readFileSync(
    new URL('../supabase/functions/secure-login/index.ts', import.meta.url),
    'utf8',
  );
  const passwordGrantAt = source.indexOf('/auth/v1/token?grant_type=password');
  const activeProfileAt = source.indexOf('enforceActiveProfile(');
  const returnTokensAt = source.lastIndexOf('return jsonResponse(authData || {}, 200)');
  assert.ok(activeProfileAt > passwordGrantAt && activeProfileAt < returnTokensAt);
});
