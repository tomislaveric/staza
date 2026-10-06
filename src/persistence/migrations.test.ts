import { describe, expect, it, vi } from "vitest";
import { migrations } from "./migrations.js";

describe("Strava reconnect state migration", () => {
  it("repairs already-applied Strava schemas without resetting connection data", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const client = { query };
    const migration = migrations.find((entry) => entry.id === "018_strava_connection_reconnect_state");

    expect(migration).toBeDefined();
    await migration!.up(client);

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0]).toContain(
      "ADD COLUMN IF NOT EXISTS needs_reconnect BOOLEAN NOT NULL DEFAULT false"
    );
    expect(query.mock.calls[0][0]).not.toMatch(/DROP|DELETE|TRUNCATE/i);
  });
});
