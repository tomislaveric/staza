import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCollectibles } from "./coin.js";
import { UserInputError } from "./errors.js";

const writeConfig = async (contents: unknown): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "post-ride-ar-collectibles-"));
  const file = path.join(directory, "collectibles.json");
  await writeFile(file, JSON.stringify(contents));
  return file;
};

describe("readCollectibles", () => {
  it("normalizes legacy entries", async () => {
    const collectibles = await readCollectibles(
      await writeConfig([
        { id: "one", latitude: 48, longitude: 11, radius_m: 5, value: 100 },
        { id: "two", name: "Turmberg", type: "landmark", latitude: 49, longitude: 12, radius_m: 10, value: 200, description: "Viewpoint" }
      ])
    );

    expect(collectibles).toEqual([
      { id: "one", name: "one", type: "coin", latitude: 48, longitude: 11, radiusMeters: 5, value: 100 },
      { id: "two", name: "Turmberg", type: "landmark", latitude: 49, longitude: 12, radiusMeters: 10, value: 200, description: "Viewpoint" }
    ]);
  });

  it("rejects empty lists", async () => {
    await expect(readCollectibles(await writeConfig([]))).rejects.toThrow(UserInputError);
  });

  it("rejects nonpositive radii and unsupported metadata", async () => {
    await expect(
      readCollectibles(await writeConfig([{ id: "one", latitude: 48, longitude: 11, radius_m: 0, value: 100 }]))
    ).rejects.toThrow("radius_m");
    await expect(readCollectibles(await writeConfig([{ id: "one", type: "medal", latitude: 48, longitude: 11, radius_m: 4, value: 100 }]))).rejects.toThrow(UserInputError);
  });

  it("rejects duplicate ids", async () => {
    await expect(
      readCollectibles(
        await writeConfig([
          { id: "one", latitude: 48, longitude: 11, radius_m: 5, value: 100 },
          { id: "one", latitude: 49, longitude: 12, radius_m: 5, value: 200 }
        ])
      )
    ).rejects.toThrow(UserInputError);
  });
});
