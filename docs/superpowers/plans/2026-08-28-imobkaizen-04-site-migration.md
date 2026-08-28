# ImobKaizen Institutional Site Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Build, test, and rehearse migration of the institutional Next.js site from the exact Vercel production SHA and managed Supabase project to the site stack on the VPS, while public browsing remains available and only administrative writes pause during final synchronization.

**Architecture:** Work only in the detached baseline worktree and a migration branch rooted at `2691097301d7efc1d8d1057c3981594bd72bb3b3`. Build a Next.js standalone container and route it through an internal reverse proxy/Tunnel. The browser and SSR use `api-site.imobkaizen.com.br`; no service-role key enters the client image. Database export uses the official Supabase roles/schema/data split, and Storage moves idempotently through S3-compatible endpoints. A database-level write freeze protects the final delta.

**Tech Stack:** Next.js 16.2.7, React 19.2.4, Node.js 22 LTS, Supabase JS/SSR, Vitest, Playwright, Docker multi-stage standalone output, Gitea Actions, Trivy, Syft, Coolify, Supabase CLI, psql, rclone.

---

## Task 1: Create the migration branch without touching the current site worktree

**Files:**

- Worktree: `C:\Users\hokma\OneDrive\Desktop\PROJETOS\MIGRATION-WORKTREES\kaizen-website`
- Create there: `docs/migration/production-baseline.md`
- Create there: `.dockerignore`
- Create there: `.env.example`

**Step 1: Re-prove the baseline**

```powershell
git rev-parse HEAD
git status --porcelain
git show -s --format=%H migration-prod-site-20260828
```

Expected: all commit outputs equal `2691097301d7efc1d8d1057c3981594bd72bb3b3`; status is empty.

**Step 2: Create a branch rooted at the immutable tag**

```powershell
git switch -c migration/self-hosted-site migration-prod-site-20260828
```

Do not merge the moving `preview-landing-dark` branch during migration. Desired later application changes require their own tested cherry-pick and a new approved source manifest.

**Step 3: Read the installed Next.js documentation before editing**

The repository `AGENTS.md` requires reading relevant files under `node_modules/next/dist/docs/`. If that directory is absent in the installed package, record that fact and use the official Next.js 16.2.7 documentation for self-hosting, standalone output, environment variables, Route Handlers, middleware/proxy, caching, and image configuration. Do not rely on older Next.js conventions.

**Step 4: Define environment names only**

`.env.example` contains no values and documents:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_WHATSAPP_NUMBER
NEXT_PUBLIC_GA_ID
NEXT_PUBLIC_MIGRATION_READ_ONLY
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only and is omitted entirely unless a reviewed server route actually needs it; current code inspection must prove whether it is referenced.

**Step 5: Commit**

```bash
git add docs/migration .dockerignore .env.example
git commit -m "docs: freeze institutional site migration baseline"
```

## Task 2: Add environment validation, health, and write-freeze UX with tests

**Files:**

- Create: `src/lib/env.ts`
- Create: `src/app/api/health/route.ts`
- Create: `src/components/admin/MigrationReadOnlyBanner.tsx`
- Modify: `src/components/admin/AdminPropertyForm.tsx`
- Modify: `src/app/admin/page.tsx`
- Modify: `src/app/admin/perfil/page.tsx`
- Modify: `package.json`
- Create: `vitest.config.ts`
- Test: `src/lib/env.test.ts`
- Test: `src/app/api/health/route.test.ts`
- Test: `src/components/admin/MigrationReadOnlyBanner.test.tsx`

**Step 1: Write failing tests**

Cover:

- production refuses a missing/malformed site URL, Supabase URL, or anon key;
- public environment export never contains service-role key;
- `/api/health` returns `200` with only `status`, `service`, `commit`, and UTC timestamp when the app can reach the target Auth health endpoint;
- health returns `503` without leaking upstream body/credentials when dependency check fails;
- read-only mode disables create/edit/delete/profile-save/upload controls and shows a Portuguese maintenance message;
- normal mode preserves current behavior.

**Step 2: Run and confirm failure**

```bash
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom
npm test -- --run
```

**Step 3: Implement the minimum changes**

Centralize server/client-safe environment access in `src/lib/env.ts`. Use build-time `NEXT_PUBLIC_MIGRATION_READ_ONLY` only as user experience; database revocation remains the authoritative freeze. Health checks use a short timeout and never query user rows.

**Step 4: Run tests, lint, and build**

```bash
npm test -- --run
npm run lint
npm run build
```

Expected: PASS.

**Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src
git commit -m "site: add migration readiness and health controls"
```

## Task 3: Produce a standalone production container

**Files:**

- Modify: `next.config.ts`
- Create: `Dockerfile`
- Create: `docker/entrypoint.sh`
- Create: `tests/container/site.bats`
- Create: `.gitea/workflows/build-site.yml`

**Step 1: Write failing container tests**

Tests must prove:

- container runs as a non-root UID;
- root filesystem is compatible with read-only deployment and only `/tmp`/Next cache is writable;
- `/api/health` works;
- SSR `/`, `/imoveis`, a detail route, `/login`, and middleware redirects behave correctly;
- `.next/standalone` contains no `.env.local`, Git metadata, tests, source maps intended to be private, service-role key, Vercel token, or managed Supabase ref;
- image accepts shutdown and becomes ready before traffic;
- remote image configuration accepts `api-site.imobkaizen.com.br` without retaining an unnecessary wildcard dependency on `*.supabase.co` in the production build.

**Step 2: Enable standalone output**

Add `output: "standalone"` to `next.config.ts`, preserve Turbopack root and existing dynamic Supabase image hostname logic, and set `outputFileTracingRoot` only if the official 16.2.7 docs require it for this repository layout.

**Step 3: Implement multi-stage image**

Use Node 22 Bookworm Slim; resolve and lock the exact base-image digest in CI. Stages are dependencies, build, and runtime. Runtime copies only `.next/standalone`, `.next/static`, and `public`, runs as a dedicated unprivileged user, sets `NODE_ENV=production`, exposes internal port `3000`, and has a healthcheck against `/api/health`.

Public Supabase URL/anon key are build inputs because Next may inline them. They are environment-specific and safe-to-publish by design, but their names/values still must not be logged. Service-role, source DB URL, R2, Resend, and MinIO credentials are never build arguments. Development may use a staging-specific image, but the final release candidate is built once with final production public values, tested through an Access-protected candidate hostname against the isolated production target, and promoted without rebuilding.

**Step 4: Build and test locally against site staging**

```bash
docker build --tag kaizen-website:migration-test \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://stg-api-site.imobkaizen.com.br \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$SITE_STAGING_ANON_KEY" \
  --build-arg NEXT_PUBLIC_SITE_URL=https://stg-site.imobkaizen.com.br .
bats tests/container/site.bats
```

**Step 5: Add Gitea build workflow**

On pull request/push, run `npm ci`, unit tests, lint, build, container tests, Syft SBOM, Trivy scan, and secret scan. Publish only SHA tags. A manual promotion job accepts an already-built digest and writes deployment evidence; it does not rebuild.

**Step 6: Commit**

```bash
git add next.config.ts Dockerfile docker tests/container .gitea/workflows
git commit -m "site: package Next application as standalone image"
```

## Task 4: Establish the managed schema as versioned site migrations

**Files:**

- Create: `supabase/config.toml`
- Generate and review: `supabase/migrations/20260828000000_production_baseline.sql`
- Create: `tests/database/site-schema.sql`
- Create in platform repo: `scripts/migration/site/export.sh`
- Create in platform repo: `scripts/migration/site/restore.sh`
- Test in platform repo: `tests/migration/site-db.bats`

**Step 1: Export a schema-only baseline from the managed source**

Use the correct source ref/database URL from the access plan:

```bash
supabase db dump --db-url "$SITE_SOURCE_DB_URL" \
  -f supabase/migrations/20260828000000_production_baseline.sql
```

Review for security-definer functions, RLS, grants, ownership, extension availability, and any secrets/data accidentally embedded in defaults. The file must contain no rows or user values.

**Step 2: Prove a clean schema build**

Apply the baseline to a disposable empty site-staging-compatible database. `tests/database/site-schema.sql` asserts the `properties` table shape, RLS policies, Auth/admin relationship, `property-images` bucket metadata/policies, triggers/functions/indexes, grants, and expected extensions from live inventory.

**Step 3: Implement official export/restore split**

`export.sh` creates and hashes:

```bash
supabase db dump --db-url "$SITE_SOURCE_DB_URL" -f roles.sql --role-only
supabase db dump --db-url "$SITE_SOURCE_DB_URL" -f schema.sql
supabase db dump --db-url "$SITE_SOURCE_DB_URL" -f data.sql --use-copy --data-only
```

`restore.sh` refuses a non-empty/wrong target, restores roles then schema, uses `session_replication_role=replica` only for the documented data-import window, restores data, resets it, and runs validation. It records PostgreSQL/CLI versions and hashes. It never uses raw `pg_dump` for the platform export.

**Step 4: Test and commit separately in each repository**

Site repository:

```bash
git add supabase tests/database
git commit -m "site: version managed production database schema"
```

Platform repository:

```bash
git add scripts/migration/site tests/migration
git commit -m "infra: automate site database export and restore"
```

## Task 5: Implement source write freeze and Storage transfer controls

**Files in platform repository:**

- Create: `sql/freeze/capture-grants.sql`
- Create: `sql/freeze/site-lock.sql`
- Create: `scripts/migration/site/freeze.sh`
- Create: `scripts/migration/site/unfreeze.sh`
- Create: `scripts/migration/site/copy-storage.sh`
- Create: `scripts/migration/site/reconcile.sh`
- Test: `tests/migration/site-freeze.bats`
- Test: `tests/migration/site-storage.bats`

**Step 1: Test freeze on a fixture first**

The freeze procedure must capture exact current grants, revoke `INSERT/UPDATE/DELETE/TRUNCATE` for browser roles on `public.properties` and write privileges on relevant `storage.objects`, leave public/authorized reads available, and prove writes fail through the same anon/authenticated API path the site uses. Unfreeze must restore only captured grants and be repeatable.

Adding a deny RLS policy is not sufficient because PostgreSQL permissive policies combine with OR; privileges are the authoritative lock.

**Step 2: Build an idempotent Storage transfer**

Use managed and self-hosted Supabase S3 endpoints with independently generated access keys. Scope source read-only and target to the site bucket. Copy only `property-images`, resume safely, retain original metadata/content type, and produce object key/size/checksum manifests. No object content or signed URL enters logs.

**Step 3: Reconcile**

Compare source/target:

- exact `properties` row count and stable per-row hash over non-secret columns;
- `auth.users` counts/state aggregates and one controlled login;
- `property-images` object count, total bytes, key set, checksums where supported;
- policies, functions, triggers, extensions, grants, bucket configuration;
- broken image URL scan through the target application.

Any mismatch is blocking.

**Step 4: Commit**

```bash
git add sql/freeze scripts/migration/site tests/migration
git commit -m "infra: add reversible site write freeze and storage copy"
```

## Task 6: Add functional and security acceptance tests

**Files:**

- Create in site repo: `playwright.config.ts`
- Create in site repo: `tests/e2e/public-site.spec.ts`
- Create in site repo: `tests/e2e/admin.spec.ts`
- Create in site repo: `tests/e2e/security.spec.ts`
- Create in platform repo: `scripts/health/site.sh`

**Step 1: Write tests against staging**

Cover list/search/filter/details/featured properties, SSR metadata, responsive images, login/invalid login/session refresh/logout, middleware redirects, create/edit/delete/publish property, multi-image upload/delete, profile update, Turnstile behavior, read-only banner, 401/403/RLS cross-user attempts, cache headers on authenticated pages, and no service-role/managed-ref exposure in HTML/JS.

Use dedicated staging test users and disposable properties under an exact test prefix. Cleanup deletes only IDs created by the test and verifies ownership before deletion.

**Step 2: Run**

```bash
npx playwright test
../IMOBKAIZEN-PLATFORM/scripts/health/site.sh staging
```

Expected: PASS in Chromium, WebKit mobile viewport, and Firefox for critical paths.

**Step 3: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e
git commit -m "test: cover site migration critical paths"
```

## Task 7: Build and deploy the staging artifact through Gitea/Coolify

**Files in platform repository:**

- Create: `deployments/site-staging.yml`
- Create: `scripts/deploy/promote-image.sh`
- Create: `scripts/deploy/verify-digest.sh`
- Generate: `state/images/site.json`
- Generate: `evidence/site/staging-deployment.md`

**Step 1: Mirror and protect repository**

Mirror the exact site repository to private Gitea, enable Actions, protect `migration/self-hosted-site`, and require CI. The runner must not share production secrets with pull-request jobs. Registry push and Coolify promotion are restricted to protected/manual jobs.

**Step 2: Publish the immutable production release candidate**

Build once with `NEXT_PUBLIC_SUPABASE_URL=https://api-site.imobkaizen.com.br` and `NEXT_PUBLIC_SITE_URL=https://imobkaizen.com.br`. The image label includes source commit, baseline commit, public-config fingerprint, lockfile hash, CI run and build timestamp. Store SHA tag, digest, SBOM hash and scan result in `state/images/site.json`. A rebuild, even from the same source, produces a new candidate and must repeat the candidate tests.

**Step 3: Deploy staging by digest**

Coolify uses the digest, not a mutable tag, with application internal port `3000`, healthcheck `/api/health`, resource limits, read-only root FS where compatible, and restart policy. Route `candidate-site.imobkaizen.com.br` through Tunnel + Access to this exact image while `api-site.imobkaizen.com.br` routes to the isolated production site stack. The final apex promotion later changes routing only; it does not rebuild the image.

**Step 4: Verify**

Run unit/container/E2E/health/security tests against the protected candidate route and the internal origin. Confirm canonical URLs remain production URLs, Cloudflare bypasses authenticated/dynamic content, and only immutable assets are cached.

**Step 5: Commit**

```bash
git add deployments scripts/deploy state/images evidence/site
git commit -m "infra: deploy immutable site image to staging"
```

## Task 8: Rehearse the complete site migration and close the gate

**Files in platform repository:**

- Create: `docs/runbooks/site-rehearsal.md`
- Create: `scripts/migration/site/rehearse.sh`
- Generate: `evidence/site/rehearsal/`
- Create: `evidence/gates/site-rehearsal-passed.md`
- Modify: `state/program.json`

**Step 1: Take a fresh source export and Storage copy while source remains writable**

Restore into a newly reset staging database/bucket. Recreate Auth configuration, redirect URLs, SMTP/Resend, bucket settings and secrets that are not in the dump. Run reconciliation and functional tests.

**Step 2: Rehearse the final freeze**

Announce a simulated admin maintenance window, enable target read-only UX, run `freeze.sh`, prove source writes are blocked, take final roles/schema/data export and Storage delta, restore/reset target, reconcile, run acceptance, then unfreeze the managed source. Measure each phase.

Public pages must stay available throughout. The complete freeze-to-validation interval must be at most 30 minutes. Otherwise the production cutover is blocked pending a larger approved window or a continuous-replication redesign.

**Step 3: Prove rollback**

Before target writes open, route staging back to the control artifact and confirm managed source works after unfreeze. Verify no source data was mutated by the rehearsal beyond explicitly created test rows.

**Step 4: Advance**

```bash
./scripts/state/advance.sh SITE_REHEARSAL_PASSED evidence/gates/site-rehearsal-passed.md
git add docs/runbooks scripts/migration/site evidence/site evidence/gates state/program.json
git commit -m "docs: approve institutional site migration rehearsal"
```

Production routing is not changed in this plan. Execute the site section of `2026-08-28-imobkaizen-06-cutover-rollback.md` next.

## External references

- [Supabase managed-to-self-hosted restore](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
- [Supabase S3 protocol/backend](https://supabase.com/docs/guides/self-hosting/self-hosted-s3)
