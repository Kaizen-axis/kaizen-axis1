# Axis Turnstile 300030 Repair Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Do not re-enable CAPTCHA in production until this plan's Preview matrix passes.

**Goal:** Find why Cloudflare Turnstile returns client error `300030` for Axis users and re-enable server-validated CAPTCHA without taking login down again.

**Architecture:** Keep production on the login break-glass (`LOGIN_REQUIRE_CAPTCHA=false` / `VITE_LOGIN_REQUIRE_CAPTCHA=false`) until an isolated Preview proves a token on Chrome, Edge, Edge InPrivate and Safari mobile. Diagnosis uses `public/turnstile-diagnostic.html`, which loads Turnstile without the Axis bundle or service worker.

**Tech Stack:** Cloudflare Turnstile, Vite static `public/` page, Vercel Preview, existing `secure-login` Siteverify path.

---

## Safety

- Do not alias this branch to `kaizen-axis.space` or `www.kaizen-axis.space`.
- Do not delete `TURNSTILE_SECRET_KEY` or `TURNSTILE_HOSTNAMES`.
- Do not set `LOGIN_REQUIRE_CAPTCHA=true` in hosted Supabase until Preview acceptance passes.
- Do not merge a Turnstile re-enable into production from `main` while `main` still lacks the break-glass flag.
- Production rollback remains `dpl_DPudFscaojnvaymCuvfP8sJpjgX9` only for the previous widget-required UI; the current restored login is `dpl_4gThFp8BuzZGpM6CQeozmwFhekTh`.

## Confirmed facts

- Error `300030` is a Cloudflare client execution crash before Siteverify.
- Production login sitekey in the restored bundle is `0x4AAAAAADOmmf-tlgTOstXw` (widget Kaizen-axis).
- A later managed widget `0x4AAAAAAEjcC8jM74vJaB7u` was used in a failed recovery and must not be treated as the live login identity.
- The previous diagnostic page pointed at the managed widget, not the live login sitekey. This branch corrects that.

## Decision matrix

| Test widget | Live Kaizen-axis widget | Conclusion | Next step |
|---|---|---|---|
| Fails | Fails | Desktop/browser/network challenge runtime | Keep break-glass; capture exact code, Edge vs Chrome, network |
| Passes | Fails | Cloudflare widget configuration/domain/reputation | Recreate/repair Kaizen-axis widget; retest Preview |
| Passes | Passes | Axis `Login.tsx` lifecycle | Fix widget mount/unmount, then Preview with CAPTCHA required |
| Fails | Passes | Diagnostic page bug | Fix diagnostic; do not touch production CAPTCHA |

## Tasks

1. Point `public/turnstile-diagnostic.html` at the official always-pass test sitekey and the live Kaizen-axis sitekey.
2. Deploy this branch to Vercel Preview only.
3. Open `/turnstile-diagnostic.html` (not `/login`) on Chrome, Edge, Edge InPrivate and Safari mobile.
4. Record the matrix in `evidence/incidents/2026-09-01-axis-turnstile-300030/`.
5. Only after a passing matrix, re-enable CAPTCHA on a Preview build (`VITE_LOGIN_REQUIRE_CAPTCHA` absent/`true`) and prove token + Siteverify + replay rejection.
6. Only then set `LOGIN_REQUIRE_CAPTCHA=true` (or remove the secret) and promote.

## Current production break-glass (do not undo)

- Frontend: `VITE_LOGIN_REQUIRE_CAPTCHA=false`
- Backend: `LOGIN_REQUIRE_CAPTCHA=false`
- Reset: still CAPTCHA-protected; UI shows unavailable
- Signup: `disable_signup=true`
