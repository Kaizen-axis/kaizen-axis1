# ImobKaizen Production Cutover, Rollback, and Decommission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Promote the rehearsed institutional site and then Kaizen Axis to the VPS with bounded write pauses, measurable go/no-go gates, reversible routing before new writes, seven days of protected observation, and explicit approval before any legacy service is cancelled.

**Architecture:** Cutovers are route promotions, not rebuilds. The exact staging-tested image digests and preconfigured production Supabase stacks are used. Each product follows: announce → backup → freeze writes/integrations → final delta → reconcile → switch Cloudflare route → priority validation → open target writes → observe. Rollback is trivial only before target writes; afterward, target deltas must be exported/reconciled. Site migration is completed and observed for 24 hours before Axis begins.

**Tech Stack:** Cloudflare DNS/Tunnel API, Vercel rollback, Supabase CLI/psql/rclone, Coolify by image digest, Gitea artifact manifests, Uptime Kuma/external monitoring, Playwright, k6, pgBackRest/R2, Mailcow, Resend.

---

## Global go/no-go rules

Every production mutation requires two operators/checks: one executes, one reads back the target/state/evidence. If only one human is available, an independent script must read back and verify the mutation before the next step.

Immediate NO-GO or pre-write rollback conditions:

- any source/target row, Auth, schema, policy, grant, publication, bucket, object, or checksum mismatch;
- an image digest/source SHA not equal to the approved manifest;
- freeze not proven through direct browser/API paths;
- backup/WAL/object-copy health not green or restore proof older than 30 days;
- unavailable Cloudflare route rollback, Vercel control deployment, or managed database access;
- critical login/RLS/CRUD/upload/Realtime/Function/email/apuração test failure;
- secret/service-role exposure or unexpected public port;
- freeze timer exceeds the rehearsed/approved window;
- unresolved severity-1/2 incident on the site before Axis begins.

After target writes open, prefer forward repair unless data integrity/security is at risk. Never point users back to the old managed project while unexported target writes exist.

## Task 1: Prepare signed cutover manifests and communication

**Files in platform repository:**

- Create: `cutover/manifest.schema.json`
- Create: `cutover/site-manifest.json`
- Create: `scripts/cutover/validate-manifest.sh`
- Create: `scripts/cutover/check-go.sh`
- Test: `tests/cutover/manifests.bats`
- Create: `docs/runbooks/communications.md`

**Step 1: Write failing manifest tests**

Reject mutable tags, missing digests, mismatched source SHAs, stale rehearsals, missing backup evidence, missing route rollback values, unapproved maintenance windows, or a state not at the required rehearsal gate.

**Step 2: Populate the exact site manifest from machine state**

Site manifest includes:

- source SHA `2691097301d7efc1d8d1057c3981594bd72bb3b3`;
- Vercel control deployment `dpl_J5VzdWUmiA4EWmyDuLzpFyjsmEK9` and exact current DNS record snapshot;
- tested site image digest;
- target stack/config/image digests;
- source and target database identifiers/fingerprints, never passwords;
- source/target Storage endpoint/bucket names;
- rehearsal report hash/timing;
- Cloudflare record/route IDs and rollback JSON;
- owner-approved UTC/Brazil maintenance window.

**Step 3: Prepare communications**

- Site: public browsing remains online; administrators receive the exact write-maintenance start/end and support contact.
- Axis: all active users receive at least 24-hour notice of a 15–30 minute read-only window, new URL, forced re-login, PWA reinstall/update instructions and support contact.
- Internal: assign cutover operator, validator, application tester, database owner and rollback decision owner.

**Step 4: Commit**

```bash
./scripts/cutover/validate-manifest.sh site
git add cutover scripts/cutover tests/cutover docs/runbooks/communications.md
git commit -m "docs: sign institutional site cutover manifest"
```

## Task 2: Execute the institutional site cutover

**Files:**

- Create: `scripts/cutover/site.sh`
- Create: `docs/runbooks/site-cutover.md`
- Generate: `evidence/cutover/site/`
- Modify: `state/program.json`

**Step 1: T-minus 24 hours**

Confirm state `SITE_REHEARSAL_PASSED`; verify Cloudflare/email/platform alerts; verify exact Coolify site digest; run a fresh target backup; confirm source DB/Storage credentials; confirm Vercel deployment/route rollback; test site production origin privately with Host/header/Tunnel staging route; ensure disk/RAM/WAL headroom; notify administrators.

**Step 2: T-minus 15 minutes**

Start the cutover timer and external watch. Capture source counts/size/WAL timestamp and final Vercel response headers/screenshots. Enable the site read-only UX on target. Do not change public DNS yet.

**Step 3: Freeze only administrative writes**

Run the tested site `freeze.sh` on the managed source. Prove insert/update/delete/upload fails with an authenticated test administrator through public APIs while public property pages/reads remain available from Vercel. If any write succeeds, abort and unfreeze.

**Step 4: Final export, restore and Storage delta**

Run exact rehearsed scripts. Save roles/schema/data hashes, object delta manifest, start/end times and tool versions. Reset only the verified site production target, restore, recreate non-dump configuration, copy Storage delta, mark migrations, and run full reconciliation.

**Step 5: Priority validation before routing**

Through the private production origin validate `/`, properties list/filter/detail, images, login/session, RLS, one controlled CRUD/upload/delete transaction while target is still isolated, then remove that test transaction and reconcile again. Validate Resend/Auth sender and no secret exposure.

**Step 6: Switch Cloudflare apex to Tunnel**

Apply the pre-recorded route for `imobkaizen.com.br` to the site production loopback service. Configure `www.imobkaizen.com.br` as a canonical redirect preserving path/query. Read back Cloudflare DNS/Tunnel state, then test from multiple external resolvers/networks. The old Vercel deployment remains intact.

**Step 7: Open target writes only after public validation**

Run priority public tests again, switch runtime read-only off, prove target admin CRUD/upload, and leave the managed source frozen. Record the exact first-target-write UTC. From this moment, simple DNS rollback is forbidden.

**Step 8: Watch intensively**

For the first hour watch continuously; for 24 hours watch error rate, latency, Auth, Storage, DB, WAL, backup, Tunnel, resources and real admin flow. Rollback/incident thresholds are:

- any confirmed data corruption, cross-user access, secret exposure or auth-wide failure: stop target writes immediately;
- critical-flow failure not fixed safely within 10 minutes: enter incident procedure;
- HTTP 5xx above 2% for 5 consecutive minutes or more than double rehearsed baseline for 10 minutes: investigate/rollback decision;
- resource saturation above 90% or disk below 15% free with continuing trend: stop risky writes and remediate.

**Step 9: Advance after 24 stable hours**

```bash
./scripts/state/advance.sh SITE_LIVE_OBSERVATION evidence/gates/site-live-observation.md
git add scripts/cutover docs/runbooks evidence/cutover/site evidence/gates state/program.json
git commit -m "docs: complete institutional site cutover"
```

Axis production work cannot begin before this gate.

## Task 3: Execute the Kaizen Axis cutover

**Files:**

- Create: `cutover/axis-manifest.json`
- Create: `scripts/cutover/axis.sh`
- Create: `docs/runbooks/axis-cutover.md`
- Generate: `evidence/cutover/axis/`
- Modify: `state/program.json`

**Step 1: Sign the Axis manifest, then begin T-minus 24 hours**

Generate `cutover/axis-manifest.json` from the now-passed Axis rehearsal. It includes SHA `10c8f8b6f7e61cb008fe1a1eab62148a614d059d`, Vercel deployment `dpl_4LhrHhWjJZmFPgNs2NueWzUWnHqV`, paired frontend/API digests, all 17 Function hashes, target stack/config digests, source/target database and Storage fingerprints, rehearsal hash/timing, integration pause plan, old-domain transition deployment, route rollback JSON and owner-approved window. Validate it against `cutover/manifest.schema.json` and commit it before the window starts.

Confirm `SITE_LIVE_OBSERVATION` and `AXIS_REHEARSAL_PASSED`; exact paired image/function/stack digests; fresh target backups; source DB/Storage and Vercel rollback; N8N/job/webhook pause access; Resend/Turnstile/push secrets; five test roles; mobile/PWA test devices; old-domain transition deployment; monitoring/resources. Notify users.

**Step 2: T-minus 15 minutes**

Start timer/watch, capture baseline counts/health, and enable `migrationReadOnly=true` through the transition runtime-config endpoint on the current Vercel deployment. Confirm logged-in users see maintenance mode without exposing mutation UI. Pause N8N, jobs, webhooks and service-role writers in the rehearsed order.

**Step 3: Freeze source writes authoritatively**

Revoke managed database/Storage DML using the tested Axis freeze. Verify attempted writes fail for all five test roles, direct REST/RPC, Storage, Functions and integrations. Reads/login may remain available only for maintenance status/logout. If any writer remains, abort, restore integrations/grants and disable maintenance mode.

**Step 4: Final data and object delta**

Run the official roles/schema/data export, reset/restore the verified Axis production target, copy all bucket deltas, recreate Auth/SMTP/redirects/Realtime/17 Functions/secrets/jobs/webhooks in paused state, mark verified migrations, reconcile all tables/Auth/schema/RLS/publications/sequences/buckets/objects.

**Step 5: Private production validation**

Run priority tests for five roles/RLS; client/task/appointment/commission/report; document/chat/Realtime; check-in/QR/geolocation; notifications/push/Resend/reset; Functions/lead HMAC; `/api/apuracao`; PWA and service-worker bypass. Execute controlled target writes, clean them by exact IDs, and reconcile again.

**Step 6: Publish final app/API hostnames**

Atomically apply/read back these prebuilt routes:

- `app.imobkaizen.com.br` → Axis frontend/Nginx loopback origin;
- `api-app.imobkaizen.com.br` → Axis public Supabase gateway;
- `studio-app.imobkaizen.com.br` → Studio gateway with Access.

Confirm cache bypass and WebSocket upgrade. Do not expose the API/DB directly.

**Step 7: Handle `kaizen-axis.space` transition**

Keep the old Vercel domain as the transition shell during the observation window. Its runtime configuration must either use the new self-hosted API safely or, preferably after final hostname validation, show a prominent move/PWA reinstall message and redirect navigation to the same path/query at `app.imobkaizen.com.br`. It must never continue writing to the frozen managed project.

If DNS control for `kaizen-axis.space` is available in Cloudflare, route it to the same app during the short compatibility period. Otherwise use the Vercel transition deployment. Record which path is active; do not migrate its authoritative DNS merely by assumption.

**Step 8: Reopen in strict order**

After public priority tests pass: set target app maintenance false; re-enable target database user writes; test one transaction per critical domain; enable safe scheduled jobs; enable N8N/webhooks/lead ingestion one at a time with idempotency checks. The managed source remains frozen. Record first-target-write UTC and each integration enable time.

**Step 9: Observe and advance**

Monitor continuously for the first two hours and intensively for seven days. Use the same hard integrity/security thresholds plus Realtime disconnects, Function error rates, queue backlogs, push/email failures and apuração latency/resource saturation.

```bash
./scripts/state/advance.sh AXIS_LIVE_OBSERVATION evidence/gates/axis-live-observation.md
git add scripts/cutover docs/runbooks evidence/cutover/axis evidence/gates state/program.json
git commit -m "docs: complete Axis production cutover"
```

This state starts, but does not complete, the seven-day retention window.

## Task 4: Implement and test pre-write rollback

**Files:**

- Create: `scripts/rollback/site-prewrite.sh`
- Create: `scripts/rollback/axis-prewrite.sh`
- Create: `docs/runbooks/prewrite-rollback.md`
- Test: `tests/rollback/prewrite.bats`

**Step 1: Encode exact rollback state**

Each manifest contains the previous Cloudflare DNS/route object, Vercel deployment, managed source grants, integration state and migration-mode value. Scripts first prove target writes never opened by checking state/evidence and target audit timestamps.

**Step 2: Order the rollback**

1. Keep target writes disabled.
2. Restore Cloudflare route/DNS to the exact control destination and read it back.
3. Verify public control artifact still points to managed source.
4. Restore managed grants.
5. Resume managed integrations in the recorded order.
6. Turn maintenance off.
7. Run priority tests and record incident/evidence.

If target writes are detected, the pre-write script refuses and routes to Task 5.

**Step 3: Rehearse on staging and commit**

```bash
bats tests/rollback/prewrite.bats
git add scripts/rollback docs/runbooks tests/rollback
git commit -m "infra: automate safe pre-write route rollback"
```

## Task 5: Define post-write incident and data reconciliation

**Files:**

- Create: `scripts/rollback/export-target-delta.sh`
- Create: `scripts/rollback/compare-delta.sh`
- Create: `docs/runbooks/postwrite-incident.md`
- Test: `tests/rollback/postwrite.bats`

**Step 1: Stop divergence**

On severe incident after writes opened: enable maintenance mode; pause target integrations; revoke target DML; record last accepted write; take pgBackRest/WAL checkpoint plus logical delta export and Storage delta. Do not alter the managed source yet.

**Step 2: Prefer forward repair**

If data is intact and the problem is application/routing, promote the previously tested digest/config or fix forward while writes remain paused, validate, then reopen.

**Step 3: If returning to managed is necessary**

Classify every target change since first-target-write: inserts, updates, deletes, Auth changes, Storage objects and side effects in external integrations/email. Generate a human-reviewed reconciliation package with stable IDs/conflict policy. Restore changes into an isolated managed-source clone/staging first and run the full reconcile suite. Only after owner/database approval may the package apply to the managed source and routing revert.

No script may overwrite conflicting rows automatically. Deletes and user credential changes require explicit review. External emails/push/webhooks cannot be undone; record them as side effects.

**Step 4: Test with synthetic conflicts and commit**

```bash
bats tests/rollback/postwrite.bats
git add scripts/rollback docs/runbooks tests/rollback
git commit -m "infra: protect data during post-write rollback"
```

## Task 6: Run seven-day observation and hardening

**Files:**

- Create: `docs/runbooks/seven-day-observation.md`
- Create: `scripts/observation/daily.sh`
- Generate: `evidence/observation/day-1.md` through `day-7.md`

**Step 1: Daily checks**

Every day verify:

- external and internal uptime/latency/5xx;
- container/resource/disk/inode/network trends;
- Postgres connections, locks, long queries, deadlocks, WAL archive and backup age;
- R2 DB/object backups and a sampled restore;
- Auth success/failure/reset, RLS/security events;
- Realtime, Storage, all Functions, API queues/latency;
- Resend delivery/bounce/complaint, Mailcow queues/authentication/certificate;
- Tunnel connections, WAF/rate-limit events and false positives;
- no writes/new objects in the frozen managed sources;
- cost/usage comparison without cancelling anything.

**Step 2: Gradual security enforcement**

Move observed WAF/rate-limit rules from log to block only after false-positive review. Advance DMARC from `p=none` only after aggregate reports prove Mailcow and Resend alignment; do not jump to reject on cutover day. Enable HSTS only after all final/legacy/mail hostnames and certificates pass; defer preload until the owner accepts its long rollback implications.

**Step 3: Old domain transition**

Keep move messaging long enough for PWA users to reinstall/use the new origin. Then issue a permanent path/query-preserving redirect from `kaizen-axis.space` to `app.imobkaizen.com.br`. Service workers are origin-bound and cannot migrate silently; test uninstall/update instructions on mobile.

**Step 4: Commit daily evidence**

```bash
./scripts/observation/daily.sh
git add evidence/observation
git commit -m "docs: record migration observation day N"
```

Replace `N` with the actual day number in each commit; never batch/fabricate future days.

## Task 7: Decommission only after explicit owner approval

**Files:**

- Create: `docs/runbooks/decommission.md`
- Create: `scripts/decommission/preflight.sh`
- Create: `evidence/gates/decommission-approved.md`
- Modify: `state/program.json`

**Step 1: Satisfy preflight**

Require seven completed daily reports, no unresolved severity-1/2 issues, final managed-source logical/Storage backups copied and hashed to external storage, clean-room restore of both VPS projects, current app/DB/object backups, final source/target reconciliation, old-domain redirect tested, billing/export implications documented and explicit approval naming which Vercel/Supabase plans/projects may be removed.

**Step 2: Advance approval state without cancelling yet**

```bash
./scripts/state/advance.sh DECOMMISSION_APPROVED evidence/gates/decommission-approved.md
git add docs/runbooks scripts/decommission evidence/gates state/program.json
git commit -m "docs: approve legacy service decommission"
```

**Step 3: Perform recoverable shutdown before deletion**

Disable automatic production deployments and write-capable integrations on Vercel/managed Supabase; keep exports and provider projects retained for the owner-approved cooling period. Remove old secrets from application/provider integrations only after confirming the VPS uses rotated values.

**Step 4: Cancel/delete only the named services**

Display exact account/team/project/deployment identifiers and expected billing impact to the owner immediately before the irreversible provider action. A prior general migration approval is not permission to delete data. Obtain explicit final confirmation for each managed Supabase project and Vercel project/plan action.

**Step 5: Close the program**

Run final external, functional, security, email and restore tests; update operational ownership/runbooks; set state `COMPLETE`; archive sanitized evidence and final cost baseline.

```bash
./scripts/state/advance.sh COMPLETE evidence/gates/program-complete.md
git add evidence/gates state/program.json docs/runbooks
git commit -m "docs: complete ImobKaizen self-hosted migration"
```
