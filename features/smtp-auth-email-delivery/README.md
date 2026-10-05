# SMTP auth email delivery

## Goal
Deliver authentication codes and security notifications by real email in production via
SMTP, replacing the development-only `EmailSender` stub that logs codes to the console and
throws in production. The app runs on a VPS while the domain and mailboxes live on a
separate mail server, so the app acts as an SMTP client (nodemailer) against that existing
server rather than hosting its own mail server.

## Scope
In scope:
- Add `nodemailer` as an SMTP client.
- Upgrade `EmailSender` (`src/auth.ts`) to send real email for both
  `sendAuthenticationCode` and `sendSecurityNotification` when SMTP is configured.
- Add SMTP configuration to `src/config.ts` with production validation.
- Wire configuration into `new EmailSender(...)` in `src/server.ts`.
- Update ops environment: `ops/app/docker-compose.prod.yml` and `prod.env.example`
  (and the dev example for parity).
- Add a mock-transport unit test and verify build + existing suite.

Out of scope:
- Hosting a mail server, inbound mail, DKIM/SPF/DMARC DNS record creation (operational
  guidance only).
- Rich HTML email templating beyond a simple, clear message.
- Changes to `AuthService` behavior or public method signatures of `EmailSender`.

## Decisions
- Delivery mechanism: **nodemailer + SMTP** against the existing mail server
  (user-confirmed), not a transactional email API.
- Sender address: `auth@staza.world` (user-confirmed).
- `sendSecurityNotification` is implemented to send real email (user-confirmed).
- Behavior by environment:
  - SMTP configured → send real email.
  - Non-production without SMTP → keep `console.info` development behavior.
  - Production without SMTP → keep failing fast (throw at use), and additionally
    validate required SMTP settings at boot in the existing production guard.
- Defaults: `SMTP_PORT=587`, `SMTP_SECURE=false` (STARTTLS); set `SMTP_SECURE=true` for
  implicit TLS on 465.
- Secrets live only in the server-side `.env`, never in the repo or image.

## Implementation plan
1. Add `nodemailer` and `@types/nodemailer` to `package.json`.
2. Extend `src/config.ts` with `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
   `SMTP_PASSWORD` (or `SMTP_PASSWORD_BASE64`), and `MAIL_FROM`. In the existing
   `NODE_ENV === "production"` guard, require SMTP host/user/password and `MAIL_FROM`
   so misconfiguration fails at boot. `SMTP_PASSWORD_BASE64` is decoded and takes
   precedence over `SMTP_PASSWORD`, so passwords containing quotes, `#`, or `$`
   survive Node `.env` and Docker Compose parsing.
3. Upgrade `EmailSender` in `src/auth.ts` to accept optional SMTP settings and build a
   nodemailer transport. Implement real sending for `sendAuthenticationCode` (6-digit
   code, 10-minute expiry note) and `sendSecurityNotification`. Preserve dev console
   behavior and production fail-fast when SMTP is absent. Keep method signatures.
4. Pass SMTP config into `new EmailSender(...)` in `src/server.ts`.
5. Update `ops/app/docker-compose.prod.yml` `environment:` and add placeholders to
   `ops/app/prod.env.example` (and `dev.env.example` for parity).
6. Add a unit test using a mock/stub transport to confirm a configured sender formats and
   dispatches the message without a live SMTP server; run `tsc` and vitest.

## Acceptance criteria
- In production with valid SMTP env, requesting an auth code sends a real email from
  `auth@staza.world` containing the 6-digit code; security notifications are emailed too.
- Missing required SMTP settings in production cause a clear boot-time failure.
- Development without SMTP retains the existing console-logging behavior.
- `AuthService` and `EmailSender` public method signatures are unchanged.
- TypeScript build passes and the existing test suite remains green.

## Validation
- `npx tsc --noEmit` (or project build script) passes.
- `vitest` suite passes, including the new mock-transport test.
- Manual/operational check against the real mail server after deployment.

## Operational notes (VPS)
- Required from the mail provider/server: SMTP host, port (587 STARTTLS or 465 TLS),
  mailbox username, and password/app password; sender `auth@staza.world`.
- Configure DNS **SPF** (ideally **DKIM**/**DMARC**) authorizing this mailbox/server to
  send as `staza.world` to avoid spam filtering or rejection.
- Ensure the VPS/container is allowed outbound to the SMTP host on 587/465. Port 25 is
  not required since an authenticated submission port is used.
