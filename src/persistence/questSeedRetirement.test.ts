import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { QuestRepository } from "./questRepository.js";

describe("seeded quest retirement", () => {
  it("deletes only the listed titles belonging to the curator", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 2 }));
    const repository = new QuestRepository({ query } as unknown as Pool);

    await expect(repository.removeOwnedByTitles("curator-id", ["Karlsruhe City Classics", "Rhine and Harbour"]))
      .resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(
      "DELETE FROM quests WHERE created_by_player_id = $1 AND title = ANY($2::text[])",
      ["curator-id", ["Karlsruhe City Classics", "Rhine and Harbour"]]
    );
  });

  it("does not issue a query when no quest titles are retired", async () => {
    const query = vi.fn();
    const repository = new QuestRepository({ query } as unknown as Pool);

    await expect(repository.removeOwnedByTitles("curator-id", [])).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
