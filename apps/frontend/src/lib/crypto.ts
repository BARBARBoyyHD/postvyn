/**
 * AES-256-GCM over WebCrypto — the only place a platform token becomes plaintext (ADR-011).
 *
 * The channel id is bound in as additional authenticated data, so a row lifted from one channel and
 * pasted into another fails to decrypt instead of handing over the first channel's token. WebCrypto
 * appends the GCM tag to the ciphertext, which is why the table has no tag column.
 *
 * Pure on purpose: no D1, no env reads, no logging. Callers pass the key in, which is what makes the
 * tamper and wrong-channel cases testable without a database.
 */
export const KEY_BYTES = 32;
export const IV_BYTES = 12;

export interface SecretsKey {
  /** Stamped on every row this key writes, so rotation is a pass over rows rather than a flag day. */
  readonly version: number;
  readonly key: CryptoKey;
}

export interface EncryptedSecret {
  readonly ciphertext: Uint8Array;
  readonly iv: Uint8Array;
  readonly keyVersion: number;
}

export type DecryptResult =
  | { ok: true; plaintext: string }
  /** GCM cannot tell a tampered row from a foreign one; both mean "reconnect this channel". */
  | { ok: false; reason: "authentication_failed" };

export async function importSecretsKey(base64: string, version: number): Promise<SecretsKey> {
  const raw = base64ToBytes(base64);
  if (!raw || raw.length !== KEY_BYTES) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must be ${KEY_BYTES} bytes, base64-decoded (ADR-011)`);
  }
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
  return { version, key };
}

export async function encryptSecret(
  plaintext: string,
  channelId: string,
  key: SecretsKey,
): Promise<EncryptedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encode(channelId) },
    key.key,
    encode(plaintext),
  );
  return { ciphertext: new Uint8Array(ciphertext), iv, keyVersion: key.version };
}

export async function decryptSecret(
  row: { ciphertext: Uint8Array; iv: Uint8Array },
  channelId: string,
  key: SecretsKey,
): Promise<DecryptResult> {
  // Normalised because a DB blob arrives as a `Buffer`, whose backing store is not statically an
  // `ArrayBuffer` — WebCrypto's types are stricter than the runtime needs.
  const iv = new Uint8Array(row.iv);
  const ciphertext = new Uint8Array(row.ciphertext);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: encode(channelId) },
      key.key,
      ciphertext,
    );
    return { ok: true, plaintext: new TextDecoder().decode(plaintext) };
  } catch {
    return { ok: false, reason: "authentication_failed" };
  }
}

/** `null` for anything that is not base64 — callers report that with the variable name in it. */
export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function encode(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}
