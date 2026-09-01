# Kaizen Axis Safe Login Break-Glass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore production login for existing users without requiring a Turnstile token while preserving fail-closed rate limiting, blocking inactive users server-side, keeping MFA in the login flow, disabling public signup, and leaving password reset protected.

**Architecture:** A login-only flag defaults to CAPTCHA required on both backend and frontend; only the literal value `false` enables break-glass. Shared, unit-tested backend helpers own the IP rate limit and active-profile gate. Turnstile secrets remain stored, password reset keeps its current CAPTCHA enforcement, and public signup is disabled server-side before the login bypass is promoted.

**Tech Stack:** React 19, Vite, Supabase Auth and Edge Functions, Node test runner, Vercel REST API, Supabase Management API.

---

## Safety contract

- Work only in branch `hotfix/axis-login-break-glass-20260901` and its isolated worktree.
- Do not delete or print `TURNSTILE_SECRET_KEY`; do not alter the Turnstile widget.
- Do not change DNS, Tunnel, database schema, Storage, self-hosted stacks, or migration gates.
- Keep production deployment `dpl_DPudFscaojnvaymCuvfP8sJpjgX9` available for rollback.
- `LOGIN_REQUIRE_CAPTCHA` and `VITE_LOGIN_REQUIRE_CAPTCHA` default to required; only literal lowercase `false` disables the login gate.
- `REQUIRE_CAPTCHA=true` remains unchanged for `send-password-reset`.
- Never use a real customer's credentials for probes. Real MFA/browser acceptance is performed by the owner.
- Stop and roll back if rate limiting, inactive-user rejection, signup blocking, or MFA flow cannot be proven.

## File map

- Create `supabase/functions/_shared/login-security.mjs`: fail-closed flag parsing, IP rate limiting, active-profile check, and issued-session revocation.
- Create `tests/login-security.test.mjs`: executable unit tests for the shared backend security helpers.
- Modify `supabase/functions/secure-login/index.ts`: use the login-only CAPTCHA flag and shared security helpers.
- Modify `tests/turnstile-security.test.mjs`: source-contract tests for ordering and login-only flag semantics.
- Modify `src/pages/Login.tsx`: bypass CAPTCHA only for existing-user login, suppress signup UI, and mark password reset temporarily unavailable in break-glass mode.
- Modify `tests/turnstile/login-gate.test.mjs`: source-contract tests for the frontend fail-closed default and break-glass behavior.
- Create `evidence/incidents/2026-09-01-axis-login-break-glass/preflight.json`: sanitized pre-change metadata.
- Create `evidence/incidents/2026-09-01-axis-login-break-glass/preview.json`: sanitized backend and Preview gates.
- Create `evidence/incidents/2026-09-01-axis-login-break-glass/production.json`: sanitized promotion or rollback result.

### Task 1: Freeze the production state

**Files:**
- Create: `evidence/incidents/2026-09-01-axis-login-break-glass/preflight.json`

- [ ] **Step 1: Query safe live metadata**

Read the Vercel and Supabase access tokens from `C:/Users/hokma/OneDrive/Desktop/cred.txt` into process-local variables without printing them. Obtain `captured_at_utc` from `(Get-Date).ToUniversalTime().ToString('o')` and obtain the branch/head from `git branch --show-current` and `git rev-parse HEAD`. Capture only those values plus the Vercel deployment ID, source commit, state, aliases, live asset/sitekey, Supabase function versions, secret-name presence, `disable_signup`, and native-CAPTCHA boolean.

The pre-change invariants are production source commit `81ad216596b8cf0794fc62a1ea6144f42b677a20`, deployment `dpl_DPudFscaojnvaymCuvfP8sJpjgX9`, asset `/assets/index-tgovRYJC.js`, public sitekey `0x4AAAAAADOmmf-tlgTOstXw`, Supabase project `pwvpxxrvlywlneuijmmd`, `secure-login` version 48, `send-password-reset` version 13, Turnstile secret present, public signup enabled, and native CAPTCHA disabled. Stop if the live source commit differs; rebase the worktree and replace the rollback identifiers before proceeding.

- [ ] **Step 2: Write and sanitize preflight evidence**

Use `apply_patch` to create the JSON with actual safe values, then run:

```powershell
rg -n -i '(password|authorization|bearer|access.?key|captchaToken|secret["'']?\s*[:=]\s*["''][^<])' evidence/incidents/2026-09-01-axis-login-break-glass/preflight.json
git diff --check
```

Expected: the scan prints no credential value and `git diff --check` exits 0.

- [ ] **Step 3: Commit preflight evidence**

```powershell
git add evidence/incidents/2026-09-01-axis-login-break-glass/preflight.json
git commit -m "docs(auth): freeze login break-glass preflight"
```

### Task 2: Build tested backend security helpers

**Files:**
- Create: `tests/login-security.test.mjs`
- Create: `supabase/functions/_shared/login-security.mjs`

- [ ] **Step 1: Write the failing helper tests**

Create `tests/login-security.test.mjs` with tests that import the not-yet-created module and assert:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkLoginRateLimit,
  enforceActiveProfile,
  isLoginCaptchaRequired,
} from '../supabase/functions/_shared/login-security.mjs';

function adminDouble({ counter = 0, counterError = null, profile = { status: 'Ativo' }, profileError = null, revokeError = null } = {}) {
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

test('login CAPTCHA defaults closed and only literal false opens break-glass', () => {
  assert.equal(isLoginCaptchaRequired(undefined), true);
  assert.equal(isLoginCaptchaRequired('true'), true);
  assert.equal(isLoginCaptchaRequired('FALSE'), true);
  assert.equal(isLoginCaptchaRequired('false'), false);
});

test('rate limit permits a count below the limit', async () => {
  const { client } = adminDouble({ counter: 9 });
  assert.deepEqual(await checkLoginRateLimit({ adminClient: client, ip: '203.0.113.5', now: new Date('2026-09-01T15:00:05Z') }), {
    ok: true, status: 200, count: 9, reason: null,
  });
});

test('rate limit blocks the threshold and fails closed on counter error', async () => {
  const limited = adminDouble({ counter: 10 });
  assert.equal((await checkLoginRateLimit({ adminClient: limited.client, ip: '203.0.113.5' })).status, 429);
  const broken = adminDouble({ counterError: { message: 'rpc unavailable' } });
  assert.deepEqual(await checkLoginRateLimit({ adminClient: broken.client, ip: '203.0.113.5' }), {
    ok: false, status: 500, count: null, reason: 'counter_error',
  });
});

test('active profile is accepted without revocation', async () => {
  const { client, calls } = adminDouble({ profile: { status: 'Ativo' } });
  assert.deepEqual(await enforceActiveProfile({ adminClient: client, userId: 'user-1', accessToken: 'jwt-1' }), {
    ok: true, status: 200, reason: null, revocationError: null,
  });
  assert.equal(calls.some((call) => call.type === 'revoke'), false);
});

test('inactive profile is rejected and its issued session is revoked', async () => {
  const { client, calls } = adminDouble({ profile: { status: 'Inativo' } });
  assert.equal((await enforceActiveProfile({ adminClient: client, userId: 'user-1', accessToken: 'jwt-1' })).status, 403);
  assert.deepEqual(calls.find((call) => call.type === 'revoke'), { type: 'revoke', jwt: 'jwt-1', scope: 'global' });
});

test('profile lookup errors fail closed and revoke the issued session', async () => {
  const { client, calls } = adminDouble({ profileError: { message: 'database unavailable' } });
  assert.equal((await enforceActiveProfile({ adminClient: client, userId: 'user-1', accessToken: 'jwt-1' })).status, 500);
  assert.equal(calls.some((call) => call.type === 'revoke'), true);
});
```

- [ ] **Step 2: Run the helper tests and prove RED**

```powershell
node --test tests/login-security.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `login-security.mjs`.

- [ ] **Step 3: Implement the minimal helper module**

Create `supabase/functions/_shared/login-security.mjs`:

```js
export const LOGIN_LIMIT = Object.freeze({ limit: 10, windowSeconds: 60 });

export function isLoginCaptchaRequired(rawValue) {
  return rawValue !== 'false';
}

function truncateToWindow(date, windowSeconds) {
  const ms = Math.floor(date.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000;
  return new Date(ms).toISOString();
}

export async function checkLoginRateLimit({ adminClient, ip, now = new Date() }) {
  const windowStart = truncateToWindow(now, LOGIN_LIMIT.windowSeconds);
  const { data, error } = await adminClient.rpc('increment_request_counter', {
    _scope: 'login',
    _identifier: ip,
    _window_start: windowStart,
  });
  if (error) return { ok: false, status: 500, count: null, reason: 'counter_error' };
  const count = typeof data === 'number' ? data : (data?.count ?? 0);
  if (count >= LOGIN_LIMIT.limit) return { ok: false, status: 429, count, reason: 'rate_limited' };
  return { ok: true, status: 200, count, reason: null };
}

async function revokeIssuedSession(adminClient, accessToken) {
  try {
    const { error } = await adminClient.auth.admin.signOut(accessToken, 'global');
    return error?.message || null;
  } catch {
    return 'revocation_exception';
  }
}

export async function enforceActiveProfile({ adminClient, userId, accessToken }) {
  if (!userId || !accessToken) {
    return { ok: false, status: 500, reason: 'invalid_auth_response', revocationError: null };
  }
  const { data, error } = await adminClient
    .from('profiles')
    .select('status')
    .eq('id', userId)
    .single();
  if (error) {
    const revocationError = await revokeIssuedSession(adminClient, accessToken);
    return { ok: false, status: 500, reason: 'profile_lookup_failed', revocationError };
  }
  const status = String(data?.status || '').trim().toLowerCase();
  if (status === 'inativo' || status === 'inactive') {
    const revocationError = await revokeIssuedSession(adminClient, accessToken);
    return { ok: false, status: 403, reason: 'inactive_profile', revocationError };
  }
  return { ok: true, status: 200, reason: null, revocationError: null };
}
```

- [ ] **Step 4: Run tests and prove GREEN**

```powershell
node --test tests/login-security.test.mjs
```

Expected: 6 tests pass, 0 fail.

- [ ] **Step 5: Commit the helper and tests**

```powershell
git add tests/login-security.test.mjs supabase/functions/_shared/login-security.mjs
git commit -m "feat(auth): add fail-closed login security helpers"
```

### Task 3: Wire the backend break-glass without bypassing rate limits

**Files:**
- Modify: `tests/turnstile-security.test.mjs`
- Modify: `supabase/functions/secure-login/index.ts`

- [ ] **Step 1: Add failing backend source-contract tests**

Append tests that require `secure-login` to import the shared helpers, parse `LOGIN_REQUIRE_CAPTCHA`, run the counter before password grant, and enforce the active profile before returning auth data:

```js
test('secure-login uses a login-only fail-closed CAPTCHA flag', () => {
  const source = readFileSync(new URL('../supabase/functions/secure-login/index.ts', import.meta.url), 'utf8');
  assert.match(source, /Deno\.env\.get\(['"]LOGIN_REQUIRE_CAPTCHA['"]\)/);
  assert.match(source, /isLoginCaptchaRequired\(/);
  assert.doesNotMatch(source, /if \(turnstileSecret\) \{/);
});

test('secure-login rate-limits before password grant and gates active status before returning tokens', () => {
  const source = readFileSync(new URL('../supabase/functions/secure-login/index.ts', import.meta.url), 'utf8');
  const rateLimitAt = source.indexOf('checkLoginRateLimit(');
  const passwordGrantAt = source.indexOf('/auth/v1/token?grant_type=password');
  const activeProfileAt = source.indexOf('enforceActiveProfile(');
  const returnTokensAt = source.lastIndexOf('return jsonResponse(authData || {}, 200)');
  assert.ok(rateLimitAt >= 0 && rateLimitAt < passwordGrantAt);
  assert.ok(activeProfileAt > passwordGrantAt && activeProfileAt < returnTokensAt);
});
```

- [ ] **Step 2: Run focused tests and prove RED**

```powershell
node --test tests/turnstile-security.test.mjs tests/login-security.test.mjs
```

Expected: the two new source-contract tests fail.

- [ ] **Step 3: Replace local security logic with shared helpers**

In `secure-login/index.ts`:

```ts
import {
  checkLoginRateLimit,
  enforceActiveProfile,
  isLoginCaptchaRequired,
} from '../_shared/login-security.mjs';
```

Remove the local `LOGIN_LIMIT` and `truncateToWindow`. Parse and enforce CAPTCHA as:

```ts
const requireCaptcha = isLoginCaptchaRequired(Deno.env.get('LOGIN_REQUIRE_CAPTCHA'));
const turnstileSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
const turnstileHostnames = Deno.env.get('TURNSTILE_HOSTNAMES');
if (requireCaptcha && (!turnstileSecret || !turnstileHostnames)) {
  console.error('[secure-login] configuracao obrigatoria do Turnstile ausente');
  return jsonResponse({ message: 'Servico temporariamente indisponivel. Tente novamente em instantes.' }, 503);
}
if (requireCaptcha) {
  const verified = await verifyTurnstile({
    secret: turnstileSecret,
    token: captchaToken,
    remoteIp: ip,
    expectedAction: 'axis_auth',
    expectedHostnames: turnstileHostnames,
  });
  if (!verified) return jsonResponse({ message: 'Verificacao de seguranca invalida ou expirada. Tente novamente.' }, 400);
}
```

Create the admin client immediately after parsing the request, then run:

```ts
const rateLimit = await checkLoginRateLimit({ adminClient, ip });
if (!rateLimit.ok) {
  if (rateLimit.status === 429) return jsonResponse({ message: 'Muitas tentativas. Aguarde antes de tentar novamente.' }, 429);
  return jsonResponse({ message: 'Falha ao aplicar limite de seguranca' }, 500);
}
```

After a successful password grant and before returning tokens:

```ts
const activeProfile = await enforceActiveProfile({
  adminClient,
  userId: authData?.user?.id,
  accessToken: authData?.access_token,
});
if (!activeProfile.ok) {
  if (activeProfile.revocationError) console.error('[secure-login] issued session revocation failed');
  if (activeProfile.status === 403) return jsonResponse({ message: 'Sua conta esta inativa. Fale com o administrador.' }, 403);
  return jsonResponse({ message: 'Nao foi possivel validar o status da conta.' }, 500);
}
```

- [ ] **Step 4: Run backend tests and prove GREEN**

```powershell
node --test tests/login-security.test.mjs tests/turnstile-security.test.mjs
```

Expected: all backend security tests pass.

- [ ] **Step 5: Commit backend wiring**

```powershell
git add tests/turnstile-security.test.mjs supabase/functions/secure-login/index.ts
git commit -m "fix(auth): gate login break-glass with server controls"
```

### Task 4: Make the frontend bypass login only

**Files:**
- Modify: `tests/turnstile/login-gate.test.mjs`
- Modify: `src/pages/Login.tsx`

- [ ] **Step 1: Replace the frontend test contract and prove RED**

Require these source contracts:

```js
test('break-glass is login-only and defaults fail-closed', () => {
  assert.match(source, /const LOGIN_CAPTCHA_REQUIRED = import\.meta\.env\.VITE_LOGIN_REQUIRE_CAPTCHA !== ['"]false['"]/);
  assert.match(source, /getCaptchaTokenIfRequired\(LOGIN_CAPTCHA_REQUIRED\)/);
  assert.match(source, /getCaptchaTokenIfRequired\(true\)/);
  assert.match(source, /LOGIN_CAPTCHA_REQUIRED \|\| !isLogin/);
  assert.match(source, /Recuperacao de senha temporariamente indisponivel/);
  assert.match(source, /LOGIN_CAPTCHA_REQUIRED && \(/);
});
```

Run:

```powershell
node --test tests/turnstile/login-gate.test.mjs
```

Expected: FAIL because `VITE_LOGIN_REQUIRE_CAPTCHA` is not implemented.

- [ ] **Step 2: Implement the fail-closed frontend flag**

Add:

```ts
const LOGIN_CAPTCHA_REQUIRED = import.meta.env.VITE_LOGIN_REQUIRE_CAPTCHA !== 'false';
```

Change token lookup to accept an explicit requirement:

```ts
const getCaptchaTokenIfRequired = (required: boolean) => {
  if (!required) return null;
  if (!TURNSTILE_SITE_KEY) throw new Error('Verificacao de seguranca indisponivel. Tente novamente em instantes.');
  if (!captchaToken) throw new Error('Confirme a verificacao de seguranca antes de continuar.');
  return captchaToken;
};
```

The widget effect and JSX render only when:

```ts
const shouldRenderCaptcha = LOGIN_CAPTCHA_REQUIRED || !isLogin;
```

Login calls `getCaptchaTokenIfRequired(LOGIN_CAPTCHA_REQUIRED)`. Signup keeps `getCaptchaTokenIfRequired(true)` but its UI switch is rendered only inside `LOGIN_CAPTCHA_REQUIRED && (...)`.

Extract the current password-reset callback into this complete handler:

```ts
const handlePasswordResetRequest = async () => {
  if (!LOGIN_CAPTCHA_REQUIRED) {
    alert('Recuperacao de senha temporariamente indisponivel. Contate o administrador.');
    return;
  }
  try {
    const email = formData.email.trim();
    if (!email) {
      alert('Digite seu e-mail no campo acima antes de clicar em "Esqueceu a senha?".');
      return;
    }
    const captchaTokenValue = getCaptchaTokenIfRequired(true);
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('send-password-reset', {
      body: { email, captchaToken: captchaTokenValue },
    });
    resetCaptcha();
    if (error) {
      let message = 'Nao foi possivel enviar o e-mail agora. Tente novamente em instantes.';
      try {
        const response = (error as any).context;
        if (response) {
          const errData = await response.json().catch(() => ({}));
          message = errData?.message || message;
        }
      } catch { /* mantem mensagem generica */ }
      alert(message);
    } else {
      alert(data?.message || 'Se o e-mail estiver cadastrado, voce recebera o link de redefinicao em instantes.');
    }
  } catch (error: any) {
    alert(error?.message || 'Falha ao iniciar redefinicao de senha.');
    resetCaptcha();
  } finally {
    setLoading(false);
  }
};
```

Replace the password-reset control with:

```tsx
{LOGIN_CAPTCHA_REQUIRED ? (
  <button
    type="button"
    className="text-xs font-semibold text-gold-600 hover:text-gold-500 transition-colors"
    onClick={handlePasswordResetRequest}
  >
    Esqueceu a senha?
  </button>
) : (
  <p className="text-xs text-text-secondary" role="status">
    Recuperacao de senha temporariamente indisponivel. Contate o administrador.
  </p>
)}
```

- [ ] **Step 3: Run frontend tests and prove GREEN**

```powershell
node --test tests/turnstile/login-gate.test.mjs tests/turnstile/diagnostic-page.test.mjs tests/pwa/service-worker.test.mjs
```

Expected: all frontend and PWA focused tests pass.

- [ ] **Step 4: Commit frontend break-glass**

```powershell
git add tests/turnstile/login-gate.test.mjs src/pages/Login.tsx
git commit -m "fix(auth): limit CAPTCHA bypass to existing-user login"
```

### Task 5: Verify the local candidate

**Files:**
- Create: `evidence/incidents/2026-09-01-axis-login-break-glass/preview.json` after deployment, not in this task.

- [ ] **Step 1: Run all incident tests**

```powershell
node --test tests/login-security.test.mjs tests/turnstile/*.test.mjs tests/turnstile-security.test.mjs tests/pwa/service-worker.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run build and bounded typecheck**

```powershell
npm run build
npm run lint
```

Expected: build exits 0. The baseline typecheck previously exceeded 15 minutes without output; give it the same 15-minute bound and record PASS or `baseline-compatible-timeout`, never silently call timeout a pass.

- [ ] **Step 3: Inspect generated bundles in required and break-glass modes**

Build once without `VITE_LOGIN_REQUIRE_CAPTCHA=false` and once with it. In required mode the bundle must contain the Turnstile script and token-required message. In break-glass mode the source contract must show that login does not require the token while signup/reset remain closed by UI/server gates.

- [ ] **Step 4: Verify diff hygiene**

```powershell
git diff --check
git status --short --branch
```

Expected: only planned files differ and no credential/evidence leak exists.

### Task 6: Deploy the backend with the safe default

**Files:**
- Update external: Supabase function `secure-login` in project `pwvpxxrvlywlneuijmmd`.

- [ ] **Step 1: Resolve the current version with the installed Supabase CLI**

Use the installed canonical executable `C:/Users/hokma/scoop/shims/supabase.exe`. Load the Supabase access token from `cred.txt` into `SUPABASE_ACCESS_TOKEN` without printing it, run `supabase --version`, and query `supabase functions list --project-ref pwvpxxrvlywlneuijmmd --output json`. Require `secure-login` to match the preflight version and `verify_jwt=true`, then unset `SUPABASE_ACCESS_TOKEN` after the command block.

- [ ] **Step 2: Deploy with `LOGIN_REQUIRE_CAPTCHA` absent**

Load the access token again and run exactly:

```powershell
& 'C:\Users\hokma\scoop\shims\supabase.exe' functions deploy secure-login --project-ref pwvpxxrvlywlneuijmmd
```

Do not pass `--no-verify-jwt` and do not set the flag yet. Because absence defaults to required, empty-token synthetic credentials must still return CAPTCHA rejection (`400`), proving behavior is unchanged. Unset `SUPABASE_ACCESS_TOKEN` immediately after deployment.

- [ ] **Step 3: Confirm rate limit and function health**

Verify function status `ACTIVE`, the new version number, CORS from the approved origin, and that malformed input returns `400` without reaching password grant.

Stop and redeploy the preflight function version if the default behaves open.

### Task 7: Close signup, enable backend break-glass, and certify Preview

**Files:**
- Create: `evidence/incidents/2026-09-01-axis-login-break-glass/preview.json`
- Update external: Supabase Auth config and secrets; Vercel Preview environment.

- [ ] **Step 1: Disable public signup server-side**

PATCH Supabase Auth config for `pwvpxxrvlywlneuijmmd` with only:

```json
{ "disable_signup": true }
```

Fetch the config again and require `disable_signup=true`. Send a synthetic direct signup request and require a server rejection without creating a user.

- [ ] **Step 2: Set the login-only backend flag**

Write only `LOGIN_REQUIRE_CAPTCHA=false` through the Supabase Management API. Leave `REQUIRE_CAPTCHA`, `TURNSTILE_SECRET_KEY`, and `TURNSTILE_HOSTNAMES` unchanged. Confirm the new secret name and timestamp without printing values.

- [ ] **Step 3: Run backend probes immediately**

Require:

- empty CAPTCHA plus invalid synthetic credentials returns `401`;
- malformed body returns `400`;
- repeated synthetic invalid credentials reach `429` at the configured threshold;
- counter failure remains covered by executable unit test;
- `send-password-reset` without a token still returns CAPTCHA rejection, not downstream email behavior.

For inactive-user proof, use only an owner-approved synthetic inactive account. Require `403`; never record its credentials or tokens.

- [ ] **Step 4: Configure and deploy Vercel Preview**

Create/update branch-scoped Preview env:

```json
{
  "key": "VITE_LOGIN_REQUIRE_CAPTCHA",
  "value": "false",
  "type": "plain",
  "target": ["preview"],
  "gitBranch": "hotfix/axis-login-break-glass-20260901"
}
```

Push the branch, wait for the deployment of the exact HEAD commit to become `READY`, and do not alias production.

- [ ] **Step 5: Run Preview acceptance**

Technical gates:

- `/login` returns 200;
- login bundle contains the break-glass flag result and does not request Turnstile on login;
- invalid credentials return `401`;
- signup UI is absent and direct signup is server-rejected;
- password reset displays the temporary-unavailable notice;
- no `300030` can block the login submission.

Owner gates on the exact Preview URL:

- Chrome normal login succeeds;
- Edge normal login succeeds;
- Edge InPrivate login succeeds;
- Safari mobile login succeeds;
- an MFA-enrolled account cannot finish navigation without the valid second factor.

- [ ] **Step 6: Record and commit sanitized Preview evidence**

The evidence contains deployment ID, commit, statuses, browser matrix, function version, and config booleans only. Scan and commit:

```powershell
rg -n -i '(password|authorization|bearer|access.?key|captchaToken|secret["'']?\s*[:=]\s*["''][^<])' evidence/incidents/2026-09-01-axis-login-break-glass/preview.json
git add evidence/incidents/2026-09-01-axis-login-break-glass/preview.json
git commit -m "docs(auth): certify login break-glass preview"
```

### Task 8: Promote or roll back production

**Files:**
- Create: `evidence/incidents/2026-09-01-axis-login-break-glass/production.json`
- Update external: Vercel Production environment and deployment alias.

- [ ] **Step 1: Stage a production-target build of the certified commit**

Set `VITE_LOGIN_REQUIRE_CAPTCHA=false` for Production, create a production-target deployment from the exact certified commit without assigning aliases, and wait for `READY`. Verify its generated URL before promotion.

- [ ] **Step 2: Run pre-alias gates**

Repeat HTTP, bundle, invalid-credential, signup-block, password-reset, inactive-account, and MFA checks against the staged deployment. Any failure aborts promotion.

- [ ] **Step 3: Promote and verify production**

Assign `kaizen-axis.space`, `www.kaizen-axis.space`, and existing project aliases only to the staged deployment. Immediately repeat:

- four-browser real login matrix;
- invalid credential `401`;
- inactive synthetic account `403`;
- signup server rejection;
- MFA challenge completion;
- login rate limit;
- password-reset CAPTCHA remains required.

- [ ] **Step 4: Roll back on any hard failure**

Re-alias `dpl_DPudFscaojnvaymCuvfP8sJpjgX9`, set `LOGIN_REQUIRE_CAPTCHA=true`, restore the previous `secure-login` function version if required, and keep `disable_signup=true` until the CAPTCHA flow is safely restored. Do not stack another production hotfix.

- [ ] **Step 5: Record and commit the outcome**

Create sanitized `production.json` with PASS or explicit rollback result. Then:

```powershell
git add evidence/incidents/2026-09-01-axis-login-break-glass/production.json
git commit -m "docs(auth): record login break-glass production result"
git push origin hotfix/axis-login-break-glass-20260901
```

## Completion criteria

- Existing users can log in without Turnstile in the required browser matrix.
- Rate limiting remains server-side and fail-closed.
- Inactive profiles are rejected server-side and issued sessions are revoked.
- Public signup is disabled server-side.
- Password reset has no CAPTCHA bypass.
- MFA behavior is preserved and tested with an enrolled account.
- Turnstile secret/sitekey remain available for rollback and future canary repair.
- Production result and rollback identifiers are recorded without credentials.
