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

  it("runs the compiled quäldich package command without a dry-run option", async () => {
    const workflow = await readFile(".github/workflows/import-quaeldich.yml", "utf8");
    const packageJson = await readFile("package.json", "utf8");
    expect(workflow).toContain("npm run import:quaeldich:dist");
    expect(workflow).not.toContain("dry_run");
    expect(workflow).not.toContain("--dry-run");
    expect(workflow).not.toContain("quaeldich-sample.geojson");
    expect(packageJson).toContain('"import:quaeldich:dist": "node dist/persistence/importQuaeldichPasses.js"');
  });
});
