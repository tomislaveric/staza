# import-data-workflow

## Goal

Import the OSM/Wikidata, Fartlek, and quäldich datasets into the selected DEV or
PROD PostgreSQL database through GitHub Actions, without requiring a person to
log in to the VPS and run import commands. PostgreSQL remains private to the
VPS Docker Compose network.

## Scope

- Keep the three separate manual `workflow_dispatch` workflows and their DEV /
  PROD target choice.
- Use snapshots staged on the VPS at `/opt/staza/data`, mounted read-only in
  the app container as `/import-source`:
  - `osm-germany.json` for OSM/Wikidata.
  - `osm-germany-fartleks.ndjson` for Fartleks.
  - `quaeldich-sample.geojson` for the quäldich GeoJSON. The committed
    repository fixture with this name is only a test sample; the uploader
    replaces the VPS copy with the full downloaded source.
- Let the user download/update source files and transfer them to the VPS; the
  quäldich uploader handles validation, renaming, and SCP. Each GitHub workflow
  then performs the import without manual commands on the VPS.
- Provide `npm run move:quaeldich2vps -- <local-file>`; it preserves the local
  download, validates its GeoJSON FeatureCollection, and stages it as
  `/opt/staza/data/quaeldich-sample.geojson`. SSH target and optional port come
  from local `.env`, while `scp` handles interactive authentication.
- Add file-based input to the quäldich importer so the workflow does not fetch
  the source from the VPS, where the endpoint returned HTTP 403.
- Document snapshot setup, GitHub Environment configuration, and local versus
  deployed import commands.

## Decisions

- The GitHub-hosted runner connects to the VPS over the existing SSH setup and
  starts a one-off Compose container. It does not connect directly to
  PostgreSQL, and no database URL is added to GitHub secrets.
- Snapshots remain on the VPS rather than in Git. In particular, the local
  Fartlek NDJSON snapshot is 636 MB and ignored by Git.
- `npm run import:quaeldich` remains the local TypeScript/`tsx` command;
  `npm run import:quaeldich:dist` remains the compiled-JavaScript command for
  the deployed image, which does not include `tsx`.
- The upload helper uses `QUAELDICH_VPS_SSH_TARGET` and optional
  `QUAELDICH_VPS_SSH_PORT` from local `.env`; no password is stored by the
  project.
- The existing importer behavior, target selection, and manual workflow
  dispatch remain intact except that quäldich reads the staged snapshot rather
  than fetching the source from the VPS.

## Implementation plan

1. Add and test file-based GeoJSON input to the quäldich importer while
   preserving its current URL source mode for local use.
2. Update the quäldich GitHub workflow to check that the staged file exists and
   is nonempty, then pass `/import-source/quaeldich-sample.geojson` to the
   compiled importer.
3. Verify and document the existing OSM/Wikidata and Fartlek workflow paths,
   upload/update steps, GitHub Environment settings, target behavior, and
   package command roles.
4. Add the local npm uploader that accepts the downloaded `.json` path, checks
   it is a nonempty GeoJSON FeatureCollection, and SCPs it to the workflow's
   fixed VPS snapshot path.
5. Run focused importer and workflow tests, followed by build validation.

## Acceptance criteria

- Each manual workflow imports only into the selected DEV or PROD database
  using the snapshot staged on the VPS.
- The quäldich workflow succeeds without an HTTP request to the upstream source
  from the VPS and gives a clear error if its snapshot is missing or empty.
- OSM/Wikidata and Fartlek continue using their existing staged snapshots.
- Import execution continues to use the private Compose network; database
  credentials are not exposed to GitHub-hosted runners.
- Local import commands and remote deployed-image commands are clearly
  distinguished in the repository documentation.

## Validation

- Add focused coverage for the quäldich file input and workflow command/path.
- Run the existing persistence/import workflow tests and project build.
- Review the workflow and deployment documentation for correct snapshot paths,
  environment settings, and private database connectivity.
