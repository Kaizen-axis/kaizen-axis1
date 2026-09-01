# Kaizen Axis Existing Turnstile Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the known-good `Kaizen-axis` Turnstile widget, preserve mandatory server-side validation, remove the indefinite loading gate from the login UI, and promote only after real multi-browser validation.

**Architecture:** The existing managed widget remains the single production identity. Vercel embeds its public sitekey, the two Supabase Edge Functions redeem tokens with the matching secret through Siteverify, and production hostname/action allowlists remain fail-closed. Configuration is validated in a canary Preview before the same commit is promoted to production.

**Tech Stack:** React 19, Vite, Node test runner, Cloudflare Turnstile, Wrangler 4.109+, Vercel API, Supabase Management API and Edge Functions.

---

## Safety contract

- Do not create another Turnstile widget.
- Do not expose or persist a widget secret in chat, terminal output, command arguments, temporary files, Git, Vercel build logs, or evidence.
- Do not alter DNS, Cloudflare Tunnel, the self-hosted Supabase stacks, databases, or Storage.
- Keep deployment `dpl_913G8mrshao7Eyuh4cAHzM1Hy215` available as rollback until acceptance passes.
- Stop before secret retrieval until the owner explicitly authorizes installation of a canonical Wrangler 4.109+ outside the repository.
- Do not promote based on unit tests, HTTP 200, a Vercel `READY` state, or a green widget alone. Require a real token, a successful protected request, and rejection of replay.

## File map

- Modify `tests/turnstile/login-gate.test.mjs`: specify the restored non-blocking UI contract.
- Modify `src/pages/Login.tsx`: remove the indefinite loading presentation and token-based button disable while keeping submission fail-closed.
- Preserve `supabase/functions/_shared/turnstile.mjs`: canonical Siteverify adapter.
- Preserve `supabase/functions/secure-login/index.ts`: protected login handler.
- Preserve `supabase/functions/send-password-reset/index.ts`: protected reset handler.
- Create `evidence/incidents/2026-09-01-axis-turnstile-recovery/preflight.json`: sanitized pre-change metadata.
- Create `evidence/incidents/2026-09-01-axis-turnstile-recovery/canary.json`: sanitized Preview acceptance.
- Create `evidence/incidents/2026-09-01-axis-turnstile-recovery/production.json`: sanitized production acceptance or rollback result.

## Task 1: Freeze the current production and widget metadata

**Files:**

- Create: `evidence/incidents/2026-09-01-axis-turnstile-recovery/preflight.json`

- [ ] **Step 1: Verify the local source and preserve unrelated changes**

Run:

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse eb6a71d68fe0d61abf05332d5c70c03de7ff81b1
```

Expected: branch `hotfix/axis-production-turnstile`; preserve the existing newline-only change in `supabase/.temp/cli-latest` and the untracked incident evidence.

- [ ] **Step 2: Capture the live Vercel deployment without secrets**

Query `GET https://api.vercel.com/v13/deployments/www.kaizen-axis.space` with the Vercel token read in memory from `C:/Users/hokma/OneDrive/Desktop/cred.txt`. Record only deployment ID, URL, commit, target, state, aliases, live JS asset and public sitekey.

Expected baseline:

```json
{
  "deployment_id": "dpl_913G8mrshao7Eyuh4cAHzM1Hy215",
  "commit": "eb6a71d68fe0d61abf05332d5c70c03de7ff81b1",
  "ready_state": "READY",
  "current_sitekey": "0x4AAAAAAEjcC8jM74vJaB7u"
}
```

Stop if the alias changed; update the rollback record before proceeding.

- [ ] **Step 3: Capture safe Cloudflare metadata**

List widgets through the Cloudflare API and write only name, sitekey, mode, domains and modification time for:

```text
Kaizen-axis / 0x4AAAAAADOmmf-tlgTOstXw
imobkaizen-axis-auth / 0x4AAAAAAEij91K9KZKNmIxo
imobkaizen-axis-auth-managed-20260831 / 0x4AAAAAAEjcC8jM74vJaB7u
```

Expected: `Kaizen-axis` exists in `managed` mode. Abort if it is missing or disabled.

- [ ] **Step 4: Capture safe Supabase metadata**

Query project `pwvpxxrvlywlneuijmmd` and record:

```json
{
  "secure_login_status": "ACTIVE",
  "send_password_reset_status": "ACTIVE",
  "turnstile_secret_present": true,
  "require_captcha_present": true
}
```

Record presence and fingerprints only, never values.

- [ ] **Step 5: Sanitize and commit the preflight**

Run:

```powershell
rg -n -i '(password|secret["'']?\s*[:=]\s*["''][^<]|authorization|bearer|access.?key)' evidence/incidents/2026-09-01-axis-turnstile-recovery/preflight.json
git diff --check
git add evidence/incidents/2026-09-01-axis-turnstile-recovery/preflight.json
git commit -m "docs(auth): freeze Turnstile recovery preflight"
```

Expected: no credential value is present; commit contains only the new evidence file.

## Task 2: Specify the restored login UX with a failing test

**Files:**

- Modify: `tests/turnstile/login-gate.test.mjs`
- Test: `tests/turnstile/login-gate.test.mjs`

- [ ] **Step 1: Replace the hotfix contract with the desired behavior**

Use this test body:

```js
test('login stays fail-closed without an indefinite loading gate', () => {
  assert.doesNotMatch(source, /Carregando verificação de segurança/);
  assert.doesNotMatch(
    source,
    /disabled=\{loading \|\| \(Boolean\(TURNSTILE_SITE_KEY\) && !captchaToken\)\}/,
  );
  assert.match(source, /disabled=\{loading\}/);
  assert.match(source, /const getCaptchaTokenIfRequired/);
  assert.match(source, /if \(!captchaToken\)/);
  assert.match(source, /Confirme a verificacao de seguranca antes de continuar/);
  assert.match(source, /action:\s*TURNSTILE_ACTION/);
  assert.match(source, /appearance:\s*['"]always['"]/);
  assert.match(source, /Tentar novamente/);
});
```

- [ ] **Step 2: Run the test and prove RED**

Run:

```powershell
node --test tests/turnstile/login-gate.test.mjs
```

Expected: FAIL because the production code still contains the loading message and token-dependent `disabled` expression.

- [ ] **Step 3: Commit only the failing test**

```powershell
git add tests/turnstile/login-gate.test.mjs
git commit -m "test(auth): specify recovered Turnstile login gate"
```

## Task 3: Restore the baseline-style frontend behavior

**Files:**

- Modify: `src/pages/Login.tsx:633-658`
- Test: `tests/turnstile/login-gate.test.mjs`
- Test: `tests/turnstile-security.test.mjs`

- [ ] **Step 1: Remove only the indefinite loading paragraph**

Change the widget block to:

```tsx
{TURNSTILE_SITE_KEY && (
  <div className="space-y-3 pt-1">
    <div ref={captchaContainerRef} className="flex justify-center" />
    {captchaErrorCode && (
      <div className="text-center" role="alert">
        <p className="text-sm text-red-500">
          Falha na verificação de segurança. Código: {captchaErrorCode}
        </p>
        <button
          type="button"
          className="mt-2 text-sm font-medium text-primary-500 hover:underline"
          onClick={retryCaptcha}
        >
          Tentar novamente
        </button>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 2: Restore button availability without weakening the request gate**

Use:

```tsx
<RoundedButton
  type="submit"
  fullWidth
  className="mt-8 py-4 text-base font-semibold shadow-gold-500/20 shadow-lg"
  disabled={loading}
>
```

Do not change `getCaptchaTokenIfRequired()`. It must still throw before any protected request if the token is absent.

- [ ] **Step 3: Run focused tests and prove GREEN**

```powershell
node --test tests/turnstile/login-gate.test.mjs tests/turnstile-security.test.mjs tests/turnstile/diagnostic-page.test.mjs
```

Expected: all focused tests PASS.

- [ ] **Step 4: Run build and regression checks**

```powershell
npm run lint
npm run build
node --test tests/turnstile/*.test.mjs tests/turnstile-security.test.mjs tests/pwa/service-worker.test.mjs
git diff --check
```

Expected: TypeScript, build and all selected tests PASS.

- [ ] **Step 5: Commit the frontend recovery**

```powershell
git add src/pages/Login.tsx
git commit -m "fix(auth): restore non-blocking Turnstile login UI"
```

## Task 4: Recover the existing widget and synchronize its key pair

**Files:**

- No repository file receives a secret.
- Update: Cloudflare widget `0x4AAAAAADOmmf-tlgTOstXw`
- Update: Vercel project `kaizen-axis1`
- Update: Supabase project `pwvpxxrvlywlneuijmmd`

- [ ] **Step 1: Obtain explicit installation authorization**

Required user message:

```text
AUTORIZO INSTALAR WRANGLER 4.109+ E EXECUTAR INLINE
```

Do not infer this permission from spec approval.

- [ ] **Step 2: Install and pin canonical Wrangler outside the project**

After authorization, run:

```powershell
npm install --global wrangler@4.109.0
$wrangler = 'C:\Users\hokma\AppData\Roaming\npm\wrangler.cmd'
& $wrangler --version
```

Expected: exact version `4.109.0`; resolved path is outside the repository. Abort on any other version/path.

- [ ] **Step 3: Authenticate and validate metadata without exposing the secret**

Load the Cloudflare token and account ID from `cred.txt` into process memory without printing them. Run `wrangler turnstile widget get 0x4AAAAAADOmmf-tlgTOstXw --json` with Wrangler logs disabled and sanitized. Parse in memory and require:

```json
{
  "sitekey": "0x4AAAAAADOmmf-tlgTOstXw",
  "name": "Kaizen-axis",
  "mode": "managed"
}
```

Never print the complete response.

- [ ] **Step 4: Update only the hostname list**

Use a Cloudflare `PUT` preserving name `Kaizen-axis`, mode `managed` and the existing secret while setting the exact eight-domain union from the design spec. Fetch metadata again and compare the sorted list exactly.

Expected: eight approved domains; sitekey unchanged.

- [ ] **Step 5: Retrieve and validate the old secret in one guarded process**

Within a single non-debug process:

1. retrieve the widget JSON with canonical Wrangler;
2. validate sitekey, mode and all domains;
3. extract the secret to one non-exported memory variable;
4. POST a dummy response to Siteverify;
5. require `invalid-input-response` and reject `invalid-input-secret`;
6. keep the secret in memory for the Supabase write;
7. unset it immediately after the write.

Expected: secret validity proven without output or disk persistence.

- [ ] **Step 6: Write the matching secret and hostname allowlist to Supabase**

Send an in-memory HTTPS request to the Supabase Management API for project `pwvpxxrvlywlneuijmmd` with:

```text
TURNSTILE_SECRET_KEY=(value held only in the non-exported widgetSecret memory variable)
TURNSTILE_HOSTNAMES=kaizen-axis.space,www.kaizen-axis.space,kaizen-axis1.vercel.app,app.imobkaizen.com.br,staging-app.imobkaizen.com.br,rehearsal-app.imobkaizen.com.br
REQUIRE_CAPTCHA=true
```

The secret value must be supplied through request body/stdin, never a command argument. Confirm secret names and update timestamps only.

- [ ] **Step 7: Update the Vercel public sitekey for Preview only**

Set `VITE_TURNSTILE_SITE_KEY=0x4AAAAAADOmmf-tlgTOstXw` for Preview. This sitekey is public and may be recorded in evidence. Do not change the production target yet.

## Task 5: Deploy and validate a Preview canary

**Files:**

- Create: `evidence/incidents/2026-09-01-axis-turnstile-recovery/canary.json`

- [ ] **Step 1: Push the current commit and wait for Preview**

```powershell
git push origin hotfix/axis-production-turnstile
```

Query Vercel until the deployment for the exact current commit is `READY`. Do not use a prior Preview.

- [ ] **Step 2: Authorize the exact Preview hostname**

Add the generated Preview hostname to the existing widget with another guarded `PUT`, preserving the full domain union. Remove it after acceptance if Vercel supplies a one-off hostname not used by the stable branch alias.

- [ ] **Step 3: Run technical canary checks**

Require:

- page HTTP 200;
- bundle contains only `0x4AAAAAADOmmf-tlgTOstXw`;
- challenge script loads;
- no `300030` callback for five consecutive fresh page loads;
- missing token does not call `secure-login`;
- invalid token is rejected by `secure-login`;
- real fresh token reaches Siteverify and permits the handler to continue;
- replaying that token returns a CAPTCHA rejection.

- [ ] **Step 4: Run the real browser matrix**

The owner validates the exact Preview in:

```text
Chrome normal
Edge normal
Edge InPrivate
Safari mobile
```

Every browser must render the widget promptly and complete one real login. A single `300030` fails the gate.

- [ ] **Step 5: Confirm Cloudflare token-validation analytics**

Verify that `Kaizen-axis` now records server-side validation. Record counts/status only, not tokens, IPs, e-mails or secrets.

- [ ] **Step 6: Sanitize and commit canary evidence**

```powershell
rg -n -i '(password|secret["'']?\s*[:=]\s*["''][^<]|authorization|bearer|access.?key|captchaToken)' evidence/incidents/2026-09-01-axis-turnstile-recovery/canary.json
git diff --check
git add evidence/incidents/2026-09-01-axis-turnstile-recovery/canary.json
git commit -m "docs(auth): certify existing Turnstile canary"
```

Expected: evidence contains only sanitized PASS/FAIL results and identifiers.

## Task 6: Promote the certified artifact and verify production

**Files:**

- Create: `evidence/incidents/2026-09-01-axis-turnstile-recovery/production.json`

- [ ] **Step 1: Set the production Vercel sitekey**

Set production `VITE_TURNSTILE_SITE_KEY` to `0x4AAAAAADOmmf-tlgTOstXw`. Confirm the Supabase secret fingerprint/timestamp still matches the canary configuration.

- [ ] **Step 2: Promote exactly the certified commit**

Create a production deployment from the same Git commit that passed canary. Do not rebuild from a different dirty worktree state. Wait for `READY`, then verify the aliases point to it.

- [ ] **Step 3: Run production acceptance**

Repeat the four-browser matrix and the real token/replay checks at:

```text
https://www.kaizen-axis.space/login
https://kaizen-axis.space/login
```

Also verify invalid credentials still return a credential error rather than a CAPTCHA/configuration error.

- [ ] **Step 4: Roll back on any hard failure**

If rendering, real login, Siteverify or replay validation fails, immediately re-alias production to `dpl_913G8mrshao7Eyuh4cAHzM1Hy215`. Record the failed deployment ID and sanitized reason. Do not stack another hotfix.

- [ ] **Step 5: Record and commit the result**

```powershell
rg -n -i '(password|secret["'']?\s*[:=]\s*["''][^<]|authorization|bearer|access.?key|captchaToken)' evidence/incidents/2026-09-01-axis-turnstile-recovery/production.json
git diff --check
git add evidence/incidents/2026-09-01-axis-turnstile-recovery/production.json
git commit -m "docs(auth): record Axis Turnstile production recovery"
git push origin hotfix/axis-production-turnstile
```

Expected: production evidence says PASS with deployment/commit/browser matrix, or explicitly records rollback. Do not claim completion on partial acceptance.
