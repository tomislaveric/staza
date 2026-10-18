import { describe, expect, it, vi } from "vitest";
import { HOME_LOCATION_STORAGE_KEY, readHomeLocation, saveHomeLocation } from "./home-location.js";

describe("saved home location", () => {
  it("returns no location when storage is empty or contains invalid data", () => {
    const storage = { getItem: vi.fn().mockReturnValue(null) };
    expect(readHomeLocation(storage)).toBeUndefined();

    storage.getItem.mockReturnValue("{");
    expect(readHomeLocation(storage)).toBeUndefined();

    storage.getItem.mockReturnValue(JSON.stringify({ latitude: 91, longitude: 9 }));
    expect(readHomeLocation(storage)).toBeUndefined();
  });

  it("reads a valid location and replaces the saved value on each update", () => {
    let value = JSON.stringify({ latitude: 50, longitude: 8 });
    const storage = {
      getItem: vi.fn(() => value),
      setItem: vi.fn((key, nextValue) => {
        expect(key).toBe(HOME_LOCATION_STORAGE_KEY);
        value = nextValue;
      })
    };

    expect(readHomeLocation(storage)).toEqual({ latitude: 50, longitude: 8 });
    saveHomeLocation({ latitude: 51, longitude: 9 }, storage);

    expect(readHomeLocation(storage)).toEqual({ latitude: 51, longitude: 9 });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("rejects attempts to save invalid coordinates", () => {
    expect(() => saveHomeLocation({ latitude: 91, longitude: 9 }, { setItem: vi.fn() }))
      .toThrow("A valid latitude and longitude are required");
  });
});
