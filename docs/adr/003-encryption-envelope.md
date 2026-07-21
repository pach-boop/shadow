# ADR-003: Encryption-at-rest envelope and cryptographic erase

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

Shadow's threat model (ADR-001) includes a shared or stolen device, not
only a network adversary — so "local" is not enough; records must be
unreadable at rest without the user's passphrase, and "delete" must mean
*unrecoverable*, not "removed from a list." Constraints: no backend to
hold keys (ADR-001), browser-first, and a solo maintainer who should not
hand-roll cryptographic primitives.

## Decision

A two-key envelope, all via the WebCrypto `SubtleCrypto` primitives:

- A random 256-bit **data key (DEK)** encrypts every record with
  **AES-256-GCM**.
- The DEK is wrapped by a **key-encryption key (KEK)** derived from the
  passphrase with **PBKDF2-HMAC-SHA256** at **600,000 iterations**
  (OWASP 2023). Only the wrapped DEK is persisted — the `SealedVault`
  (`salt`, wrap `iv`, `wrappedDek`). The passphrase and the raw DEK
  never touch disk.
- **Per-record IV**: every `encrypt` draws a fresh 96-bit IV from the
  CSPRNG. GCM nonce reuse under one key breaks confidentiality *and*
  integrity, so IVs are never counters, never derived, never reused.
- **Versioned envelope**: `SealedVault.v` + `kdf` tag. Unknown versions
  are refused, so a future KDF upgrade is a clean `v: 2`.
- **Cryptographic erase**: destroying the `SealedVault` and dropping the
  in-memory DEK renders every ciphertext unrecoverable. There is no
  plaintext copy and no server, so erase is O(1) and total.

## Alternatives considered

- **Argon2id for the KDF (ADR-001's stated intent).** Memory-hard and
  the better choice against GPU/ASIC cracking, but it is not in
  WebCrypto — it needs a vetted WASM build (bundle size + supply-chain
  surface). Deferred, not rejected: PBKDF2-600k is a defensible baseline
  today, and the versioned envelope makes Argon2id a `v: 2` migration
  (re-wrap the same DEK under a new KEK — no record re-encryption).
- **Encrypt records directly with a passphrase-derived key (no DEK).**
  Simpler, but a passphrase change would re-encrypt every record, and
  there would be no single secret to destroy for erase. The DEK
  indirection buys both cheap passphrase rotation and O(1) erase.
- **A KEK-derived deterministic IV.** Removes IV storage, but courts
  catastrophic nonce reuse. Rejected; random per-record IVs are
  non-negotiable for GCM.
- **Non-extractable DEK.** Preferred in principle, but `wrapKey` and
  passphrase-rotation re-wrapping require an extractable DEK. It stays
  in memory only and is never serialized unwrapped; accepted with that
  note in the code.

## Consequences

- (+) Records are AEAD-protected: tampering fails closed (a bad record
  raises `DecryptionError`, never returns garbage).
- (+) Erase and passphrase rotation are both cheap because the DEK is
  the only thing wrapped.
- (+) The primitive is small, dependency-free, and unit-tested in Node
  (WebCrypto is a platform global) — round-trip, wrong-passphrase,
  fresh-IV, tamper, and erase are all covered.
- (−) PBKDF2 is weaker than Argon2id against specialized cracking
  hardware; the 600k count and a strong passphrase are the interim
  mitigation until the `v: 2` upgrade.
- (−) 600k PBKDF2 iterations cost ~100-300 ms on unlock — acceptable
  one-time latency; tests inject a low count to stay fast.
- (−) The DEK is extractable in memory while unlocked (above). Outside
  the app's memory it exists only wrapped.
