import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("manual data import workflows", () => {
  it("imports the uploaded Fartlek snapshot without requiring a PBF", async () => {
    const contents = await readFile(".github/workflows/data-import.yml", "utf8");
    expect(contents).toContain("name: Import Fartleks");
    expect(contents).toContain("/import-source/osm-germany-fartleks.ndjson");
    expect(contents).toContain("npm run import:fartleks -- --snapshot");
    expect(contents).toContain("-o ServerAliveInterval=30");
    expect(contents).toContain("-o ServerAliveCountMax=120");
    expect(contents).not.toContain("germany-latest.osm.pbf");
    expect(contents).not.toContain("extract:osm-germany-fartleks");
    expect(contents).not.toContain("osmium");
  });

  it("extracts cycleway candidates and marks only complete pipeline snapshots as complete", async () => {
    const extraction = await readFile("scripts/extract-osm-germany-fartleks.sh", "utf8");
    const builder = await readFile("src/osm/buildFartlekSnapshot.ts", "utf8");

    expect(extraction).toContain("unclassified,cycleway");
    expect(extraction).toContain("--coverage-complete");
    expect(builder).toContain("coverageComplete: false");
    expect(builder).toContain("coverageComplete: args.coverageComplete");
  });

  it("imports the uploaded quäldich GeoJSON with the compiled package command", async () => {
    const workflow = await readFile(".github/workflows/import-quaeldich.yml", "utf8");
    const packageJson = await readFile("package.json", "utf8");
    expect(workflow).toContain("npm run import:quaeldich:dist");
    expect(workflow).toContain("/opt/staza/data/quaeldich-sample.geojson");
    expect(workflow).toContain("--snapshot /import-source/quaeldich-sample.geojson");
    expect(workflow).toContain('if [ ! -s "$snapshot_file" ]');
    expect(workflow.match(/compose run/g)).toHaveLength(2);
    expect(workflow.match(/<\/dev\/null/g)).toHaveLength(2);
    expect(workflow).not.toContain("dry_run");
    expect(workflow).not.toContain("--dry-run");
    expect(packageJson).toContain('"import:quaeldich:dist": "node dist/persistence/importQuaeldichPasses.js"');
  });
});
