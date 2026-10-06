# Staza app Docker deployment

This guide covers only the app and its PostgreSQL database. The landing page
deployment is separate. DEV and PROD are separate Compose projects and share
only the existing reverse-proxy network and configurable image base.

## Repository and server files

Versioned Compose files and non-secret environment templates:

- `ops/app/docker-compose.dev.yml`
- `ops/app/docker-compose.prod.yml`
- `ops/app/dev.env.example`
- `ops/app/prod.env.example`

Copy the matching Compose file to the VPS as
`/opt/staza/dev/docker-compose.yml` or `/opt/staza/prod/docker-compose.yml`.
Create the real environment files separately at `/opt/staza/dev/.env` and
`/opt/staza/prod/.env`. Updating the Compose file must not overwrite either
server-side `.env`.

Before starting either project, the shared external Docker network
`staza-proxy` must exist. Only the app joins that network; PostgreSQL is on its
environment's private internal network and publishes no host port.

## Caddy and service names

The checked-in `proxy/Caddyfile` expects these Docker upstreams:

| Hostname | Upstream |
| --- | --- |
| `https://play.staza.world` | `staza-prod-app:3000` |
| `https://dev.play.staza.world` | `staza-dev-app:3000` |

The VPS Caddy instance must be attached to `staza-proxy` and use equivalent
targets. The Compose app container names and network aliases match these
upstreams.

## Environment configuration

Start with the corresponding `*.env.example` and use unique values for each
environment. Required variables:

| Variable | Purpose |
| --- | --- |
| `STAZA_IMAGE` | `ghcr.io/tomislaveric/staza`. |
| `STAZA_IMAGE_TAG` | DEV immutable `sha-<commit>` tag or PROD bare semantic version such as `1.0.0`. |
| `POSTGRES_DB` | Environment-specific database name. |
| `POSTGRES_USER` | Environment-specific database user. |
| `POSTGRES_PASSWORD` | Environment-specific database password. |
| `DATABASE_URL` | App connection URL; use host `postgres`, port `5432`, and URL-encode reserved password characters. |
| `WEBAUTHN_RP_ID` | Public hostname for the environment. |
| `WEBAUTHN_RP_NAME` | WebAuthn relying-party display name. |
| `WEBAUTHN_ORIGIN` | Exact HTTPS origin for the environment. |
| `SMTP_HOST` | Hostname of the existing mail server used to send auth codes. |
| `SMTP_PORT` | SMTP submission port (587 for STARTTLS, 465 for implicit TLS). |
| `SMTP_SECURE` | `true` for implicit TLS (465) or `false` for STARTTLS (587). |
| `SMTP_USER` | Mailbox/username that authenticates to the mail server. |
| `SMTP_PASSWORD` | Raw password for `SMTP_USER`. Avoid if it contains `"`, `'`, `#`, or `$` (parser-unsafe). |
| `SMTP_PASSWORD_BASE64` | Base64 of the password; preferred for passwords with special characters. Takes precedence over `SMTP_PASSWORD`. Generate with `printf '%s' 'the#pass' \| base64`. |
| `MAIL_FROM` | Sender address for outgoing mail, e.g. `auth@staza.world`. |

Compose sets `NODE_ENV=production`, `PORT=3000`, `DATA_DIR=/data/jobs`, and
`MEDIA_DIR=/data/media`. The app container uses an environment-specific named
volume for `/data`; PostgreSQL uses a different named volume for its data
directory. Never reuse database credentials or `DATABASE_URL` between DEV and
PROD.

The VPS must already be authenticated to GHCR if the package is private. The
deployment workflows rely on that existing Docker credential storage and do
not copy a registry token to the server.

## Automated deployment

The app image is built by `.github/workflows/build-app-image.yml`, a reusable
workflow called by the separate DEV and PROD deployment workflows:

- `.github/workflows/deploy-app-dev.yml` builds and deploys after pushes to
  `main`, and supports manual dispatch. It deploys the exact
  `sha-${GITHUB_SHA}` image; `main` is also published as a convenience tag for
  main-branch builds, but deployment never relies on that mutable tag.
- `.github/workflows/deploy-app-prod.yml` runs only for a published GitHub
  Release whose tag matches `staza-X.Y.Z`. It builds and deploys the exact
  bare version tag (for example, `staza-1.0.0` produces
  `ghcr.io/tomislaveric/staza:1.0.0`). It does not publish or deploy PROD as
  `latest`.

The deployment jobs use GitHub Environments `app-dev` and `app-prod`.
Configure each with secrets `SSH_HOST`, `SSH_USER`, and `SSH_PRIVATE_KEY`, and
variables `REMOTE_PATH` and `PUBLIC_URL`. Set DEV to
`/opt/staza/dev` and `https://dev.play.staza.world`; set PROD to
`/opt/staza/prod` and `https://play.staza.world`. `SSH_PORT` is optional and
defaults to 22. Do not put host or user values in workflow source.

The runner pulls the exact image before connecting to the VPS. It stages only
the matching versioned Compose file, checks the server directory and required
`.env` values, and validates the staged Compose config. It then atomically
updates only `STAZA_IMAGE_TAG` in the server `.env`; all other server values
remain authoritative. It never copies an env file from the repository. SSH
uses the environment private key, a temporary `known_hosts` file populated by
`ssh-keyscan`, and `StrictHostKeyChecking=yes`.

After deployment, the workflow waits for Docker health and checks the public
HTTPS endpoint with bounded retries. Failures fail the workflow and include
container diagnostics. DEV deployments use concurrency group `app-dev` and
cancel older in-progress deployments; PROD uses `app-prod` and does not cancel
an active release deployment.

## Manual OSM/Wikidata collectible import

`.github/workflows/import-osm-wikidata.yml` is a manual `workflow_dispatch`
workflow that runs the collectible importer on one server. Inputs:

| Input | Meaning |
| --- | --- |
| `target` | `dev` or `prod`; selects the `app-dev` or `app-prod` GitHub environment. |
| `dry_run` | Defaults to `true`. Reports a plan and writes nothing to PostgreSQL. |

The job reuses the environment secrets `SSH_HOST`, `SSH_USER`,
`SSH_PRIVATE_KEY` and variables `REMOTE_PATH` and `SSH_PORT` that the
deployment workflows already require. No database credential is configured in
GitHub: `scripts/import-osm-wikidata.sh` connects over SSH and starts a one-off
container with `docker compose run --rm app node
dist/persistence/importOSMWikidata.js`, so Compose supplies `DATABASE_URL`
privately on the server's internal network. GitHub-hosted runners never reach
PostgreSQL. The script fails if `DATABASE_URL` is present in the runner
environment.

The one-off container uses the image tag currently recorded in the server
`.env`, so the updated app image must be deployed to that environment before
its import run can use new importer behavior. The import never pulls, deploys,
recreates, or restarts the app service. PROD environment protection and
approval rules continue to apply.

OSM objects come from the committed `fixtures/osm-germany.json` extract that
ships inside the deployed image, so the run contacts only Wikidata. The job
fails early if the image carries no snapshot. Refreshing the catalog means
regenerating the snapshot locally (`npm run extract:osm-germany`), committing
it, and redeploying the image before running the import.

The Wikidata cache persists under the mounted app-data volume at
`/data/osm-cache/wikidata` (`OSM_WIKIDATA_CACHE_DIR`), so repeated one-off
containers reuse validated entities. Uncached batches are paced
(`WIKIDATA_BATCH_DELAY_MS`, 5000 ms) and transient failures retry up to
`WIKIDATA_MAX_ATTEMPTS` (5) with exponential backoff honoring `Retry-After`.
The workflow log streams timestamped UTC progress lines for each batch, pacing
wait, and retry, so a long-running job can be followed live.

Run a dry run first, read its report, then rerun with `dry_run: false` on DEV
before selecting PROD.

## Manual commands

Run each command for only one environment at a time. For DEV:

```sh
docker compose --env-file /opt/staza/dev/.env \
  -f /opt/staza/dev/docker-compose.yml pull

docker compose --env-file /opt/staza/dev/.env \
  -f /opt/staza/dev/docker-compose.yml run --rm app node dist/persistence/migrate.js

docker compose --env-file /opt/staza/dev/.env \
  -f /opt/staza/dev/docker-compose.yml up -d

docker compose --env-file /opt/staza/dev/.env \
  -f /opt/staza/dev/docker-compose.yml logs -f app postgres

docker compose --env-file /opt/staza/dev/.env \
  -f /opt/staza/dev/docker-compose.yml restart app

docker compose --env-file /opt/staza/dev/.env \
  -f /opt/staza/dev/docker-compose.yml stop
```

For PROD, use the same commands with `/opt/staza/prod/.env` and
`/opt/staza/prod/docker-compose.yml`. `up -d` starts or recreates services;
`stop` stops that environment and `restart app` restarts only its app. `down`
also stops and removes that project's containers and networks but leaves
named volumes. Do not use `down -v` unless intentionally deleting that
environment's persistent data.

The app startup also applies pending database migrations. The automated
deployment runs the compiled one-off command after pulling and before
recreating the app; startup then runs the ledger-backed migration runner again,
which is a no-op when the explicit command succeeded. Migrations run in a
transaction, and a failed explicit migration stops deployment before app
recreation. The runtime image does not include `tsx`, so `npm run migrate` is
not the container command.

## Manual rollback

Deployment logs record the previous and attempted image tags. If manual
recovery is needed, change only `STAZA_IMAGE_TAG` in the relevant server `.env`
back to the previous tag, then pull and recreate that environment:

```sh
docker compose --env-file /opt/staza/dev/.env \
  -f /opt/staza/dev/docker-compose.yml pull
docker compose --env-file /opt/staza/dev/.env \
  -f /opt/staza/dev/docker-compose.yml up -d
```

For PROD, substitute `/opt/staza/prod`. There is no automatic image or
database rollback; do not reverse migrations or remove named volumes as part
of application rollback.

## Isolation and health

DEV and PROD have separate Compose projects, private app/database networks,
PostgreSQL containers, credentials, PostgreSQL volumes, and app-data volumes
for jobs and uploaded/processed media. They share only the external
`staza-proxy` network and may use the same image with different tags.

PostgreSQL health uses `pg_isready`; app health checks the existing `/` route
using Node's built-in HTTP client. No new health endpoint is introduced.
Services use `restart: unless-stopped`; no CPU or memory limits are set.
