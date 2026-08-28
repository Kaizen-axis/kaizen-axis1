# ImobKaizen Cloudflare, Mailcow, and Resend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Make Cloudflare authoritative for `imobkaizen.com.br` without changing the live application origin, add `imobkaizen.com.br` safely to the existing Mailcow, verify `notify.imobkaizen.com.br` in Resend, and prepare the Tunnel and edge controls needed by the later application cutovers.

**Architecture:** DNS migration is separated from hosting migration. The Cloudflare zone first reproduces the current HostGator zone and keeps Vercel live. Mailcow remains a single instance with canonical SMTP identity/PTR `mail.hokmatech.com`; the new domain uses that server as MX, while `mail.imobkaizen.com.br` is an optional DNS-only client alias covered by the Mailcow certificate. Resend uses a dedicated subdomain so its SPF/return-path does not conflict with Mailcow at the apex. Only HTTP interfaces use Tunnel.

**Tech Stack:** Cloudflare DNS/Tunnel/Access/WAF/Rules API, `cloudflared`, Terraform or API-managed JSON, BIND zone files, DNSSEC, Mailcow, Certbot DNS-01, Resend API, OpenSSL, dig, curl, swaks, testssl.sh.

---

## Task 1: Model and test the desired DNS zone

**Files:**

- Create: `cloudflare/zone/records.schema.json`
- Create: `scripts/dns/export-current.sh`
- Create: `scripts/dns/normalize.py`
- Create: `scripts/dns/diff.py`
- Test: `tests/dns/diff.bats`
- Generate: `state/dns/current-hostgator.json`
- Generate: `state/dns/desired-prehosting.json`

**Step 1: Write failing DNS-diff tests**

Fixtures must prove the diff blocks:

- missing apex/`www` records;
- lost MX, SPF, DKIM, DMARC, CAA, SRV, TXT verification, `autodiscover`, or `autoconfig` records;
- accidental proxying of MX targets, mail hosts, Resend records, or verification CNAMEs;
- CNAME flattening/normalization differences that are semantically equivalent;
- a changed Vercel destination during the nameserver-only phase.

**Step 2: Export all current records**

Prefer a complete HostGator/registrar zone export. Supplement it with authoritative queries for every name from the export and certificate-transparency/passive-DNS names found during inventory. Cloudflare quick scan is evidence only and may not be treated as complete.

```bash
./scripts/dns/export-current.sh imobkaizen.com.br state/dns/current-hostgator.json
python3 scripts/dns/normalize.py state/dns/current-hostgator.json state/dns/current-hostgator.normalized.json
```

**Step 3: Produce desired pre-hosting state**

It must preserve the current Vercel apex and `www` destinations exactly. Add no application cutover records yet. Email additions are applied only after Task 4 produces provider-derived values.

**Step 4: Run semantic diff**

```bash
python3 scripts/dns/diff.py \
  state/dns/current-hostgator.normalized.json \
  state/dns/desired-prehosting.json
```

Expected: `SAFE_TO_DELEGATE`; any unexplained deletion is a hard failure.

**Step 5: Commit**

```bash
git add cloudflare/zone scripts/dns tests/dns state/dns
git commit -m "cloudflare: model lossless DNS migration"
```

## Task 2: Onboard the zone while Vercel remains production

**Files:**

- Create: `scripts/cloudflare/create-zone.sh`
- Create: `scripts/cloudflare/apply-records.sh`
- Create: `scripts/cloudflare/check-entitlements.sh`
- Test: `tests/cloudflare/apply-records.bats`
- Generate: `state/cloudflare/zone.json`
- Generate: `state/cloudflare/entitlements.json`

**Step 1: Test idempotency and scope**

The apply script must update only `imobkaizen.com.br`, refuse a Cloudflare account mismatch, preserve provider-generated verification records, and never enable proxy on a record classified `mail`, `smtp`, `imap`, `mx-target`, `resend`, `acme`, or `verification`.

**Step 2: Create/import the zone**

Use a short-lived API token scoped to this account and zone. Store the token only in the operator environment. `create-zone.sh` records the zone/account IDs and assigned nameservers, not the token. Apply the normalized desired records and query them back through Cloudflare and the assigned authoritative nameservers.

**Step 3: Discover plan entitlements**

`check-entitlements.sh` records whether the zone can use managed WAF rules, custom rules, rate-limiting rules, bot controls, Access, Logpush, Advanced Certificates/Total TLS, and Cache Rules. A missing paid feature is recorded as `NOT_ENTITLED`; scripts must not falsely report it enabled. Nginx/application rate limits remain mandatory compensating controls.

**Step 4: Prepare delegation**

At least 24 hours before nameserver change, reduce relevant HostGator TTLs to 300 seconds where the provider permits. Confirm whether DNSSEC is active. If active, remove the old DS/DNSSEC configuration before changing nameservers, as required by Cloudflare full-zone onboarding.

**Step 5: Commit**

```bash
git add scripts/cloudflare tests/cloudflare state/cloudflare
git commit -m "cloudflare: onboard imobkaizen zone without origin change"
```

## Task 3: Change authoritative nameservers with an external availability watch

**Files:**

- Create: `scripts/dns/watch-delegation.sh`
- Create: `scripts/health/prehosting.sh`
- Create: `evidence/runbooks/dns-delegation.md`
- Generate: `evidence/dns/delegation/`

**Step 1: Start monitors before mutation**

Monitor from outside the VPS:

- `https://imobkaizen.com.br/` and a known property detail route;
- `https://www.imobkaizen.com.br/` redirect behavior;
- current MX resolution and SMTP greeting for `hokmatech.com`;
- authoritative SOA/NS and DNSSEC state;
- the Vercel deployment URL as a control.

Poll every 30 seconds and retain status/latency only, not response bodies containing user data.

**Step 2: Perform the sole manual registrar action**

In the authenticated registrar/HostGator interface, replace the current authoritative nameservers with the exact two nameservers recorded in `state/cloudflare/zone.json`. Do not change apex/`www` hosting records in the same operation.

**Step 3: Observe propagation**

```bash
./scripts/dns/watch-delegation.sh imobkaizen.com.br state/cloudflare/zone.json
./scripts/health/prehosting.sh
```

Expected: Cloudflare reports the zone active; public resolvers return the assigned NS/SOA; the site continues from Vercel; no mail regression. If the site or mail record is missing, restore/correct the record in Cloudflare first. Reverting nameservers is the fallback only when the zone cannot be corrected promptly.

**Step 4: Re-enable DNSSEC after stability**

After all major resolvers use Cloudflare and 24 hours pass without DNS incident, enable DNSSEC in Cloudflare and publish the generated DS through the registrar. Validate with `delv`/DNSViz before marking complete.

**Step 5: Record the gate**

```bash
./scripts/state/advance.sh DNS_ON_CLOUDFLARE evidence/runbooks/dns-delegation.md
git add scripts/dns scripts/health evidence state/program.json
git commit -m "cloudflare: delegate imobkaizen DNS with Vercel live"
```

## Task 4: Add the Mailcow domain without changing its canonical identity

**Files:**

- Create: `mail/mailcow/domain.json`
- Create: `mail/mailcow/dns-records.json`
- Create: `scripts/mailcow/preflight.sh`
- Create: `scripts/mailcow/add-domain.sh`
- Create: `scripts/mailcow/install-certificate.sh`
- Test: `tests/mailcow/domain.bats`
- Generate, owner-approved: `state/mailbox-plan.json`

**Step 1: Back up and test rollback first**

Run the Mailcow version-matched backup helper for configuration and mail data, hash the archive, copy it to the existing external backup destination, and verify the archive can be listed/decrypted. Export current domains, aliases, DKIM settings, certificate fingerprint, and `mailcow.conf` settings with secrets redacted.

**Step 2: Write tests against the Mailcow API fixture**

The script must:

- refuse to change `MAILCOW_HOSTNAME=mail.hokmatech.com`;
- be idempotent when `imobkaizen.com.br` already exists;
- add no mailbox unless its address and target are present in an owner-approved `state/mailbox-plan.json`;
- generate a unique DKIM key for the new domain;
- preserve the current `hokmatech.com` domain and DKIM;
- verify domain limits/quotas before creating anything.

`state/mailbox-plan.json` has an exact structure:

```json
{
  "domain": "imobkaizen.com.br",
  "mailboxes": [],
  "aliases": [],
  "approved_at_utc": null,
  "approved_by": null
}
```

The empty default deliberately creates the mail domain only. Populate mailbox or alias entries only after the owner specifies the desired addresses and targets.

**Step 3: Add the domain**

Run the version-aware Mailcow API operation, then query it back. Set conservative initial quota/rate limits based on existing Mailcow policy. Generate DKIM in Mailcow and write only the public TXT value to `mail/mailcow/dns-records.json`.

**Step 4: Publish Mailcow DNS**

Apply these semantics, with live IP/DKIM values sourced from inventory:

| Name | Type | Destination/purpose | Proxy |
|---|---|---|---|
| `mail.imobkaizen.com.br` | A/AAAA | current Mailcow public IP(s) | DNS-only |
| `imobkaizen.com.br` | MX 10 | `mail.hokmatech.com.` | DNS-only |
| `autodiscover.imobkaizen.com.br` | CNAME | `mail.hokmatech.com.` | DNS-only |
| `autoconfig.imobkaizen.com.br` | CNAME | `mail.hokmatech.com.` | DNS-only |
| `imobkaizen.com.br` | TXT | `v=spf1 mx -all` after outbound validation | DNS-only |
| Mailcow selector | TXT | public DKIM generated by Mailcow | DNS-only |
| `_dmarc.imobkaizen.com.br` | TXT | `p=none` with a working, owner-approved aggregate-report address | DNS-only |

Do not put Resend into the apex SPF. Resend authenticates the separate `notify` subdomain.

**Step 5: Install a two-name Mailcow certificate using DNS-01**

Use a Cloudflare DNS token restricted to `_acme-challenge`-capable edits for `hokmatech.com` and `imobkaizen.com.br`. Set `SKIP_LETS_ENCRYPT=y` only after the replacement certificate is already issued. The certificate must contain:

```text
mail.hokmatech.com
mail.imobkaizen.com.br
```

Copy `fullchain.pem` and `privkey.pem` atomically to `/opt/mailcow-dockerized/data/assets/ssl/cert.pem` and `key.pem`, set secure modes, restart only `postfix-mailcow`, `dovecot-mailcow`, and `nginx-mailcow`, and verify the new fingerprint before removing the previous files. Configure a systemd timer to renew and run the same tested post-hook.

Set `ADDITIONAL_SERVER_NAMES=webmail.imobkaizen.com.br,mail.imobkaizen.com.br` for correct Mailcow UI host handling, apply with `docker compose up -d`, and confirm the canonical hostname remains unchanged.

**Step 6: Test mail independently from webmail**

Use OpenSSL/swaks to validate SMTP 25, submission 587/465, IMAP 993, STARTTLS, SAN, hostname, PTR, HELO, inbound receipt, outbound receipt, SPF, DKIM, and DMARC. Run Mailcow's DNS check. `mail.hokmatech.com` and `mail.imobkaizen.com.br` must present the same valid certificate, while HELO/PTR remains `mail.hokmatech.com`.

**Step 7: Commit non-secret desired state and evidence**

```bash
git add mail/mailcow scripts/mailcow tests/mailcow state/mailbox-plan.json evidence/mail
git commit -m "mail: add imobkaizen domain to existing Mailcow"
```

## Task 5: Verify the transactional Resend subdomain

**Files:**

- Create: `resend/domain.json`
- Create: `scripts/resend/ensure-domain.sh`
- Create: `scripts/resend/test-delivery.sh`
- Test: `tests/resend/domain.bats`
- Generate: `state/resend/domain.json`

**Step 1: Create exactly `notify.imobkaizen.com.br`**

Call Resend using a short-lived operator key, request domain creation only if it does not exist, and save the returned record names/types and verification status with secret values redacted. Configure the provider-generated return-path under the transactional subdomain.

**Step 2: Apply provider-generated DNS records exactly**

Publish the SPF/MX return-path and DKIM records returned by Resend as DNS-only. Do not synthesize or merge their values. Add a DMARC record for `_dmarc.notify.imobkaizen.com.br` starting at `p=none` if Resend does not supply one.

**Step 3: Verify and configure senders**

Wait until Resend reports `verified`. Define:

- Auth sender: `no-reply@notify.imobkaizen.com.br`
- Application sender: `Kaizen Axis <no-reply@notify.imobkaizen.com.br>`
- Reply-To: an actual Mailcow address selected in `state/mailbox-plan.json`

Disable open and link tracking for password reset, invitations, confirmation, and other authentication messages.

**Step 4: Test delivery**

Send unique non-sensitive messages to at least Gmail, Outlook, and a Mailcow mailbox. Record Resend event IDs and header authentication results, not message bodies or recipient addresses. All must show aligned DKIM/SPF; authentication links must remain unmodified.

**Step 5: Commit**

```bash
git add resend scripts/resend tests/resend state/resend evidence/mail
git commit -m "mail: verify isolated Resend transactional domain"
```

## Task 6: Deploy the outbound-only Tunnel and hostname routing skeleton

**Files:**

- Create: `cloudflare/tunnel/config.yml`
- Create: `cloudflare/tunnel/docker-compose.yml`
- Create: `scripts/cloudflare/ensure-tunnel.sh`
- Create: `scripts/cloudflare/validate-tunnel.sh`
- Test: `tests/cloudflare/tunnel.bats`
- Generate: `state/cloudflare/tunnel.json`

**Step 1: Define routes with closed defaults**

Create one named tunnel `imobkaizen-vps`. The committed config contains service mappings but no credentials. Production application routes remain disabled until their plan gates pass. Initial enabled routes are:

```yaml
ingress:
  - hostname: webmail.imobkaizen.com.br
    service: http://127.0.0.1:8180
  - service: http_status:404
```

Later plans add site/app/API/Studio routes. Run `cloudflared tunnel ingress validate` in CI. Store the remotely managed tunnel token only at `/etc/imobkaizen/secrets/cloudflared.env`.

**Step 2: Deploy with least privilege**

Run a pinned `cloudflare/cloudflared` image as an unprivileged container with read-only filesystem, dropped capabilities, `no-new-privileges`, restart policy, and host networking only because all origins bind to loopback. Do not mount Docker socket or application secrets.

**Step 3: Route webmail and validate**

Create the proxied Tunnel CNAME for `webmail.imobkaizen.com.br`, verify Mailcow login/assets/API, and confirm SMTP/IMAP DNS records remain DNS-only and bypass Tunnel. Add a narrow WAF rule for obvious exploit signatures without challenging the login POST.

**Step 4: Commit**

```bash
git add cloudflare/tunnel scripts/cloudflare tests/cloudflare state/cloudflare evidence/cloudflare
git commit -m "cloudflare: deploy outbound-only ImobKaizen tunnel"
```

## Task 7: Define edge security and caching policy before applications arrive

**Files:**

- Create: `cloudflare/rules/cache.json`
- Create: `cloudflare/rules/waf.json`
- Create: `cloudflare/rules/rate-limits.json`
- Create: `cloudflare/access/applications.json`
- Create: `scripts/cloudflare/apply-security.sh`
- Create: `scripts/cloudflare/test-security.sh`
- Test: `tests/cloudflare/security.bats`

**Step 1: Encode cache bypass first**

Bypass cache for:

- `api-site.imobkaizen.com.br/*` and `api-app.imobkaizen.com.br/*`;
- `app.imobkaizen.com.br/api/*`;
- site `/login`, `/admin*`, requests with Supabase auth cookies, and any response with `Set-Cookie`;
- all non-GET/HEAD requests.

Only immutable hashed frontend assets receive long edge TTLs. HTML remains revalidated/dynamic until application-specific tests prove otherwise.

**Step 2: Encode Access applications**

Create separate Access apps for `studio-site`, `studio-app`, Coolify, and any added infrastructure panel. Permit only explicit administrator email identities with MFA. There is no broad bypass. Machine probes use a separately rotated Service Token limited to `/health` when needed.

**Step 3: Encode prioritized WAF/rate limits**

Rules must cover login/token/recovery, `secure-login`, `send-password-reset`, `receive-lead`, `/api/apuracao`, and generic high-error clients. Start in log/simulate mode where available, review at least 24 hours, then enable blocking. Exempt only verified internal service-token requests, never whole IP ranges without evidence.

Apply all features present in `state/cloudflare/entitlements.json`. For unavailable rules, record `NOT_ENTITLED` and the equivalent Nginx/application control. Do not claim a Cloudflare feature is active when the subscription does not expose it.

**Step 4: Leave HSTS off**

Always HTTPS may be enabled after origin validation, but HSTS and preload remain off until every final/subdomain certificate and application route passes the last cutover plan.

**Step 5: Record email gate**

```bash
./scripts/cloudflare/test-security.sh --pre-application
./scripts/state/advance.sh EMAIL_VALIDATED evidence/gates/email-validated.md
git add cloudflare scripts/cloudflare tests/cloudflare evidence/gates state/program.json
git commit -m "cloudflare: define edge security and approve email gate"
```

## External references

- [Cloudflare full DNS setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
- [Cloudflare DNS quick-scan limitations](https://developers.cloudflare.com/dns/zone-setups/reference/dns-quick-scan/)
- [Cloudflare Tunnel published applications](https://developers.cloudflare.com/tunnel/routing/)
- [Cloudflare Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
- [Mailcow DNS setup](https://docs.mailcow.email/getstarted/prerequisite-dns/)
- [Mailcow additional server names](https://docs.mailcow.email/post_installation/reverse-proxy/r_p/)
- [Mailcow custom/advanced SSL](https://docs.mailcow.email/firststeps-ssl/)
- [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction)
