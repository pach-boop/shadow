import { describe, expect, it } from "vitest";

import {
  DecryptionError,
  type EncryptedRecord,
  Vault,
  WrongPassphraseError,
} from "./vault";

// Keep PBKDF2 cheap in tests; the sealed vault records the count, so
// open() uses the same one. Production defaults to 600k (OWASP 2023).
const FAST = 1000;

function tamper(record: EncryptedRecord): EncryptedRecord {
  const bytes = Uint8Array.from(atob(record.ciphertext), (c) => c.charCodeAt(0));
  bytes[0]! ^= 0xff;
  return { ...record, ciphertext: btoa(String.fromCharCode(...bytes)) };
}

describe("Vault", () => {
  it("round-trips a record through encrypt and decrypt", async () => {
    const { vault } = await Vault.create("correct horse battery staple", FAST);

    const record = await vault.encrypt("the thing I told no one");

    expect(await vault.decrypt(record)).toBe("the thing I told no one");
  });

  it("reopens from the sealed envelope and decrypts earlier records", async () => {
    // The real lifecycle: create, persist `sealed`, come back, open.
    const { vault, sealed } = await Vault.create("passphrase", FAST);
    const record = await vault.encrypt("months of context");

    const reopened = await Vault.open("passphrase", sealed);

    expect(await reopened.decrypt(record)).toBe("months of context");
  });

  it("rejects the wrong passphrase instead of returning garbage", async () => {
    const { sealed } = await Vault.create("right", FAST);

    await expect(Vault.open("wrong", sealed)).rejects.toBeInstanceOf(
      WrongPassphraseError,
    );
  });

  it("draws a fresh IV per encryption (no GCM nonce reuse)", async () => {
    const { vault } = await Vault.create("p", FAST);

    const a = await vault.encrypt("same text");
    const b = await vault.encrypt("same text");

    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext); // same plaintext, different output
  });

  it("fails authentication on a tampered record", async () => {
    const { vault } = await Vault.create("p", FAST);
    const record = await vault.encrypt("integrity matters");

    await expect(vault.decrypt(tamper(record))).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it("cryptographic erase: a lost envelope makes records unrecoverable", async () => {
    // Vault A writes a record. "Erasing" means discarding A's sealed
    // envelope + DEK. A different vault (a stand-in for any attacker
    // without the original envelope + passphrase) cannot read it —
    // the ciphertext is noise.
    const { vault: a } = await Vault.create("secret-A", FAST);
    const record = await a.encrypt("burn after reading");

    const { vault: b } = await Vault.create("secret-A", FAST); // new salt+DEK

    await expect(b.decrypt(record)).rejects.toBeInstanceOf(DecryptionError);
  });

  it("preserves Unicode (accents and emoji survive the round-trip)", async () => {
    const { vault } = await Vault.create("p", FAST);
    const text = "мой дневник · acentuación · 🕯️ sombra";

    expect(await vault.decrypt(await vault.encrypt(text))).toBe(text);
  });

  it("refuses an unsupported envelope version", async () => {
    const { sealed } = await Vault.create("p", FAST);
    const future = { ...sealed, v: 2 as unknown as 1 };

    await expect(Vault.open("p", future)).rejects.toThrow(/Unsupported/);
  });
});
