import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for the one field in this app that has to come back out again:
// a BVN, so an admin can run the no-consent Mashup lookup without the
// applicant present. Everything else sensitive (login codes, passwords,
// the BVN's own primary storage) is a one-way argon2 hash on purpose —
// this exists only because Mashup needs the real number.
//
// BVN_ENCRYPTION_KEY is a base64-encoded 32-byte key, generated once and
// never rotated casually (rotating it strands every already-encrypted BVN —
// see decryptSecretOrNull below, which treats that as "unavailable", not a
// crash).
const ALGO = "aes-256-gcm";

function loadKey(): Buffer | null {
  const raw = process.env.BVN_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `BVN_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

/** True once BVN_ENCRYPTION_KEY is set — callers use this to offer/hide the admin recheck button. */
export function hasEncryptionKey(): boolean {
  return loadKey() !== null;
}

/** iv:authTag:ciphertext, each base64 — a plain string so it drops straight into a text column. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  if (!key) throw new Error("BVN_ENCRYPTION_KEY is not set — cannot encrypt");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(":");
}

/**
 * Never throws — a missing key, a missing/malformed value, or a key that's
 * since been rotated all come back as null. Every caller already has a
 * "can't verify BVN right now" path (the applicant's own code-based check),
 * so decryption failing should degrade to that, not 500 the request.
 */
export function decryptSecretOrNull(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const key = loadKey();
  if (!key) return null;
  const parts = stored.split(":");
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64"));
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
