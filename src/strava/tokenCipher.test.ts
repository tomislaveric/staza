import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenCipher } from "./tokenCipher.js";

describe("TokenCipher", () => {
  const cipher = new TokenCipher(randomBytes(32));

  it("round-trips without storing plaintext", () => {
    const encrypted = cipher.encrypt("secret-token", "strava:player:access");
    expect(encrypted).not.toContain("secret-token");
    expect(encrypted).not.toBe(cipher.encrypt("secret-token", "strava:player:access"));
    expect(cipher.decrypt(encrypted, "strava:player:access")).toBe("secret-token");
  });

  it("binds ciphertext to its owner and purpose and rejects tampering or another key", () => {
    const encrypted = cipher.encrypt("secret-token", "strava:player:access");
    expect(() => cipher.decrypt(encrypted, "strava:player:refresh")).toThrow();
    expect(() => cipher.decrypt(encrypted, "strava:other:access")).toThrow();
    expect(() => new TokenCipher(randomBytes(32)).decrypt(encrypted, "strava:player:access")).toThrow();
    const parts = encrypted.split(":");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => cipher.decrypt(parts.join(":"), "strava:player:access")).toThrow();
  });

  it("requires a 32-byte key", () => {
    expect(() => new TokenCipher(randomBytes(16))).toThrow();
  });
});
