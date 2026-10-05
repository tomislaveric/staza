# extend-osm-wikidata-collectibles

## Goal

Extend the existing Germany OSM/Wikidata collectible importer with named
places, resilient upstream requests, and a manually dispatched DEV/PROD import
workflow. Preserve the current viewpoint, peak, castle, and waterfall
cataloging behavior.

## Scope

- Add named OSM `place=square` and `place=quarter` objects, plus named
  `tourism=attraction` objects even when they do not carry a `place` tag.
- Represent place-only imports as the new `place` primary category. Existing
  categories take precedence when an OSM object matches both an existing
  category and the new place selectors.
- Keep the existing Germany coverage, canonical catalog, source identity,
  Wikidata enrichment, scoring, deduplication, and attribution approach.
- Retry transient Overpass and Wikidata request failures, pace uncached
  requests, reuse caches, and continue reporting failures without allowing an
  incomplete OSM snapshot to update the catalog.
- Add one manual GitHub Actions workflow with a DEV/PROD selector. The workflow
  runs the compiled importer on the selected app server through Docker Compose;
  PostgreSQL remains private and no database URL is placed in GitHub Actions.
- Persist OSM and Wikidata caches on the app data volume for reuse between
  one-off importer containers.
- Do not change the separate quäldich importer, runtime World dependency on
  external services, historical game events, or activity processing.

## Decisions

### Place detection and catalog behavior

- Import `place=square`, `place=quarter`, and `tourism=attraction`.
- Require a meaningful name for each new place candidate. Unnamed records are
  rejected or ignored according to the existing normalization/reporting
  conventions.
- Add `place` as an additive `primary_category` value; keep the gameplay type
  as `landmark`.
- Retain current category precedence for overlapping records and make `place`
  the fallback category for records that do not match an existing category.
- Keep the current automatic-publishing threshold and safety gates. Add
  deterministic, explainable place-specific scoring evidence rather than
  lowering the existing threshold; uncertain candidates remain review-only or
  ignored.
- Retain stable OSM identity, Wikidata/Wikipedia matching, conservative
  deduplication, existing attribution, and no-delete import semantics.

### Retry and pacing behavior

- Wait 5 seconds between uncached Overpass tile requests and uncached Wikidata
  batches.
- Retry transient network errors, timeouts, HTTP 429, HTTP 5xx, and incomplete
  Overpass responses up to 5 attempts, using exponential backoff with jitter
  and honoring `Retry-After`.
- Do not repeatedly retry non-transient HTTP/client or validation errors.
- Continue processing remaining regions/batches after exhausted failures and
  report attempts and errors. Use validated stale cache entries where
  available; retain explicit unresolved/error metadata when Wikidata has no
  usable cache.
- If required OSM coverage remains incomplete, report partial results but
  block database writes and missing-upstream conclusions.
- Keep request delay and retry settings configurable using validated
  environment configuration, with the approved defaults above.

### Manual DEV/PROD workflow

- Add a single `workflow_dispatch` workflow with target selection for DEV or
  PROD, a dry-run input defaulting to true, and an OSM refresh input defaulting
  to false.
- Use the selected `app-dev` or `app-prod` GitHub environment and its existing
  SSH settings to run the importer on that server.
- Run a one-off container using the currently deployed app image and existing
  Compose environment/network. Compose provides `DATABASE_URL` privately to
  the container; GitHub-hosted runners do not connect to PostgreSQL.
- Persist importer cache directories under the existing mounted app-data
  volume. Do not recreate/restart the app service or deploy an image from the
  import workflow.
- The updated app image must be deployed to an environment before that
  environment's manual workflow run can use the new importer behavior. Keep
  existing PROD environment protection/approval rules in effect.

## Implementation plan

1. Extend the domain category and the additive database check constraint for
   `place`. Update the World/map category presentation, labels, and styling so
   place collectibles are distinguishable without changing existing category
   behavior.
2. Add Overpass selectors and retained tags for `place=square`,
   `place=quarter`, and `tourism=attraction`. Normalize named candidates,
   preserve existing category precedence, and define deterministic place
   scoring/reasons that retain current publish thresholds and access gates.
3. Add injectable retry and pacing behavior to Overpass and Wikidata clients.
   Add validated configuration for the approved 5-second delay and five
   attempts, preserving `Retry-After`, backoff, stale-cache fallback,
   incomplete-coverage reporting, and import write gating.
4. Make OSM and Wikidata cache paths configurable and point server imports at
   cache directories under the mounted app-data volume. Keep local defaults
   ignored and avoid committing runtime cache data.
5. Add a manual workflow with the DEV/PROD target, dry-run, and OSM refresh
   inputs. Use environment-bound SSH access and execute the currently deployed
   app image as a one-off Compose container on the private network.
6. Update importer and deployment documentation with the place scope,
   operational behavior, required environment SSH settings, workflow usage,
   private database execution model, cache persistence, and deployment-before-
   import requirement.
7. Add focused fixture-based tests for place detection and precedence, named
   attraction filtering, category display, retry/pacing/backoff behavior,
   `Retry-After`, stale cache, failure reporting, partial-coverage write
   prevention, and workflow configuration. Run the TypeScript build and
   affected test suites.

## Acceptance criteria

- Existing viewpoint, peak, castle, and waterfall discovery and import behavior
  remains intact.
- Named squares, quarters, and standalone named attractions normalize to the
  new `place` category when no existing category takes precedence.
- The database, API/World model, and map presentation accept and expose
  `place` without breaking legacy rows, map selection, or visited state.
- Place scoring remains deterministic and explainable, and does not lower the
  existing automatic-publish threshold or bypass access and identity checks.
- Uncached external requests wait at least 5 seconds between requests;
  transient failures retry at most 5 attempts, honor `Retry-After`, and are
  reported if still unsuccessful.
- A validated complete cached OSM snapshot can be reused. Failed refreshes may
  fall back to validated stale cache; missing required coverage blocks writes.
- The manual workflow can select DEV or PROD, defaults to dry-run, and offers
  an explicit OSM refresh option.
- The workflow connects to the server over SSH and runs the importer through
  the private Compose network; it does not expose PostgreSQL or place
  `DATABASE_URL` in GitHub-hosted runner environment.
- One-off import runs reuse persistent OSM/Wikidata caches and do not restart
  the application service or perform a deployment.
- Imports remain idempotent and do not delete missing records, award XP, or
  reprocess historical activities.
- Focused tests and TypeScript build pass without requiring live OSM or
  Wikidata requests.

## Constraints and risks

- `tourism=attraction` can be broad; meaningful-name checks, existing
  category-specific quality gates, duplicate reporting, and unchanged
  publication thresholds must guard against catalog noise.
- GitHub environments must have the appropriate SSH host/user/key and remote
  path settings for the selected DEV or PROD server. No database credential
  needs to be configured in GitHub.
- Workflow execution depends on the target server being reachable by SSH and
  having the deployed image and existing Compose files available.
- Public Overpass and Wikidata services are shared resources. Request pacing,
  bounded retries, cache reuse, and explicit incomplete-coverage behavior are
  required; persistent upstream outages may still fail a run safely.
- OSM-derived records retain OpenStreetMap attribution and source identity;
  Wikidata references and existing quäldich attribution remain unchanged.

## Validation

1. Run focused normalization, scoring, importer, Overpass, Wikidata, persistence,
   and World/map tests; extend them with deterministic fixtures and injected
   fetchers/sleepers.
2. Verify retry count and measured delay behavior, `Retry-After`, stale-cache
   fallback, exhausted failure reports, and that incomplete OSM coverage never
   upserts or generates missing-upstream conclusions.
3. Validate the database migration and category plumbing without altering
   existing collectible/game-event data.
4. Check workflow YAML, selected environment/SSH bindings, default inputs, and
   remote Compose invocation. Confirm `DATABASE_URL` remains server-side and
   the workflow does not deploy/restart services.
5. Run the TypeScript build and relevant test suites; do not require live
   Overpass, Wikidata, or public PostgreSQL access.
6. On DEV after deploying the updated app image, manually run a dry-run,
   inspect its report, then run the import and verify cache reuse and idempotent
   behavior before selecting PROD.
