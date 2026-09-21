import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for the few things this app has to be able to read back:
//  - a BVN, so an admin can run the no-consent Mashup lookup without the
//    applicant present (BVN_ENCRYPTION_KEY);
//  - Mono's raw responses, kept for audit/debugging (MONO_RAW_ENCRYPTION_KEY).
// Everything else sensitive (login passwords, the BVN's own primary storage) is
// a one-way argon2 hash on purpose — this exists only where a real value has to
// come back out.
//
// Each use has its own key variable, so rotating or leaking one doesn't touch
// the other. A key is a base64-encoded 32-byte value, generated once and never
// rotated casually (rotating strands what was encrypted under the old one — see
// decryptSecretOrNull, which treats that as "unavailable", not a crash).
const ALGO = "aes-256-gcm";

export const BVN_KEY_VAR = "BVN_ENCRYPTION_KEY";
export const MONO_RAW_KEY_VAR = "MONO_RAW_ENCRYPTION_KEY";

function loadKey(envVar: string): Buffer | null {
  const raw = process.env[envVar];
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `${envVar} must decode to exactly 32 bytes (got ${key.length}). ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

/** True once the key variable is set — callers use this to offer/hide a feature that needs it. */
export function hasEncryptionKey(envVar: string = BVN_KEY_VAR): boolean {
  return loadKey(envVar) !== null;
}

/** iv:authTag:ciphertext, each base64 — a plain string so it drops straight into a text column. */
export function encryptSecret(plaintext: string, envVar: string = BVN_KEY_VAR): string {
  const key = loadKey(envVar);
  if (!key) throw new Error(`${envVar} is not set — cannot encrypt`);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(":");
}

/**
 * Never throws — a missing key, a missing/malformed value, or a key that's
 * since been rotated all come back as null. Every caller already has a
 * "can't recover this right now" path, so decryption failing should degrade to
 * that, not 500 the request.
 */
export function decryptSecretOrNull(
  stored: string | null | undefined,
  envVar: string = BVN_KEY_VAR,
): string | null {
  if (!stored) return null;
  let key: Buffer | null;
  try {
    key = loadKey(envVar);
  } catch {
    return null;
  }
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
