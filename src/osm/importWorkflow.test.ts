import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workflow = async (): Promise<string> =>
  readFile(".github/workflows/import-osm-wikidata.yml", "utf8");
const script = async (): Promise<string> =>
  readFile("scripts/import-osm-wikidata.sh", "utf8");

describe("manual OSM/Wikidata import workflow", () => {
  it("is manual only and offers DEV/PROD inputs without a dry-run option", async () => {
    const contents = await workflow();
    expect(contents).toContain("workflow_dispatch:");
    expect(contents).not.toMatch(/^\s{2}(push|schedule|release):/m);
    expect(contents).toMatch(/options:\s*\n\s*- dev\s*\n\s*- prod/);
    expect(contents).not.toContain("dry_run");
    expect(contents).not.toContain("refresh_osm");
    expect(contents).not.toMatch(/overpass/i);
    expect(contents).toContain("name: app-${{ inputs.target }}");
  });

  it("binds environment SSH settings and never exposes a database URL to the runner", async () => {
    const contents = await workflow();
    for (const binding of [
      "REMOTE_PATH: ${{ vars.REMOTE_PATH }}",
      "SSH_HOST: ${{ secrets.SSH_HOST }}",
      "SSH_USER: ${{ secrets.SSH_USER }}",
      "SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}",
      "SSH_PORT: ${{ vars.SSH_PORT }}"
    ]) expect(contents).toContain(binding);
    expect(contents).not.toContain("DATABASE_URL");
    expect(contents).not.toContain("POSTGRES_");
    expect(contents).toContain("./scripts/import-osm-wikidata.sh");
  });

  it("runs the deployed image as a one-off Compose container without deploying or restarting", async () => {
    const contents = await script();
    expect(contents).toContain("compose run --rm --no-TTY");
    expect(contents).toContain("node dist/persistence/importOSMWikidata.js");
    expect(contents).toContain("/import-source/osm-germany.json");
    expect(contents).toContain('--snapshot "$snapshot_file"');
    expect(contents).not.toContain("/app/fixtures/osm-germany.json");
    expect(contents).toContain("OSM_WIKIDATA_CACHE_DIR=/data/osm-cache/wikidata");
    expect(contents).toContain("if [[ -n \"${DATABASE_URL:-}\" ]]; then");
    expect(contents).not.toContain("compose up");
    expect(contents).not.toContain("compose pull");
    expect(contents).not.toContain("docker restart");
    expect(contents).not.toContain("DRY_RUN");
    expect(contents).not.toContain("--dry-run");
    expect(contents).not.toMatch(/overpass/i);
  });
});
