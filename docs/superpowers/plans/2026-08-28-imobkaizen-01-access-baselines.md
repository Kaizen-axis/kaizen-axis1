# ImobKaizen Access, Baselines, and Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Prove all required authority, freeze the exact production sources, create a private infrastructure repository, and capture complete non-secret inventories of both managed Supabase projects and the VPS before any production route or data is changed.

**Architecture:** Treat access validation and inventory as a hard gate. Scripts consume secrets only from the operator environment or root-owned VPS files, write redacted capability reports, and stop on a project-ref/account mismatch. Detached Git worktrees at immutable production SHAs prevent current branches and user changes from contaminating migration images.

**Tech Stack:** PowerShell 7, Bash, Git, Gitea API/Actions, Vercel CLI/API, Supabase CLI, PostgreSQL client, Docker, jq, curl, OpenSSL, SHA-256.

---

## Task 1: Create the private platform repository and secret boundary

**Files:**

- Create: `C:\Users\hokma\OneDrive\Desktop\PROJETOS\IMOBKAIZEN-PLATFORM\README.md`
- Create: `C:\Users\hokma\OneDrive\Desktop\PROJETOS\IMOBKAIZEN-PLATFORM\.gitignore`
- Create: `C:\Users\hokma\OneDrive\Desktop\PROJETOS\IMOBKAIZEN-PLATFORM\Makefile`
- Create: `C:\Users\hokma\OneDrive\Desktop\PROJETOS\IMOBKAIZEN-PLATFORM\state\program.json`
- Create: `C:\Users\hokma\OneDrive\Desktop\PROJETOS\IMOBKAIZEN-PLATFORM\scripts\security\assert-no-secret.sh`
- Test: `C:\Users\hokma\OneDrive\Desktop\PROJETOS\IMOBKAIZEN-PLATFORM\tests\security\no-secret.bats`

**Step 1: Write the failing secret-boundary test**

The Bats test creates a temporary tracked-looking file with `SUPABASE_SERVICE_ROLE_KEY=`, confirms `assert-no-secret.sh` rejects it, then confirms a file containing only `SUPABASE_SERVICE_ROLE_KEY` as a variable name is accepted. It must also reject PEM private-key headers, PostgreSQL connection strings containing passwords, Cloudflare bearer tokens, Resend `re_` keys, and JWT-like values.

**Step 2: Run the test and confirm failure**

```bash
bats tests/security/no-secret.bats
```

Expected: fail because the scanner does not exist.

**Step 3: Create repository structure and scanner**

`.gitignore` must include:

```gitignore
.env
.env.*
!.env.example
secrets/
evidence/private/
state/private/
*.dump
*.sql.gz
*.tar.gz
*.pem
*.key
*.p12
*.age
```

`assert-no-secret.sh` must scan tracked files with `git grep`, use allowlisted variable-name examples only, and return non-zero with filenames but never matching values. Add `make test` to run ShellCheck, Bats, and the secret scanner.

**Step 4: Run tests**

```bash
make test
```

Expected: PASS.

**Step 5: Initialize and create the private Gitea repository**

Use the existing Gitea administrator session to create a private repository named `imobkaizen-platform`; disable public visibility and wiki; enable Actions; require signed-in access. Push only after `make test` succeeds.

**Step 6: Commit**

```bash
git add README.md .gitignore Makefile state scripts/security tests/security
git commit -m "infra: initialize private ImobKaizen platform repository"
```

## Task 2: Build a redacted access preflight

**Files:**

- Create: `scripts/preflight/check-access.ps1`
- Create: `scripts/preflight/check-vps.sh`
- Create: `tests/preflight/check-access.Tests.ps1`
- Create: `docs/runbooks/interactive-access.md`
- Generate, do not commit until manually inspected: `state/access-capabilities.json`

**Step 1: Write failing Pester tests**

Cover these invariants:

- output may contain the two expected Supabase refs but never a URL password, access token, API key, cookie, or authorization header;
- a Cloudflare token that cannot see `imobkaizen.com.br` yields `cloudflare.zone=false`;
- Supabase access is true only if both `pwvpxxrvlywlneuijmmd` and `sngxzveittfaacdbovyu` are visible and a read-only SQL probe succeeds for each;
- the report differentiates login/session access, database access, and production mutation authority;
- missing registrar nameserver authority and missing Resend domain-create authority are blockers, not warnings.

**Step 2: Run tests and confirm failure**

```powershell
Invoke-Pester tests/preflight/check-access.Tests.ps1
```

**Step 3: Implement the probes**

`check-access.ps1` reads secret values from process environment only and performs:

- Vercel: confirm both deployment IDs are `READY` and resolve to the approved Git SHAs;
- Supabase: list accessible projects and run `select current_setting('server_version'), current_database(), current_user;` using `SITE_SOURCE_DB_URL` and `AXIS_SOURCE_DB_URL`;
- Cloudflare: verify token, account membership, zone visibility, DNS edit, Tunnel edit, Access app/policy edit, zone ruleset edit, and R2 access independently;
- Resend: list domains and prove create/read permission without creating a domain;
- registrar/HostGator: record a manual `PASS` only after an authenticated operator reaches the nameserver screen; never automate or store the session cookie;
- VPS: call `check-vps.sh` over SSH and store only versions, capacity, listening ports, firewall rules, container names/images/health, and filesystem paths.

The JSON schema must be:

```json
{
  "checked_at_utc": "RFC3339 timestamp",
  "vercel": { "axis": false, "site": false },
  "supabase": {
    "axis_project": false,
    "axis_database": false,
    "site_project": false,
    "site_database": false
  },
  "cloudflare": {
    "account": false,
    "zone": false,
    "dns_edit": false,
    "tunnel_edit": false,
    "access_edit": false,
    "rulesets_edit": false,
    "r2": false
  },
  "registrar_nameservers": false,
  "resend_domains": false,
  "vps": { "ssh": false, "sudo": false, "docker": false },
  "blockers": []
}
```

**Step 4: Document the only permitted interactive actions**

`docs/runbooks/interactive-access.md` instructs the owner to log in directly in the provider browser/CLI for Supabase, Cloudflare, HostGator/registrar, or Resend when a probe fails. Passwords and 2FA codes are typed only into the provider interface, never chat, Git, terminal history, or evidence.

**Step 5: Run the preflight**

```powershell
$env:SITE_SOURCE_DB_URL = Read-Host 'Site DB URL' -AsSecureString | ConvertFrom-SecureString -AsPlainText
$env:AXIS_SOURCE_DB_URL = Read-Host 'Axis DB URL' -AsSecureString | ConvertFrom-SecureString -AsPlainText
pwsh scripts/preflight/check-access.ps1 -Output state/access-capabilities.json
Remove-Item Env:SITE_SOURCE_DB_URL,Env:AXIS_SOURCE_DB_URL
```

Expected: all booleans required by the program gate are `true`. If not, stop. Do not proceed to Task 3 and do not infer authority from locally documented credentials.

**Step 6: Commit code and redacted report**

```bash
git add scripts/preflight tests/preflight docs/runbooks state/access-capabilities.json
git commit -m "infra: add redacted provider access preflight"
```

## Task 3: Freeze immutable production Git baselines

**Files:**

- Create: `scripts/baseline/freeze.ps1`
- Create: `tests/baseline/freeze.Tests.ps1`
- Generate: `state/baselines.json`
- Create detached worktrees outside the live repositories:
  - `C:\Users\hokma\OneDrive\Desktop\PROJETOS\MIGRATION-WORKTREES\kaizen-axis`
  - `C:\Users\hokma\OneDrive\Desktop\PROJETOS\MIGRATION-WORKTREES\kaizen-website`

**Step 1: Test mismatch refusal**

The script must fail if:

- Vercel deployment Git SHA differs from the hard-coded approved SHA;
- the local repository cannot resolve the SHA;
- a tag already exists at another object;
- the detached worktree contains modifications;
- lockfile or Node engine metadata cannot be hashed.

**Step 2: Implement exact baselines**

Use annotated tags:

- Axis: `migration-prod-axis-20260828` → `10c8f8b6f7e61cb008fe1a1eab62148a614d059d`
- Site: `migration-prod-site-20260828` → `2691097301d7efc1d8d1057c3981594bd72bb3b3`

`freeze.ps1` must create/push tags to GitHub and Gitea, query them back, and record repository URL, commit, tree hash, tag object, Vercel deployment ID, `package-lock.json` SHA-256, Node target, and UTC timestamp in `state/baselines.json`. It must never commit or stash the user's current untracked/modified files.

**Step 3: Run**

```powershell
pwsh scripts/baseline/freeze.ps1
git -C C:\Users\hokma\OneDrive\Desktop\PROJETOS\MIGRATION-WORKTREES\kaizen-axis status --porcelain
git -C C:\Users\hokma\OneDrive\Desktop\PROJETOS\MIGRATION-WORKTREES\kaizen-website status --porcelain
```

Expected: both status outputs are empty and `state/baselines.json` contains the exact SHAs above.

**Step 4: Protect tags in Gitea**

Create tag-protection rules for `migration-prod-*` permitting creation/deletion only by repository administrators. Confirm a non-admin token cannot delete them.

**Step 5: Commit**

```bash
git add scripts/baseline tests/baseline state/baselines.json
git commit -m "infra: freeze Vercel production baselines"
```

## Task 4: Capture source Supabase inventory without user data

**Files:**

- Create: `sql/inventory/project.sql`
- Create: `scripts/inventory/supabase.sh`
- Create: `scripts/inventory/functions-env-names.sh`
- Test: `tests/inventory/supabase.bats`
- Generate: `evidence/inventory/site/`
- Generate: `evidence/inventory/axis/`

**Step 1: Write the inventory SQL**

It must export metadata/counts only:

- `server_version`, installed extensions and versions;
- schemas, roles and membership names;
- tables, columns, sequences, indexes, constraints, RLS enabled/forced flags;
- policy definitions, functions, triggers, publications and publication tables;
- aggregate row counts by table, exact for the cutover-critical tables;
- `auth.users` count grouped only by provider, confirmed state, and disabled state;
- Storage bucket settings and object counts/total bytes by bucket;
- cron jobs, Vault usage names, hooks, webhooks, and custom database settings;
- database size, largest relations, connection usage, and WAL settings.

Do not select email addresses, phone numbers, JWTs, object names, row bodies, password hashes, or secret values.

**Step 2: Test redaction with a fixture database/output**

`supabase.bats` injects fake emails, tokens, password URLs, and JWTs and proves the script either omits or replaces them with `[REDACTED]` before writing evidence.

**Step 3: Capture both inventories**

```bash
SITE_SOURCE_DB_URL="$SITE_SOURCE_DB_URL" ./scripts/inventory/supabase.sh site sngxzveittfaacdbovyu
AXIS_SOURCE_DB_URL="$AXIS_SOURCE_DB_URL" ./scripts/inventory/supabase.sh axis pwvpxxrvlywlneuijmmd
./scripts/inventory/functions-env-names.sh ../MIGRATION-WORKTREES/kaizen-axis/supabase/functions evidence/inventory/axis/function-env-names.txt
```

Expected Axis function inventory: exactly these 17 directories:

```text
audit-log
brasil-aberto
checkin-geo
checkin-geo-v2
export-pipeline-corretor
generate-view-once-url
get-chat-media-url
get-doc-url
get-doc-url-v2
kai-agent
rate-guard
receive-lead
secure-login
send-email
send-notification
send-password-reset
send-push
```

**Step 4: Capture Auth/provider and platform-only settings manually**

Export screenshots or redacted JSON showing allowed redirect URLs, signup/autoconfirm, password policy, SMTP setting names, OAuth provider enablement, rate limits, email templates, Realtime publication, Function verification settings, and secret *names*. Record values only into `/etc/imobkaizen/secrets` during the platform plan.

**Step 5: Commit redacted evidence**

```bash
./scripts/security/assert-no-secret.sh
git add sql/inventory scripts/inventory tests/inventory evidence/inventory
git commit -m "infra: inventory managed Supabase projects"
```

## Task 5: Capture VPS, Mailcow, MinIO, Gitea, and network inventory

**Files:**

- Create: `scripts/inventory/vps.sh`
- Create: `scripts/inventory/mailcow.sh`
- Create: `scripts/inventory/minio.sh`
- Create: `scripts/inventory/gitea.sh`
- Test: `tests/inventory/vps.bats`
- Generate: `evidence/inventory/vps/`

**Step 1: Implement read-only inventory**

Capture:

- OS/kernel, CPU/RAM/disk/inodes, time sync, Docker/Compose versions;
- Docker networks, published ports, service/image/digest/health/restart policy and resource limits;
- UFW rules and `ss -lntup`, with public exposure classified;
- Coolify and Gitea versions, runner labels/capacity, registry endpoint and storage usage;
- Mailcow path/version, `MAILCOW_HOSTNAME`, bindings, existing domains/counts, certificate SANs/expiry, current backup capability, and active ports;
- MinIO endpoint/version, bucket names/counts/usage/policies without access keys;
- current backup timers/jobs, R2 bucket names, Uptime Kuma reachability, and `/opt` ownership/modes.

Never run `docker inspect` without filtering environment values. Never copy Mailcow config or MinIO credentials into evidence.

**Step 2: Run and review**

```bash
ssh "$VPS_SSH_TARGET" 'bash -s' < scripts/inventory/vps.sh > evidence/inventory/vps/system.json
ssh "$VPS_SSH_TARGET" 'sudo bash -s' < scripts/inventory/mailcow.sh > evidence/inventory/vps/mailcow.json
ssh "$VPS_SSH_TARGET" 'sudo bash -s' < scripts/inventory/minio.sh > evidence/inventory/vps/minio.json
ssh "$VPS_SSH_TARGET" 'sudo bash -s' < scripts/inventory/gitea.sh > evidence/inventory/vps/gitea.json
```

Expected: enough free capacity for two staging stacks plus two production stacks during rehearsal. If disk projections leave less than 25% free or RAM projections leave less than 20% headroom, stop and resize/clean by an separately approved plan; do not delete existing workloads.

**Step 3: Commit**

```bash
git add scripts/inventory tests/inventory evidence/inventory/vps
git commit -m "infra: capture VPS and service inventory"
```

## Task 6: Record the baseline gate

**Files:**

- Create: `scripts/state/advance.sh`
- Test: `tests/state/advance.bats`
- Create: `evidence/gates/baselines-frozen.md`
- Modify: `state/program.json`

**Step 1: Test ordered transitions and evidence hashing**

Prove that a skipped state, absent evidence, changed evidence, invalid JSON, or dirty secret scan blocks advancement.

**Step 2: Generate the gate report**

The report links the access capability file, both protected tags, Vercel metadata, source inventories, VPS inventory, capacity verdict, and SHA-256 manifest.

**Step 3: Advance**

```bash
./scripts/state/advance.sh BASELINES_FROZEN evidence/gates/baselines-frozen.md
git add scripts/state tests/state evidence/gates/baselines-frozen.md state/program.json
git commit -m "docs: approve immutable migration baselines"
```

Expected: `state/program.json.current` is `BASELINES_FROZEN`. If any required credential or authority remains unconfirmed, this task must not be executed.
