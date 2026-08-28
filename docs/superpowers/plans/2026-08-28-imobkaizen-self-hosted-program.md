# ImobKaizen Self-Hosted Migration Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Migrate the ImobKaizen institutional site and Kaizen Axis from Vercel and two managed Supabase projects to isolated, production-grade services on the existing VPS, with Cloudflare as the HTTP edge, one multi-domain Mailcow, Resend for transactional mail, external backups, tested rollback, and no unplanned production outage.

**Architecture:** Keep the two products isolated end to end. Each product gets its own Supabase Compose project, Postgres volume, credentials, MinIO bucket, R2 backup prefix, public API gateway, protected Studio, application image, staging environment, migration rehearsal, and cutover. One outbound-only Cloudflare Tunnel publishes HTTP services; SMTP/IMAP remain DNS-only. The site is migrated first as the operational pilot, followed by a stability gate and then Axis.

**Tech Stack:** Ubuntu 24.04, Docker 29/Compose, Coolify, Gitea Actions, Node.js 22 LTS, Next.js 16.2.7, Vite/React, Express, Supabase self-hosted pinned to upstream commit `86c813ec03e340ffbe4aeb97cd0c5bee7a0ead94`, PostgreSQL 17 image `supabase/postgres:17.6.1.136`, MinIO, pgBackRest, Cloudflare Tunnel/DNS/WAF/Access/R2, Mailcow, Resend, Uptime Kuma, Trivy, Syft, Playwright, k6.

---

## Authoritative inputs

- Approved design: `docs/superpowers/specs/2026-08-28-plataforma-self-hosted-imobkaizen-design.md`
- Axis production source: commit `10c8f8b6f7e61cb008fe1a1eab62148a614d059d`, Vercel deployment `dpl_4LhrHhWjJZmFPgNs2NueWzUWnHqV`
- Site production source: commit `2691097301d7efc1d8d1057c3981594bd72bb3b3`, Vercel deployment `dpl_J5VzdWUmiA4EWmyDuLzpFyjsmEK9`
- Managed Supabase Axis: `pwvpxxrvlywlneuijmmd`
- Managed Supabase site: `sngxzveittfaacdbovyu`
- Final public names: `imobkaizen.com.br`, `app.imobkaizen.com.br`, `api-site.imobkaizen.com.br`, `api-app.imobkaizen.com.br`
- Mail server canonical identity: `mail.hokmatech.com`
- Mailcow domain being added: `imobkaizen.com.br`
- Resend transactional domain: `notify.imobkaizen.com.br`

The SHAs above are immutable inputs. Branch tips and the current dirty worktrees are not migration inputs.

## Repository and server layout

| Responsibility | Local repository/path | Production path |
|---|---|---|
| Axis app and Axis Functions | `C:\Users\hokma\OneDrive\Desktop\PROJETOS\KAIZEN-AXIS` | built image only |
| Institutional site | `C:\Users\hokma\OneDrive\Desktop\PROJETOS\KAIZEN-WEBSITE` | built image only |
| Private platform repository to create | `C:\Users\hokma\OneDrive\Desktop\PROJETOS\IMOBKAIZEN-PLATFORM` | `/opt/imobkaizen-platform` |
| Runtime secrets | never committed | `/etc/imobkaizen/secrets`, owner `root:root`, mode `0700`; files mode `0600` |
| Migration evidence | `IMOBKAIZEN-PLATFORM/evidence` with secrets redacted | `/var/lib/imobkaizen/evidence` |
| Dumps during rehearsals/cutovers | not synced by OneDrive or Git | `/var/lib/imobkaizen/migrations/{site,axis}` |

The private platform repository contains declarative configuration, scripts, tests, runbooks, and non-secret desired state. It must not contain `.env` values, database dumps, Mailcow exports, private keys, R2 secrets, Cloudflare tokens, Resend keys, or Supabase service keys.

## Program plans and dependency order

1. `2026-08-28-imobkaizen-01-access-baselines.md`
   - Validate authority and credentials without exposing them.
   - Freeze source SHAs, create protected tags, inventory both managed projects, and create the private platform repository.
2. `2026-08-28-imobkaizen-02-cloudflare-email.md`
   - Move the DNS zone to Cloudflare while Vercel remains live.
   - Add the Mailcow domain, preserve the canonical mail identity, configure Resend, and prepare Tunnel/security policy.
3. `2026-08-28-imobkaizen-03-self-hosted-platform.md`
   - Deploy two isolated Supabase stacks, MinIO isolation, R2/pgBackRest, public/protected gateways, logging, metrics, and restore tests.
4. `2026-08-28-imobkaizen-04-site-migration.md`
   - Containerize the exact site production SHA, add tests/readiness controls, rehearse data and Storage migration, and promote the site.
5. `2026-08-28-imobkaizen-06-cutover-rollback.md`, Tasks 1–2
   - Sign the site manifest, cut over the site, and observe it for 24 hours.
6. `2026-08-28-imobkaizen-05-axis-migration.md`
   - Containerize the exact Axis production SHA and `/api/apuracao`, adapt the PWA/domains, deploy all 17 Functions, and rehearse the full Axis migration.
7. `2026-08-28-imobkaizen-06-cutover-rollback.md`, Tasks 3–7
   - Sign and execute the Axis cutover, observe for seven days, handle rollback/data reconciliation, redirect the old domain, and decommission only after explicit approval.

Plans are sequential at the gate level even though the cutover runbook is intentionally entered twice. Tasks inside one gate may be parallelized only when they do not mutate the same repository, DNS zone, database, Mailcow instance, or production route.

## Non-negotiable safety invariants

1. Never print secret values. Validation output records only presence, scope, expiry, fingerprint, and success/failure.
2. Never build a production artifact from a moving branch or dirty tree. Use detached worktrees at the approved SHAs.
3. Never point a production hostname to an origin that has not passed staging smoke tests and an authenticated functional suite.
4. Never expose Postgres, Docker, Coolify, Studio, MinIO console, or backup endpoints publicly.
5. Never proxy SMTP, IMAP, POP3, submission, or ManageSieve through ordinary Cloudflare orange-cloud DNS/Tunnel.
6. Never enable shared caching on Auth, REST, Realtime, Storage, Functions, `/api`, login, or authenticated HTML.
7. Never start final data copy before write freeze has been independently verified at both UI and database boundaries.
8. Never re-enable writes until reconciliation gates pass.
9. Never use DNS rollback after new writes without first exporting and reconciling the VPS delta.
10. Never cancel Vercel or managed Supabase automatically. Seven stable days, a final backup, a successful restore, and explicit owner approval are required.

## State machine and gates

Create `state/program.json` in the private platform repository with these ordered states:

```json
{
  "schema": 1,
  "current": "ACCESS_PENDING",
  "allowed": [
    "ACCESS_PENDING",
    "BASELINES_FROZEN",
    "DNS_ON_CLOUDFLARE",
    "EMAIL_VALIDATED",
    "PLATFORM_STAGING_READY",
    "SITE_REHEARSAL_PASSED",
    "SITE_LIVE_OBSERVATION",
    "AXIS_REHEARSAL_PASSED",
    "AXIS_LIVE_OBSERVATION",
    "DECOMMISSION_APPROVED",
    "COMPLETE"
  ],
  "evidence": []
}
```

Implement `scripts/state/advance.sh` so it refuses skipped states, requires the evidence file supplied on the command line, hashes that evidence, and appends the hash and UTC timestamp. Unit-test it with `tests/state/advance.bats` before using it. Production-changing scripts must call it or verify the expected state before acting.

## Definition of each gate

| Gate | Required evidence |
|---|---|
| `BASELINES_FROZEN` | protected tags resolve to exact SHAs; Vercel deployment metadata archived; two Supabase admin/database connections validated; inventory bundle checksummed |
| `DNS_ON_CLOUDFLARE` | delegated nameservers active; pre/post DNS diff has no unexplained loss; Vercel site and current mail still pass from external monitors |
| `EMAIL_VALIDATED` | Mailcow receives/sends for both domains; PTR/HELO remains canonical; SPF/DKIM/DMARC checks pass; Resend subdomain verified and test delivered |
| `PLATFORM_STAGING_READY` | both stack health suites pass; public gateways cannot reach Studio; Access denies unauthorized users; R2 restore drill passes for both projects |
| `SITE_REHEARSAL_PASSED` | restore from fresh managed dump; row/object reconciliation; admin CRUD and public flows pass; rehearsal duration at most 30 minutes |
| `SITE_LIVE_OBSERVATION` | site cutover signed off; 24 hours without unresolved severity-1/2 issue before Axis work proceeds |
| `AXIS_REHEARSAL_PASSED` | all roles/RLS, 17 Functions, Storage, Realtime, push, email, `/api/apuracao`, PWA upgrade and migration timing pass |
| `AXIS_LIVE_OBSERVATION` | Axis cutover signed off; seven-day monitoring window started; old systems retained read-only |
| `DECOMMISSION_APPROVED` | seven stable days; final backups and restore tests; owner approval recorded without credentials |

## Required evidence format

Every mutation task writes a Markdown evidence file under `evidence/YYYY-MM-DD/<system>/<task>.md` containing:

```markdown
# Evidence: concise task name

- Started UTC:
- Finished UTC:
- Operator:
- Source SHA/image digest:
- Target:
- Commands executed: secret values redacted
- Expected result:
- Actual result:
- Checksums/report paths:
- Rollback available: yes/no and exact action
- Verdict: PASS/FAIL
```

Generated machine reports live beside the Markdown file and are referenced by SHA-256. Do not commit reports that contain personal data, email content, tokens, raw database rows, or full environment dumps.

## Verification commands before every promotion

Run from the private platform repository:

```bash
shellcheck scripts/**/*.sh
bats tests
docker compose -f stacks/site/compose.yml --env-file /etc/imobkaizen/secrets/site.env config --quiet
docker compose -f stacks/axis/compose.yml --env-file /etc/imobkaizen/secrets/axis.env config --quiet
./scripts/security/assert-no-secret.sh
./scripts/security/assert-no-public-db.sh
./scripts/health/all.sh staging
```

Expected: every command exits `0`; Compose emits no unresolved variable; no service publishes `5432`, `3000` Studio, MinIO console, Docker socket, or a secrets path; all authenticated and unauthenticated probes have the expected status.

## Program-level completion test

The program is complete only when all of the following are true:

- `imobkaizen.com.br` serves the site image built from the approved site SHA/digest.
- `app.imobkaizen.com.br` serves Axis images built from the approved Axis SHA/digests.
- both public Supabase gateways use the VPS stacks and the old managed refs are absent from production bundles;
- both restored databases and object stores pass signed reconciliation reports;
- all application, role/RLS, email, PWA, Realtime, Storage, API, security, backup, and external monitor suites pass;
- Cloudflare Tunnel is the only HTTP ingress for the migrated services;
- Mailcow serves both mail domains while `mail.hokmatech.com` remains HELO/PTR/MX target;
- Resend sends only through `notify.imobkaizen.com.br` for transactional use;
- a clean-room R2 restore of each project succeeds within the four-hour RTO;
- old Vercel/Supabase services are retained for at least seven stable days and are removed only after explicit approval.

## Commit strategy

Each numbered task in the subordinate plans is one reviewable commit. Use prefixes `infra:`, `ci:`, `test:`, `site:`, `axis:`, `mail:`, `cloudflare:`, `backup:`, or `docs:`. Never combine DNS/mail production mutation evidence with unrelated application code. Tag promoted image digests in the private platform repository with `site-prod-YYYYMMDD-HHMM` or `axis-prod-YYYYMMDD-HHMM` after the evidence is committed.

## References

- [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting)
- [Restore managed Supabase to self-hosted](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
- [Supabase S3 storage backend](https://supabase.com/docs/guides/self-hosting/self-hosted-s3)
- [Cloudflare Tunnel routing](https://developers.cloudflare.com/tunnel/routing/)
- [Cloudflare full DNS setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
- [Mailcow DNS requirements](https://docs.mailcow.email/getstarted/prerequisite-dns/)
- [Mailcow reverse proxy/additional server names](https://docs.mailcow.email/post_installation/reverse-proxy/r_p/)
- [Resend domains](https://resend.com/docs/dashboard/domains/introduction)
