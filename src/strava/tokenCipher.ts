import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/**
 * AES-256-GCM encryption for provider credentials at rest. The associated data binds each
 * ciphertext to its owner and purpose so a token cannot be swapped between rows or fields.
 */
export class TokenCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("Token encryption key must be 32 bytes.");
  }

  encrypt(plaintext: string, associatedData: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(associatedData, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
  }

  decrypt(encoded: string, associatedData: string): string {
    const [version, iv, tag, ciphertext] = encoded.split(":");
    if (version !== VERSION || !iv || !tag || ciphertext === undefined) throw new Error("Unsupported token ciphertext.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  }
}
