# ImobKaizen Self-Hosted Supabase Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Deploy two isolated, hardened Supabase production stacks plus isolated staging stacks on the VPS, backed by product-specific MinIO credentials, encrypted R2 backups with continuous WAL archiving, protected/public gateways, health tests, metrics, centralized logs, and proven restoration.

**Architecture:** Vendor one reviewed Supabase Docker snapshot, generate four deployment directories from it, and remove fixed `container_name`/host-port assumptions so Compose project isolation works. Only loopback-bound Nginx gateways are exposed to `cloudflared`: a strict public API gateway and a separate full gateway protected by Cloudflare Access for Studio. Each product/environment has unique databases, Docker networks/volumes, JWT/API keys, Postgres/backup secrets, MinIO user/bucket, R2 repository, functions and ports. Postgres uses a Supabase-derived image with pgBackRest for encrypted backups and WAL archive.

**Tech Stack:** Supabase Docker snapshot `86c813ec03e340ffbe4aeb97cd0c5bee7a0ead94`, Studio `2026.08.03-sha-022b374`, Envoy `v1.39.0`, GoTrue `v2.189.0`, PostgREST `v14.12`, Realtime `v2.102.3`, Storage `v1.60.4`, Edge Runtime `v1.74.0`, PostgreSQL `17.6.1.136`, Supavisor `2.9.5`, Nginx, MinIO S3, pgBackRest `2.59.1`, R2, rclone crypt, Prometheus `v3.14.0`, Grafana `v13.2.0`, Loki `v3.7.7`, Node Exporter `v1.12.1`, Postgres Exporter `v0.20.1`, cAdvisor `v0.60.5`.

---

## Fixed runtime map

| Stack | Compose project | Public loopback gateway | Studio loopback gateway | Final/Tunnel hostname |
|---|---|---:|---:|---|
| Site staging | `imob-site-stg` | `127.0.0.1:18100` | `127.0.0.1:18101` | temporary Access-protected staging names |
| Site production | `imob-site-prod` | `127.0.0.1:8100` | `127.0.0.1:8101` | `api-site` / `studio-site` |
| Axis staging | `imob-axis-stg` | `127.0.0.1:18200` | `127.0.0.1:18201` | temporary Access-protected staging names |
| Axis production | `imob-axis-prod` | `127.0.0.1:8200` | `127.0.0.1:8201` | `api-app` / `studio-app` |

PostgreSQL, Supavisor, Studio, Meta, MinIO, Prometheus exporters, and Docker networks publish no public host port. Staging hostnames must be protected by Access and removed or retained as administrator-only after cutover.

## Task 1: Vendor and verify the upstream Supabase snapshot

**Files:**

- Create: `vendor/supabase/UPSTREAM.lock`
- Vendor: `vendor/supabase/docker/`
- Create: `scripts/supabase/sync-upstream.sh`
- Create: `scripts/supabase/verify-images.sh`
- Create: `patches/supabase/multi-project.patch`
- Test: `tests/supabase/upstream.bats`

**Step 1: Write failing provenance tests**

Tests must assert:

- upstream commit is exactly `86c813ec03e340ffbe4aeb97cd0c5bee7a0ead94`;
- the eleven image tags listed in the Tech Stack match the vendored Compose file;
- every image resolves to and is recorded by immutable digest for `linux/amd64`;
- no `latest` tag exists;
- the vendored tree hash matches `UPSTREAM.lock`;
- the multi-project patch removes every fixed `container_name`, removes direct API gateway port publication, and leaves no database host port.

**Step 2: Run and confirm failure**

```bash
bats tests/supabase/upstream.bats
```

**Step 3: Vendor the exact snapshot**

`sync-upstream.sh` performs a shallow archive/export of `docker/` at the fixed SHA, applies `multi-project.patch`, records upstream URL/SHA/tree hash/image tag/digest/UTC timestamp, and fails on patch drift. Do not track upstream `.env` values; track only `.env.example`.

**Step 4: Review upstream changes before any later update**

The initial snapshot is fixed. Future bumps require a separate PR with upstream diff, database compatibility review, image CVE scan, staging restore, application tests, and rollback digest. Renovation must never automatically promote a Supabase image.

**Step 5: Verify and commit**

```bash
./scripts/supabase/sync-upstream.sh
./scripts/supabase/verify-images.sh
bats tests/supabase/upstream.bats
git add vendor/supabase patches/supabase scripts/supabase tests/supabase
git commit -m "infra: pin production Supabase Docker snapshot"
```

## Task 2: Generate isolated stack directories and non-secret configuration

**Files:**

- Create: `stacks/template/compose.override.yml`
- Create: `stacks/template/env.schema`
- Create: `stacks/template/gateway/public.conf.template`
- Create: `stacks/template/gateway/studio.conf.template`
- Create: `scripts/supabase/render-stack.sh`
- Create: `scripts/supabase/generate-secrets.sh`
- Create: `scripts/security/assert-stack-isolation.sh`
- Test: `tests/supabase/isolation.bats`
- Generate: `stacks/site-staging/`, `stacks/site-production/`, `stacks/axis-staging/`, `stacks/axis-production/`

**Step 1: Write isolation tests**

Render all four stacks with dummy secrets and assert:

- unique Compose project, network, volume, database password, JWT secret, anon/service/opaque key set, dashboard credentials, S3 credentials, Postgres exporter credentials, backup stanza/cipher pass, and public ports;
- no environment can address another environment's database/service by Docker DNS;
- no fixed `container_name` remains;
- no `0.0.0.0` published bind exists;
- public gateway exposes only API routes and returns `404` for Studio/root/meta/pg endpoints;
- service-role, secret, database, MinIO, R2 and dashboard credentials never appear in client-visible files.

**Step 2: Define the required secret-name schema**

`env.schema` lists names, classification and consumer without values. It includes official Supabase variables and:

```text
STACK_ID
PUBLIC_GATEWAY_PORT
STUDIO_GATEWAY_PORT
POSTGRES_PASSWORD
JWT_SECRET
ANON_KEY
SERVICE_ROLE_KEY
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
DASHBOARD_USERNAME
DASHBOARD_PASSWORD
SECRET_KEY_BASE
VAULT_ENC_KEY
PG_META_CRYPTO_KEY
REALTIME_DB_ENC_KEY
LOGFLARE_PUBLIC_ACCESS_TOKEN
LOGFLARE_PRIVATE_ACCESS_TOKEN
MINIO_ENDPOINT
MINIO_BUCKET
MINIO_ACCESS_KEY_ID
MINIO_SECRET_ACCESS_KEY
R2_DB_BUCKET
R2_OBJECT_BUCKET
R2_ENDPOINT
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
PGBACKREST_CIPHER_PASS
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_ADMIN_EMAIL
SMTP_SENDER_NAME
```

Axis-only Function secret names come from the inventory and include `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_ORIGIN`, `APP_ORIGINS`, `TURNSTILE_SECRET_KEY`, `REQUIRE_CAPTCHA`, VAPID variables, `LEAD_WEBHOOK_SECRET`, `N8N_LEAD_CREATED_WEBHOOK_URL`, `BRASIL_ABERTO_API_KEY`, office/check-in settings, and the KAI/OpenAI variables discovered in the exact baseline. Values are copied/rotated through the secret store, never committed.

**Step 3: Implement secret generation**

`generate-secrets.sh` calls the vendored official Supabase key utility for API/JWT keys, uses OpenSSL for independent high-entropy secrets, writes directly to `/etc/imobkaizen/secrets/{stack}.env` through `sudo install -m 0600`, and emits only key names plus SHA-256 fingerprints to evidence. It must refuse to reuse a JWT secret, database password, S3 key, or backup cipher pass between stacks.

**Step 4: Implement public and Studio gateways**

`public.conf.template` accepts only:

```text
/auth/v1/
/rest/v1/
/graphql/v1
/realtime/v1/
/storage/v1/
/functions/v1/
```

It supports WebSocket upgrade on Realtime, large uploads according to inventory, preserves `Host`/forwarded headers, disables response buffering for WebSockets, sets defensive timeouts, emits a sanitized `/healthz`, and returns `404` for all other paths. It rate-limits auth token/recovery and Functions independently, with values verified under load before production.

`studio.conf.template` proxies the complete Envoy surface but binds loopback and trusts only the local Tunnel path. Cloudflare Access is required at the public hostname; Nginx also requires a Cloudflare Access service-token header for synthetic health where applicable.

**Step 5: Render and validate**

```bash
for stack in site-staging site-production axis-staging axis-production; do
  sudo ./scripts/supabase/generate-secrets.sh "$stack"
  ./scripts/supabase/render-stack.sh "$stack"
  docker compose -p "$(awk -F= '$1=="STACK_ID" {print $2}' /etc/imobkaizen/secrets/$stack.env)" \
    --env-file "/etc/imobkaizen/secrets/$stack.env" \
    -f "stacks/$stack/compose.yml" config --quiet
done
./scripts/security/assert-stack-isolation.sh
```

**Step 6: Commit**

```bash
git add stacks scripts/supabase scripts/security tests/supabase
git commit -m "infra: generate four isolated Supabase environments"
```

## Task 3: Provision least-privilege MinIO storage per stack

**Files:**

- Create: `storage/minio/policy.template.json`
- Create: `storage/minio/buckets.json`
- Create: `scripts/storage/ensure-minio.sh`
- Create: `scripts/storage/test-isolation.sh`
- Test: `tests/storage/minio.bats`

**Step 1: Define exact buckets**

```json
{
  "site-staging": "imobkaizen-site-stg-storage",
  "site-production": "imobkaizen-site-prod-storage",
  "axis-staging": "imobkaizen-axis-stg-storage",
  "axis-production": "imobkaizen-axis-prod-storage"
}
```

Each bucket gets a separate MinIO service account and policy permitting only list/get/put/delete/multipart operations on that bucket. Console/admin permissions are forbidden. Enable bucket versioning if the installed MinIO edition/configuration supports it; record the actual result.

Create one external Docker network `imob-storage-backbone`. Connect the existing MinIO service and only the four Supabase Storage services to it; do not connect Auth, REST, Studio, Functions, applications, public gateways or observability. Manage the network attachment through the MinIO/Coolify persistent configuration so a redeploy cannot silently remove it.

**Step 2: Test cross-bucket denial**

For each service account, put/get/delete a random probe in its own bucket and prove list/get/put to each other bucket returns access denied. Delete only the generated probe after checking its exact prefix.

**Step 3: Configure Supabase Storage backend**

In the rendered Storage service set:

```yaml
STORAGE_BACKEND: s3
GLOBAL_S3_BUCKET: ${MINIO_BUCKET}
GLOBAL_S3_ENDPOINT: ${MINIO_ENDPOINT}
GLOBAL_S3_PROTOCOL: http
GLOBAL_S3_FORCE_PATH_STYLE: "true"
AWS_ACCESS_KEY_ID: ${MINIO_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY: ${MINIO_SECRET_ACCESS_KEY}
REGION: us-east-1
```

Keep MinIO on the private Docker/VPS network. The public Supabase Storage API remains the only browser-facing path and continues enforcing `storage.objects` RLS.

**Step 4: Commit**

```bash
git add storage/minio scripts/storage tests/storage
git commit -m "infra: isolate Supabase object storage in MinIO"
```

## Task 4: Build encrypted PostgreSQL backup and continuous WAL archive

**Files:**

- Create: `images/supabase-postgres-pgbackrest/Dockerfile`
- Create: `backup/pgbackrest/pgbackrest.conf.template`
- Create: `backup/postgres/archive.conf`
- Create: `scripts/backup/render-pgbackrest.sh`
- Create: `scripts/backup/run-db-backup.sh`
- Create: `scripts/backup/check-wal.sh`
- Create: `systemd/imobkaizen-db-backup@.service`
- Create: `systemd/imobkaizen-db-backup@.timer`
- Test: `tests/backup/pgbackrest.bats`

**Step 1: Write a failing backup integration test**

Start a disposable Postgres stack, insert a marker before and after a forced WAL switch, create a full then differential backup, remove the disposable volume, restore to the target timestamp, and prove only the expected marker state exists. Also prove the R2 objects are unreadable without the pgBackRest cipher pass.

**Step 2: Build the database image**

Base it exactly on `supabase/postgres:17.6.1.136`, install pgBackRest `2.59.1`, remove package caches, preserve the upstream entrypoint/user, generate SBOM, scan with Trivy, and publish by digest in the private Gitea registry. No secret enters a Docker layer or build argument.

**Step 3: Create separate R2 buckets**

```text
imobkaizen-site-db-backup
imobkaizen-axis-db-backup
imobkaizen-site-object-backup
imobkaizen-axis-object-backup
```

Staging uses separate prefixes and separate API tokens. Production tokens can access only their product's bucket. Enable R2 lifecycle according to 30 daily backups and six monthly retained full backups, while preserving pgBackRest metadata required by that retention.

Store an off-VPS recovery copy of each backup cipher pass and R2 recovery credential in the owner-controlled Vaultwarden/offline encrypted recovery package. The VPS retains the runtime copy needed to write backups, but a destroyed VPS must not destroy the only copy of its decryption material. Test retrieval during the clean-room drill.

**Step 4: Configure archive and encryption**

Render one root-owned pgBackRest config per stack. Required settings include S3 repository type, R2 endpoint, path-style URI, `repo1-cipher-type=aes-256-cbc`, product-specific `repo1-cipher-pass`, retention, archive check, fast start, and the correct Postgres data path. Configure Postgres with:

```text
archive_mode=on
archive_command=pgbackrest --stanza=${STACK_ID} archive-push %p
archive_timeout=900
wal_level=replica
```

`archive_timeout=900` caps idle-workload RPO at approximately 15 minutes when archive is healthy. Monitoring must alert on oldest unarchived WAL and failed `check`/backup.

**Step 5: Schedule and verify**

- full backup weekly;
- differential daily;
- continuous WAL archive;
- monthly restore drill for each production product;
- never delete an old backup based only on age before `pgbackrest expire` confirms repository consistency.

```bash
sudo systemctl enable --now imobkaizen-db-backup@site-production.timer
sudo systemctl enable --now imobkaizen-db-backup@axis-production.timer
sudo ./scripts/backup/check-wal.sh site-production
sudo ./scripts/backup/check-wal.sh axis-production
```

Expected: last archived WAL under 15 minutes and `pgbackrest check` PASS.

**Step 6: Commit**

```bash
git add images backup scripts/backup systemd tests/backup
git commit -m "backup: add encrypted R2 WAL and database backups"
```

## Task 5: Back up object storage with independent encryption

**Files:**

- Create: `backup/rclone/rclone.conf.template`
- Create: `scripts/backup/sync-objects.sh`
- Create: `scripts/backup/verify-objects.sh`
- Create: `systemd/imobkaizen-object-backup@.service`
- Create: `systemd/imobkaizen-object-backup@.timer`
- Test: `tests/backup/objects.bats`

**Step 1: Test idempotent encrypted copy**

Use temporary S3 fixtures to prove add/change/delete behavior, encrypted names/content in the destination, checksum manifest creation, and restore into an empty bucket. Deletes in source must not immediately erase recoverable R2 history; use dated snapshots or R2 versioning/lifecycle where available.

**Step 2: Configure per-product `rclone crypt`**

Each product gets an independent crypt password/salt and R2 token. Store config at `/etc/imobkaizen/secrets/rclone-{product}.conf`, mode `0600`. The script reads the correct MinIO service account, creates a dated snapshot, writes counts/bytes/checksum summary, and removes no remote generation outside the retention job.

Keep a second owner-controlled copy of each rclone crypt password/salt and recovery token outside the VPS, under the same recovery policy as the database cipher material.

**Step 3: Schedule and restore-test**

Run at least every 15 minutes for changed objects, alert on failure/lag, and perform a monthly full restore to a throwaway bucket. Compare object counts, total bytes, and checksums where object metadata permits.

**Step 4: Commit**

```bash
git add backup/rclone scripts/backup systemd tests/backup
git commit -m "backup: encrypt and replicate MinIO objects to R2"
```

## Task 6: Deploy the four stacks, starting with staging

**Files:**

- Create: `scripts/deploy/supabase.sh`
- Create: `scripts/health/supabase.sh`
- Create: `tests/health/supabase.bats`
- Modify generated: `stacks/*/volumes/functions/`
- Generate: `evidence/platform/deployments/`

**Step 1: Validate source PostgreSQL compatibility**

Compare each managed project's version/extensions from Plan 01 to the target image. The official `supabase db dump` cross-version path is acceptable only after every required extension exists at a compatible version. Block deployment/restore if an extension is absent, preload library differs, or source is newer in a way the official restore guide cannot support.

**Step 2: Copy Functions by exact baseline**

Site has no repository Functions unless inventory proves otherwise. Axis receives exactly the 17 baseline directories plus `_shared` into both Axis stack `volumes/functions` directories. Generate a manifest of file hashes and fail if count/name/hash differs from the detached Axis worktree.

Because self-hosted Edge Runtime has a stack-wide `FUNCTIONS_VERIFY_JWT`, set it according to compatibility tests, then enforce authorization inside every Function. The test matrix must prove all Functions except deliberately public `secure-login`, `send-password-reset`, and HMAC-protected `receive-lead` reject missing/invalid credentials. Public Functions must pass Turnstile/HMAC plus origin and rate-limit tests.

**Step 3: Start only staging first**

```bash
sudo ./scripts/deploy/supabase.sh site-staging
sudo ./scripts/deploy/supabase.sh axis-staging
./scripts/health/supabase.sh site-staging
./scripts/health/supabase.sh axis-staging
```

Health tests cover Auth, REST with RLS, Realtime WebSocket, Storage public/private behavior, image transform, Functions, gateway allowlist, Studio denial on public gateway, Access denial/allow on Studio hostname, and direct port exposure.

**Step 4: Start empty production stacks only after staging passes**

Production starts with no managed data and stays unavailable from final public API hostnames until application rehearsals. Initialize pgBackRest stanzas and create a baseline backup. Confirm every container image digest matches the image lock.

**Step 5: Commit evidence**

```bash
git add scripts/deploy scripts/health tests/health evidence/platform
git commit -m "infra: deploy isolated Supabase staging and production stacks"
```

## Task 7: Add metrics, centralized logs, health checks, and alerts

**Files:**

- Create: `observability/compose.yml`
- Create: `observability/prometheus/prometheus.yml`
- Create: `observability/prometheus/rules/*.yml`
- Create: `observability/loki/config.yml`
- Create: `observability/grafana/provisioning/`
- Create: `observability/alloy/config.alloy`
- Create: `scripts/observability/test-alerts.sh`
- Test: `tests/observability/rules.bats`

**Step 1: Test alert rules before deploy**

Use `promtool test rules` fixtures for disk/inode exhaustion, container down/restart/OOM, Postgres availability/connections/deadlocks/WAL/long transactions, backup age/failure, object-sync lag, Supabase components, HTTP error/latency, certificate expiry, Tunnel disconnect, Mailcow queue, and total-host outage.

**Step 2: Deploy pinned services**

Use the versions in the Tech Stack and store exact image digests. Bind Grafana/Prometheus/Loki privately and publish Grafana only through Tunnel + Access if needed. Alloy collects Docker/application logs, removes authorization/cookie/API-key fields, and applies finite retention. PostgreSQL exporter uses a unique read-only metrics role per database.

**Step 3: Configure Uptime Kuma and one external monitor**

Internal Kuma monitors component health. A monitor outside the VPS checks public site/app/API health and mail/Tunnel reachability so total host loss is detectable. Record the selected provider/account in `state/observability/external-monitor.json`; credentials remain outside Git.

**Step 4: Fire synthetic failures in staging only**

Stop a disposable service, block a test backup, fill a loop-mounted test filesystem, and inject HTTP failures. Verify alert and recovery delivery. Never fill production disk or stop production Mailcow.

**Step 5: Commit**

```bash
git add observability scripts/observability tests/observability state/observability evidence/observability
git commit -m "infra: monitor Supabase applications and backups"
```

## Task 8: Prove clean-room restore and close the platform gate

**Files:**

- Create: `scripts/restore/clean-room.sh`
- Create: `scripts/restore/verify-clean-room.sh`
- Create: `docs/runbooks/restore.md`
- Test: `tests/restore/clean-room.bats`
- Generate: `evidence/platform/restore/site.md`
- Generate: `evidence/platform/restore/axis.md`

**Step 1: Restore without original volumes**

For each product, create a unique throwaway Compose project/network/volumes, restore Postgres from encrypted R2 using only documented disaster-recovery secrets, restore objects into a fresh bucket, point disposable services to them, and run the full Supabase health suite.

**Step 2: Measure RPO/RTO**

Requirements: recoverable point at most 15 minutes behind test failure; complete recovery/verification within four hours; no dependence on original DB/MinIO volumes; isolation still passes.

**Step 3: Destroy only exact throwaway resources**

Validate Compose prefix `restore-test-`, list exact volumes/buckets to evidence, request local confirmation, and remove only those. Never compute a broad deletion path or use wildcards.

**Step 4: Advance the gate**

```bash
./scripts/state/advance.sh PLATFORM_STAGING_READY evidence/gates/platform-staging-ready.md
git add scripts/restore docs/runbooks tests/restore evidence/platform evidence/gates state/program.json
git commit -m "infra: prove isolated R2 disaster recovery"
```

Expected: both restore reports PASS, RPO/RTO meet targets, and state is `PLATFORM_STAGING_READY`.

## External references

- [Supabase self-hosting with Docker](https://supabase.com/docs/guides/self-hosting/docker)
- [Supabase self-hosting differences](https://supabase.com/docs/guides/self-hosting)
- [Supabase S3 backend](https://supabase.com/docs/guides/self-hosting/self-hosted-s3)
- [Self-hosted Edge Functions](https://supabase.com/docs/guides/self-hosting/self-hosted-functions)
- [Restore a managed project](https://supabase.com/docs/guides/self-hosting/restore-from-platform)
