/**
 * The credential cipher.
 *
 * Three properties, each one a way a database dump turns into somebody's account: the plaintext comes
 * back intact, a modified row does not decrypt, and a row decrypted under another channel's id does
 * not decrypt either. The last is the one that makes `channel_id` as AAD worth its complexity.
 */
import { describe, expect, it } from "vitest";

import {
  decryptSecret,
  encryptSecret,
  importSecretsKey,
  IV_BYTES,
  KEY_BYTES,
  type SecretsKey,
} from "@/lib/crypto";
import { requireTokenEncryptionKey, type WorkerEnv } from "@/lib/env";

/** Fixed keys, not generated: a failing assertion should fail the same way tomorrow. */
const KEY_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const KEY_B = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";

const CHANNEL = "chn-crypto-1";

const keyA = (): Promise<SecretsKey> => importSecretsKey(KEY_A, 1);

describe("AES-256-GCM round trip", () => {
  it("returns the plaintext and stamps the key version", async () => {
    const secret = await encryptSecret('{"accessToken":"ig-token"}', CHANNEL, await keyA());

    expect(secret.iv).toHaveLength(IV_BYTES);
    expect(secret.keyVersion).toBe(1);
    expect(Buffer.from(secret.ciphertext).toString("utf8")).not.toContain("ig-token");

    const decrypted = await decryptSecret(secret, CHANNEL, await keyA());
    expect(decrypted).toEqual({ ok: true, plaintext: '{"accessToken":"ig-token"}' });
  });

  it("uses a fresh IV per write", async () => {
    const key = await keyA();
    const first = await encryptSecret("same", CHANNEL, key);
    const second = await encryptSecret("same", CHANNEL, key);
    expect(Buffer.from(first.iv).equals(Buffer.from(second.iv))).toBe(false);
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
  });
});

describe("a row that was interfered with does not decrypt", () => {
  it("fails on a modified ciphertext instead of throwing", async () => {
    const secret = await encryptSecret("token", CHANNEL, await keyA());
    const tampered = Uint8Array.from(secret.ciphertext);
    tampered[0] ^= 0xff;

    const result = await decryptSecret(
      { ciphertext: tampered, iv: secret.iv },
      CHANNEL,
      await keyA(),
    );
    expect(result).toEqual({ ok: false, reason: "authentication_failed" });
  });

  it("fails when the row is read under another channel's id — the AAD binding", async () => {
    const secret = await encryptSecret("token-for-channel-a", CHANNEL, await keyA());

    const result = await decryptSecret(secret, "chn-somebody-else", await keyA());
    expect(result).toEqual({ ok: false, reason: "authentication_failed" });
  });

  it("fails under a different key, which is what a rotation must notice", async () => {
    const secret = await encryptSecret("token", CHANNEL, await keyA());
    const other = await importSecretsKey(KEY_B, 2);

    expect(await decryptSecret(secret, CHANNEL, other)).toEqual({
      ok: false,
      reason: "authentication_failed",
    });
  });
});

describe("the key itself is validated on first use", () => {
  it("rejects a key that is not 32 bytes and says which variable is wrong", async () => {
    await expect(importSecretsKey("c2hvcnQ=", 1)).rejects.toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("names TOKEN_ENCRYPTION_KEY when the variable is absent", () => {
    expect(() => requireTokenEncryptionKey({} as WorkerEnv)).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("names TOKEN_ENCRYPTION_KEY_VERSION when it is not a version number", () => {
    expect(() =>
      requireTokenEncryptionKey({
        TOKEN_ENCRYPTION_KEY: KEY_A,
        TOKEN_ENCRYPTION_KEY_VERSION: "one",
      } as WorkerEnv),
    ).toThrow(/TOKEN_ENCRYPTION_KEY_VERSION/);
  });

  it("defaults the version to 1 and accepts a valid key", () => {
    expect(requireTokenEncryptionKey({ TOKEN_ENCRYPTION_KEY: KEY_A } as WorkerEnv)).toEqual({
      base64: KEY_A,
      version: 1,
    });
    expect(
      requireTokenEncryptionKey({
        TOKEN_ENCRYPTION_KEY: KEY_A,
        TOKEN_ENCRYPTION_KEY_VERSION: "3",
      } as WorkerEnv).version,
    ).toBe(3);
  });

  it("is exactly the AES-256 key size", () => {
    expect(KEY_BYTES).toBe(32);
  });
});
