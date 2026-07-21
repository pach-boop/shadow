/**
 * The vault — encryption at rest and cryptographic erase (M2, ADR-003).
 *
 * The model that makes Shadow's promise architectural rather than
 * contractual:
 *
 * - A random 256-bit **data key (DEK)** encrypts every record.
 * - The DEK is itself wrapped by a **key-encryption key (KEK)** derived
 *   from the user's passphrase. Only the *wrapped* DEK is ever
 *   persisted (the {@link SealedVault}); the passphrase and the raw DEK
 *   never touch disk.
 * - **Cryptographic erase**: destroy the sealed vault and drop the
 *   in-memory DEK, and every ciphertext left behind is noise. There is
 *   no data to shred and no server copy — deletion is instant and total
 *   (there is no {@link Vault} without the sealed blob + passphrase).
 *
 * KDF is PBKDF2-SHA256 (WebCrypto-native, zero dependencies) at the
 * OWASP-2023 iteration count. ADR-001 names Argon2id as the intended
 * hardening; the envelope is versioned so that upgrade is a `v: 2`
 * without breaking existing vaults.
 *
 * AES-GCM is authenticated: a tampered record fails to decrypt rather
 * than returning garbage. Every encryption draws a fresh 96-bit IV —
 * GCM nonce reuse under one key is catastrophic, so IVs are never
 * derived or reused.
 */

const KEY_LENGTH = 256;
const IV_BYTES = 12; // 96-bit GCM nonce
const SALT_BYTES = 16;
const DEFAULT_PBKDF2_ITERATIONS = 600_000; // OWASP 2023, PBKDF2-HMAC-SHA256

/** The only thing persisted: the wrapped DEK plus what's needed to unwrap it. */
export interface SealedVault {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string; // base64
  iv: string; // base64 — IV used to wrap the DEK
  wrappedDek: string; // base64 — DEK encrypted under the KEK
}

/** One encrypted record. The IV is unique to this record. */
export interface EncryptedRecord {
  v: 1;
  iv: string; // base64
  ciphertext: string; // base64 (AES-GCM ciphertext incl. auth tag)
}

/** Thrown when a sealed vault cannot be opened with the given passphrase. */
export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong passphrase, or the sealed vault is corrupted.");
    this.name = "WrongPassphraseError";
  }
}

/** Thrown when a record fails to decrypt (wrong key or tampered ciphertext). */
export class DecryptionError extends Error {
  constructor() {
    super("Record could not be decrypted — wrong key or tampered data.");
    this.name = "DecryptionError";
  }
}

/**
 * UTF-8 encode into a guaranteed ArrayBuffer-backed view. TextEncoder
 * types its result as `Uint8Array<ArrayBufferLike>`, which the WebCrypto
 * `BufferSource` params reject; `Uint8Array.from` re-backs it with a
 * plain ArrayBuffer without a cast.
 */
function utf8(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(new TextEncoder().encode(text));
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKek(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    utf8(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/**
 * A live, unlocked vault. Holds the DEK in memory only; encrypts and
 * decrypts records. Never persist a `Vault` — persist the
 * {@link SealedVault} returned by {@link Vault.create}.
 */
export class Vault {
  // Extractable so the DEK can be re-wrapped under a new KEK on a future
  // passphrase change. It lives only in memory and is never serialized
  // except wrapped; at-rest, only the sealed envelope exists.
  readonly #dek: CryptoKey;

  private constructor(dek: CryptoKey) {
    this.#dek = dek;
  }

  /** Create a brand-new vault: fresh DEK, sealed under `passphrase`. */
  static async create(
    passphrase: string,
    iterations: number = DEFAULT_PBKDF2_ITERATIONS,
  ): Promise<{ vault: Vault; sealed: SealedVault }> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const kek = await deriveKek(passphrase, salt, iterations);
    const dek = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: KEY_LENGTH },
      true, // extractable — required to wrap; see #dek note
      ["encrypt", "decrypt"],
    );
    const wrapped = await crypto.subtle.wrapKey("raw", dek, kek, {
      name: "AES-GCM",
      iv,
    });
    return {
      vault: new Vault(dek),
      sealed: {
        v: 1,
        kdf: "PBKDF2-SHA256",
        iterations,
        salt: toBase64(salt.buffer),
        iv: toBase64(iv.buffer),
        wrappedDek: toBase64(wrapped),
      },
    };
  }

  /** Open a sealed vault. Throws {@link WrongPassphraseError} on failure. */
  static async open(passphrase: string, sealed: SealedVault): Promise<Vault> {
    if (sealed.v !== 1 || sealed.kdf !== "PBKDF2-SHA256") {
      throw new Error(`Unsupported sealed vault (v${sealed.v}/${sealed.kdf}).`);
    }
    const kek = await deriveKek(
      passphrase,
      fromBase64(sealed.salt),
      sealed.iterations,
    );
    try {
      const dek = await crypto.subtle.unwrapKey(
        "raw",
        fromBase64(sealed.wrappedDek),
        kek,
        { name: "AES-GCM", iv: fromBase64(sealed.iv) },
        { name: "AES-GCM" },
        true,
        ["encrypt", "decrypt"],
      );
      return new Vault(dek);
    } catch {
      // GCM auth failure on the wrapped DEK: wrong passphrase or tamper.
      throw new WrongPassphraseError();
    }
  }

  async encrypt(plaintext: string): Promise<EncryptedRecord> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      this.#dek,
      utf8(plaintext),
    );
    return { v: 1, iv: toBase64(iv.buffer), ciphertext: toBase64(ciphertext) };
  }

  async decrypt(record: EncryptedRecord): Promise<string> {
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64(record.iv) },
        this.#dek,
        fromBase64(record.ciphertext),
      );
      return new TextDecoder().decode(plaintext);
    } catch {
      throw new DecryptionError();
    }
  }
}
