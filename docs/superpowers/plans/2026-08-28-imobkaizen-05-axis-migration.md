# Kaizen Axis Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Build, test, and rehearse migration of the exact Kaizen Axis Vercel production SHA, its Node `/api/apuracao`, managed Supabase database/Auth/Realtime/Storage, and all 17 Edge Functions to the isolated Axis stack on the VPS.

**Architecture:** Root all changes at `10c8f8b6f7e61cb008fe1a1eab62148a614d059d`. Serve the Vite PWA and Node API under the single origin `app.imobkaizen.com.br`; the browser reaches Supabase at `api-app.imobkaizen.com.br`. Introduce a no-store public runtime-config endpoint so the same approved frontend digest can move from staging to production without rebuilding. Nginx serves the SPA and proxies `/api/*` to an internal Express service. Database/Storage migration is rehearsed and reconciled under an authoritative database write freeze, with integrations paused.

**Tech Stack:** Vite 6/React 19/TypeScript, PWA service worker, Express 4, tsup, Supabase JS 2, Supabase self-hosted Edge Runtime, Deno tests, Vitest, Supertest, Playwright, k6, Docker/Nginx/Node 22, Gitea Actions, Coolify, Supabase CLI, psql, rclone, Resend, Turnstile.

---

## Task 1: Create an isolated migration branch at the production SHA

**Files:**

- Worktree: `C:\Users\hokma\OneDrive\Desktop\PROJETOS\MIGRATION-WORKTREES\kaizen-axis`
- Create there: `docs/migration/production-baseline.md`
- Create there: `.dockerignore`
- Replace there: `.env.example`

**Step 1: Verify exact source and clean state**

```powershell
git rev-parse HEAD
git show -s --format=%H migration-prod-axis-20260828
git status --porcelain
```

Expected: both SHAs equal `10c8f8b6f7e61cb008fe1a1eab62148a614d059d`; status empty.

**Step 2: Branch from the tag**

```powershell
git switch -c migration/self-hosted-axis migration-prod-axis-20260828
```

Do not merge `preview/checkin-multiunidade` after this point. Any post-baseline production fix needs an explicit cherry-pick, full test rerun, and updated source/image manifest.

**Step 3: Define complete environment names**

The new `.env.example` documents public frontend variables, runtime API variables, `/api/apuracao` server secrets, and all Function secret names discovered by Plan 01. It contains no URL/token/example that resembles a real secret. Public runtime configuration is limited to Supabase public URL/anon key, Turnstile site key, app origin, migration mode and build SHA.

**Step 4: Commit**

```bash
git add docs/migration .dockerignore .env.example
git commit -m "docs: freeze Axis migration production baseline"
```

## Task 2: Add runtime configuration and migration mode before changing domains

**Files:**

- Create: `src/config/runtime.ts`
- Create: `src/bootstrap.tsx`
- Modify: `src/main.tsx`
- Modify: `src/lib/supabase.ts`
- Modify: `src/services/rateLimiter.ts`
- Modify: `src/services/kaiAgent.ts`
- Modify direct-env callers: `src/pages/ClientDetails.tsx`, `src/pages/Login.tsx`, `src/pages/Developments.tsx`, `src/pages/SendEmail.tsx`
- Create: `src/components/MigrationReadOnly.tsx`
- Create: `api-server/runtime-config.ts`
- Create Vercel compatibility shim: `api/runtime-config.ts`
- Test: `src/config/runtime.test.ts`
- Test: `api-server/runtime-config.test.ts`

**Step 1: Write failing runtime tests**

Cover:

- application bootstrap does not construct a Supabase client before configuration resolves;
- malformed/missing URL, anon key, app origin or Turnstile key fails closed with a recoverable Portuguese error page;
- `/api/runtime-config` returns only `supabaseUrl`, `supabaseAnonKey`, `turnstileSiteKey`, `appOrigin`, `migrationReadOnly`, `buildSha`;
- response is `Cache-Control: no-store, private` and never includes service-role, database, Resend, OpenAI, R2, VAPID private, webhook or SMTP values;
- all existing direct `import.meta.env` application calls are removed except Vite's `PROD` flag and development-only tooling;
- migration read-only mode blocks entry into mutating UI and displays the maintenance window, while preserving logout and status refresh.

**Step 2: Run and confirm failure**

```bash
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom supertest @types/supertest
npm test -- --run
```

**Step 3: Implement asynchronous bootstrap**

`main.tsx` fetches `/api/runtime-config` with `cache: "no-store"`, validates it, stores an immutable typed configuration, then dynamically imports `bootstrap.tsx`. All consumers call `getRuntimeConfig()`. The endpoint reads public values from server runtime variables, allowing one image digest to be promoted unchanged.

`MigrationReadOnly` is a safety UX only. Database privilege revocation and paused integrations are the authoritative freeze.

**Step 4: Preserve Vercel compatibility for the transition**

`api/runtime-config.ts` adapts the same pure `api-server/runtime-config.ts` response builder to Vercel request/response types. A transition preview uses the currently managed Supabase public URL; it must pass the current Axis functional suite before it can temporarily replace the old Vercel deployment at freeze time.

**Step 5: Run and commit**

```bash
npm test -- --run
npm run lint
npm run build
git add package.json package-lock.json src api-server api/runtime-config.ts
git commit -m "axis: load environment from a safe runtime endpoint"
```

## Task 3: Correct PWA caching and domain/CORS behavior

**Files:**

- Modify: `public/sw.js`
- Modify: `public/manifest.json`
- Modify: `supabase/functions/_shared/checkin-cors.ts`
- Modify: `supabase/functions/_shared/checkin-cors.test.ts`
- Modify: `supabase/functions/brasil-aberto/index.ts`
- Modify: `supabase/functions/send-email/index.ts`
- Modify: `supabase/functions/send-password-reset/index.ts`
- Modify: `api/apuracao.ts`
- Create: `tests/pwa/service-worker.test.ts`
- Create: `tests/config/domains.test.ts`

**Step 1: Write failing PWA/domain tests**

Prove:

- service worker bypasses all methods other than GET, same-origin `/api/*`, `api-app.imobkaizen.com.br`, Axis staging API, and legacy managed Supabase hosts;
- it never caches Auth, REST, Realtime, Storage, Functions or runtime-config responses;
- hashed static assets remain cache-first and HTML remains network-first;
- cache version changes, allowing clients to evict the old policy;
- manifest URL handler uses `https://app.imobkaizen.com.br`;
- production CORS accepts `app.imobkaizen.com.br` and temporary `kaizen-axis.space`, accepts the Access-protected staging origin, and rejects arbitrary `*.vercel.app`;
- transactional fallback sender is `no-reply@notify.imobkaizen.com.br`;
- `/api/apuracao` default origin is `https://app.imobkaizen.com.br`.

**Step 2: Run tests and observe failure**

```bash
npm test -- --run tests/pwa/service-worker.test.ts tests/config/domains.test.ts
npx tsx supabase/functions/_shared/checkin-cors.test.ts
```

**Step 3: Implement exact policy**

Keep legacy `supabase.co/io/in` bypass during the seven-day overlap. Add exact self-hosted hosts and `/api/`; do not use broad `imobkaizen.com.br` substring matching. Increment cache version. Remove wildcard Vercel origin acceptance from production Functions; explicitly allow only approved transition preview URLs when the state manifest lists them.

**Step 4: Run build and inspect output**

```bash
npm test -- --run
npm run lint
npm run build
rg -n "pwvpxxrvlywlneuijmmd|kaizenaxis\.com\.br|noreply@kaizen-axis\.space" dist
```

Expected: no matches in the production self-hosted build except intentionally documented legacy transition text, never a runtime API target.

**Step 5: Commit**

```bash
git add public supabase/functions api/apuracao.ts tests
git commit -m "axis: make PWA and CORS safe for self-hosted domains"
```

## Task 4: Turn `/api/apuracao` into a production Node service without rewriting its engine

**Files:**

- Create: `api-server/index.ts`
- Create: `api-server/app.ts`
- Create: `api-server/health.ts`
- Create: `api-server/env.ts`
- Create: `tsconfig.api.json`
- Modify: `package.json`
- Test existing: `api/apuracao-c6.test.ts`
- Test existing: `api/apuracao-mercadopago.test.ts`
- Test existing: `api/apuracao-rate-limit.test.ts`
- Create: `api-server/app.test.ts`
- Create: `api-server/parity.test.ts`

**Step 1: Capture Vercel parity before adapter work**

Run the three current apuração suites at the baseline and store their passing output hashes. Add fixture requests/responses for authorization, CORS/OPTIONS, invalid method, malformed/oversized payload, rate limits, managed Auth failure, valid known bank samples, and internal error redaction.

```bash
npx tsx api/apuracao-c6.test.ts
npx tsx api/apuracao-mercadopago.test.ts
npx tsx api/apuracao-rate-limit.test.ts
```

**Step 2: Write failing Express adapter tests**

The server must:

- expose `/healthz` without secrets/user data;
- expose `GET /api/runtime-config` and `POST/OPTIONS /api/apuracao` only;
- return `404` elsewhere;
- apply JSON body limit slightly above the handler's 2,000,000-character application limit and reject before excessive allocation;
- preserve Express `status/json/end` compatibility with the existing Vercel handler;
- authenticate using `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and server-only service role only where the existing rate limiter requires it;
- set request timeout just above the former 300-second Vercel maximum and cancel work on client disconnect;
- trust proxy only for the single local Nginx hop and derive rate-limit IP safely;
- shut down gracefully.

**Step 3: Implement a thin adapter**

Do not replace the 3,000-line deterministic engine with the older separate `server/` implementation. Import the current `api/apuracao.ts` default handler and adapt request/response types. Use `tsup` to produce a Node 22 ESM bundle in `dist-api`; do not publish `api/*.test.ts` as routes.

Add scripts:

```json
{
  "test": "vitest",
  "build:api": "tsup api-server/index.ts --format esm --platform node --target node22 --out-dir dist-api",
  "start:api": "node dist-api/index.js"
}
```

**Step 4: Run parity and resource tests**

```bash
npm test -- --run
npm run build:api
npx tsx api/apuracao-c6.test.ts
npx tsx api/apuracao-mercadopago.test.ts
npx tsx api/apuracao-rate-limit.test.ts
```

Run representative k6 requests with a 2 GiB memory and measured CPU limit. Confirm no event-loop starvation or memory growth invalidates the former behavior.

**Step 5: Commit**

```bash
git add api-server api package.json package-lock.json tsconfig.api.json
git commit -m "axis: run production apuracao engine as a Node service"
```

## Task 5: Containerize frontend and API behind one origin

**Files:**

- Create: `Dockerfile.frontend`
- Create: `Dockerfile.api`
- Create: `docker/nginx.conf`
- Create: `docker/frontend-entrypoint.sh`
- Create: `compose.axis.yml`
- Create: `tests/container/axis.bats`
- Create: `.gitea/workflows/build-axis.yml`

**Step 1: Write failing image/topology tests**

Assert:

- both images run as non-root and contain no `.env.local`, Git data, source database URL, service-role/Resend/OpenAI secrets or test routes;
- Nginx SPA fallback works but `/api/*` never falls back to `index.html`;
- runtime config and authenticated/API responses are no-store;
- hashed assets receive immutable cache headers;
- service worker and manifest receive update-safe headers;
- API is reachable only from internal network/Nginx and health checks;
- forwarded IP/header handling is deterministic;
- deployed frontend/API image labels share the same source SHA and CI run.

**Step 2: Implement frontend image**

Build `dist` with no environment-specific Supabase values. Serve using a pinned unprivileged Nginx image. Nginx proxies `/api/` to `axis-api:3001`, serves `/healthz`, applies compression/security headers, supports PWA files, and uses `try_files $uri /index.html` only for non-API navigation.

**Step 3: Implement API image**

Use Node 22 Bookworm Slim pinned by digest. Install production dependencies only after building, run the API as an unprivileged user with a writable `/tmp`, healthcheck `/healthz`, 2 GiB memory limit initially, controlled CPU, and graceful stop period greater than the longest accepted request.

**Step 4: Add CI**

Run unit/current TS tests, Deno shared/Function auth tests, lint/build, container integration, SBOM, Trivy, and secret scanning. Publish `axis-frontend:<SHA>` and `axis-api:<SHA>` and record immutable digests. Manual production promotion accepts this pair only; mismatched SHAs/digests are rejected.

**Step 5: Test and commit**

```bash
docker compose -f compose.axis.yml build
docker compose -f compose.axis.yml up -d
bats tests/container/axis.bats
docker compose -f compose.axis.yml down
git add Dockerfile.frontend Dockerfile.api docker compose.axis.yml tests/container .gitea/workflows
git commit -m "axis: package PWA and API as immutable services"
```

## Task 6: Audit and deploy all 17 self-hosted Edge Functions

**Files:**

- Create: `supabase/functions/manifest.json`
- Create: `supabase/functions/auth-matrix.json`
- Create: `scripts/test-functions.ts`
- Create tests beside each Function or under: `supabase/functions/_tests/`
- Modify Functions only where tests show self-hosted incompatibility
- Create in platform repo: `scripts/functions/deploy-axis.sh`
- Test in platform repo: `tests/functions/axis.bats`

**Step 1: Manifest every Function**

For each of the 17 exact names, record source hash, intended caller, methods, public/authenticated/HMAC classification, JWT behavior, CORS origins, required secret names, database roles used, timeout/memory needs, outbound domains, and idempotency expectation. `receive-lead` is HMAC-public; `secure-login` and `send-password-reset` are Turnstile/rate-limited public flows; every other Function must prove explicit user/service authorization.

**Step 2: Write security-first tests**

For every Function test OPTIONS, unsupported method, missing/invalid auth, valid lowest role, forbidden role/scope, invalid body, rate limit, error redaction and valid flow. Specific coverage includes document/chat signed URLs and view-once behavior, check-in/QR/unit/schedule rules, email/notification/push, KAI access, Brasil Aberto proxy, export, audit logs and lead webhook replay/HMAC.

**Step 3: Run under the pinned self-hosted Edge Runtime**

Mount the exact Functions into Axis staging, inject secrets through the root-owned stack env, restart only the functions service, and run public calls through the public API gateway. Compare with managed staging/control responses while ignoring timestamps/request IDs.

**Step 4: Confirm secrets and email**

Set self-hosted `SUPABASE_URL` to the internal gateway for server-side Function calls where appropriate, set public app origin to `https://app.imobkaizen.com.br`, use the new Resend key/sender, and rotate webhook secrets. Never reuse the managed service-role key or JWT secret.

**Step 5: Commit**

```bash
git add supabase/functions scripts/test-functions.ts
git commit -m "axis: verify all edge functions on self-hosted runtime"
```

Platform repo:

```bash
git add scripts/functions tests/functions
git commit -m "infra: deploy Axis function manifest by hash"
```

## Task 7: Reconcile database migrations and build migration/freeze tooling

**Files in Axis repo:**

- Create: `supabase/config.toml`
- Generate/review: `supabase/schema.production.sql`
- Generate only if drift exists: `supabase/migrations/20260829000000_selfhost_reconciliation.sql`
- Create: `tests/database/axis-schema.sql`
- Create: `tests/database/axis-rls.sql`

**Files in platform repo:**

- Create: `scripts/migration/axis/export.sh`
- Create: `scripts/migration/axis/restore.sh`
- Create: `scripts/migration/axis/freeze.sh`
- Create: `scripts/migration/axis/unfreeze.sh`
- Create: `scripts/migration/axis/pause-integrations.sh`
- Create: `scripts/migration/axis/resume-integrations.sh`
- Create: `scripts/migration/axis/copy-storage.sh`
- Create: `scripts/migration/axis/reconcile.sh`
- Test: `tests/migration/axis-*.bats`

**Step 1: Prove live schema versus repository**

Generate a managed source schema dump and compare tables/policies/functions/triggers/publications/extensions to the ordered repository migrations. Do not replay the entire historical migration directory blindly into a database restored from the managed source. If live drift exists, create only the reviewed reconciliation migration and retest from a clean database.

After restore, mark verified historical versions as applied in the target migration ledger without executing them. The script must compare each migration file hash to the approved manifest first.

**Step 2: Export using the official split**

```bash
supabase db dump --db-url "$AXIS_SOURCE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$AXIS_SOURCE_DB_URL" -f schema.sql
supabase db dump --db-url "$AXIS_SOURCE_DB_URL" -f data.sql --use-copy --data-only
```

Restore only into a verified Axis target, use trigger suppression only during controlled data load, then restore normal session replication immediately.

**Step 3: Implement authoritative freeze**

Capture exact grants, revoke DML from browser roles across user/application schemas and relevant Storage objects, preserve reads, and verify writes fail through PostgREST/RPC/Storage. Pause N8N inbound/outbound jobs, scheduled jobs, database webhooks, lead ingestion and any service-role writers in a recorded order. Turn on app migration mode before revocation. Unfreeze/resume scripts restore only captured state and are tested on staging.

**Step 4: Copy every inventoried bucket**

Use per-project S3 access keys and an idempotent rclone copy. Inventory determines the exact bucket set; the script refuses an unexpected/missing bucket. Compare key set, size, checksum/content type, public/private flag and `storage.objects` rows. Signed URLs themselves are not migrated; they must be regenerated.

**Step 5: Reconcile deeply**

Compare exact counts/hashes for critical application tables; Auth state aggregates and controlled logins; all policies/functions/triggers/extensions/grants; Realtime publication tables/replica identity; all buckets/objects; scheduled jobs/webhooks; five role scopes; no orphaned foreign keys; sequence maxima; and timezone/settings.

**Step 6: Test and commit**

Axis repo:

```bash
git add supabase/config.toml supabase/schema.production.sql supabase/migrations tests/database
git commit -m "axis: reconcile managed production database schema"
```

Platform repo:

```bash
git add scripts/migration/axis tests/migration
git commit -m "infra: automate reversible Axis migration freeze"
```

## Task 8: Create Axis functional, role/RLS, PWA, and integration acceptance suites

**Files:**

- Create: `playwright.config.ts`
- Create: `tests/e2e/auth-roles.spec.ts`
- Create: `tests/e2e/crm.spec.ts`
- Create: `tests/e2e/chat-realtime.spec.ts`
- Create: `tests/e2e/documents-storage.spec.ts`
- Create: `tests/e2e/checkin.spec.ts`
- Create: `tests/e2e/notifications-email.spec.ts`
- Create: `tests/e2e/apuracao.spec.ts`
- Create: `tests/e2e/pwa-upgrade.spec.ts`
- Create: `tests/security/rls.spec.ts`
- Create in platform repo: `scripts/health/axis.sh`

**Step 1: Seed dedicated staging identities**

Create one test user for each of the five production role categories identified by inventory, plus users in different teams/directorates. Never use production users. Seed records with a unique test-run ID and clean up only those exact IDs after verifying ownership.

**Step 2: Cover the approved matrix**

Test login/logout/reset/Turnstile; five roles and cross-team/directorate RLS; clients, appointments, tasks, commissions, reports; documents/private signed URLs; chat/groups/media/view-once/Realtime; push/subscriptions; check-in/geolocation/multiple units/schedules/daily QR; all 17 Functions; leads/N8N; Resend; `/api/apuracao` PDFs/rate limit; PWA install/offline shell/update from old cache and new domain.

**Step 3: Test hostile paths**

Anonymous/low-role direct REST/RPC/Storage/Function calls, IDOR attempts, forged JWT/API key, CORS abuse, oversized files/bodies, WebSocket authentication, cached authenticated responses, service-worker API interception, and service-role leakage must fail safely.

**Step 4: Run**

```bash
npx playwright test
npm test -- --run
../IMOBKAIZEN-PLATFORM/scripts/health/axis.sh staging
```

**Step 5: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests
git commit -m "test: cover Axis self-hosted critical paths"
```

## Task 9: Build immutable images and deploy Axis staging

**Files in platform repository:**

- Create: `deployments/axis-staging.yml`
- Generate: `state/images/axis.json`
- Generate: `evidence/axis/staging-deployment.md`

**Step 1: Protect the Gitea mirror and secrets**

Enable Actions on the private mirror, protect the migration branch, require CI, and isolate untrusted PR jobs from registry/Coolify/production secrets. The runner must use container isolation and never mount the production secret directory.

**Step 2: Publish the paired images**

Record frontend/API digest, shared source SHA, lockfile hash, SBOM and scan result in `state/images/axis.json`. Reject a pair from different commits or CI runs.

**Step 3: Deploy by digest**

Coolify runs frontend and API on a private network, binds the frontend ingress to loopback/Tunnel, sets API limits/timeouts, and provides runtime variables only to the API. Route `stg-app.imobkaizen.com.br` through Tunnel + Access. Route Axis staging Supabase API separately and bypass cache.

**Step 4: Validate**

Run the full acceptance suite through Cloudflare and directly on the internal staging ingress. Validate Realtime WebSockets, uploads, long apuração requests, runtime config, PWA cache upgrade, WAF/rate limits and no public API container port.

**Step 5: Commit**

```bash
git add deployments state/images evidence/axis
git commit -m "infra: deploy immutable Axis image pair to staging"
```

## Task 10: Rehearse the full Axis migration and close the gate

**Files in platform repository:**

- Create: `docs/runbooks/axis-rehearsal.md`
- Create: `scripts/migration/axis/rehearse.sh`
- Generate: `evidence/axis/rehearsal/`
- Create: `evidence/gates/axis-rehearsal-passed.md`
- Modify: `state/program.json`

**Step 1: Perform a fresh online copy**

Export/restore managed data and copy all Storage buckets into reset Axis staging while source remains live. Recreate Auth URLs/templates/SMTP, Realtime, Functions/secrets, jobs/webhooks and integrations in disabled/test mode. Reconcile and run all suites.

**Step 2: Simulate the 15–30 minute final freeze**

Enable migration mode, pause integrations, revoke source writes, prove direct/API writes fail, execute final roles/schema/data dump and Storage delta, reset/restore/reconcile target, run priority smoke tests, then full gate tests. Restore source grants/integrations only after the rehearsal rollback check.

The measured freeze-to-priority-validation duration must be no more than 30 minutes. Otherwise production cutover is blocked until a larger owner-approved maintenance window or logical-replication design is produced.

**Step 3: Prove pre-write rollback**

Route the rehearsal hostname back to the transition Vercel deployment/current managed project, turn off migration mode, restore source grants/integrations, and verify login plus one controlled write. Confirm no staging writer touched managed production during target testing.

**Step 4: Advance**

```bash
./scripts/state/advance.sh AXIS_REHEARSAL_PASSED evidence/gates/axis-rehearsal-passed.md
git add docs/runbooks scripts/migration/axis evidence/axis evidence/gates state/program.json
git commit -m "docs: approve complete Axis migration rehearsal"
```

Production routing is handled only by `2026-08-28-imobkaizen-06-cutover-rollback.md`.

## External references

- [Supabase self-hosted Functions](https://supabase.com/docs/guides/self-hosting/self-hosted-functions)
- [Supabase managed-to-self-hosted restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
- [Supabase S3 storage](https://supabase.com/docs/guides/self-hosting/self-hosted-s3)
