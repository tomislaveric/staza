import { describe, expect, it } from "vitest";
import { androidAssetLinks, appleAppSiteAssociation } from "./nativeAssociation.js";

describe("native association documents", () => {
  it("builds both documents from configured identifiers", () => {
    const config = { appleAppIds: ["TEAM.world.staza"], androidPackageName: "world.staza", androidSha256CertFingerprints: ["AA:BB"] };
    expect(appleAppSiteAssociation(config)).toMatchObject({
      applinks: { details: [{ appIDs: ["TEAM.world.staza"] }] },
      webcredentials: { apps: ["TEAM.world.staza"] }
    });
    expect(androidAssetLinks(config)).toMatchObject([{ target: { package_name: "world.staza", sha256_cert_fingerprints: ["AA:BB"] } }]);
  });

  it("emits no Android statements without placeholders being replaced", () => {
    expect(androidAssetLinks({ appleAppIds: [], androidSha256CertFingerprints: [] })).toEqual([]);
  });
});
