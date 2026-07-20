# ADR-001: Local-first TypeScript stack (browser-first, adapters for inference)

- **Status:** Accepted
- **Date:** 2026-07-15

## Context

Shadow's core promise is architectural privacy: conversation content must never leave the user's device unprotected, and deletion must be real. That constrains where inference, storage and processing can happen. Additional constraints shaping this decision:

- Solo maintainer; zero infrastructure budget — the free tier must cost ~$0 to serve.
- The public demo must work in one click, with nothing to install, so the privacy claim can be *experienced*, not just read.
- The threat model includes shared and stolen devices, not only network adversaries — so "local" alone is not enough; at-rest encryption is required.
- Maintainer's primary stack is TypeScript/React; a second language would slow every milestone.

## Decision

A TypeScript monorepo (pnpm workspaces) with two packages:

- **`packages/core`** — pure TypeScript, no UI, no DOM assumptions: encrypted storage, key management, long-term memory (embeddings + retrieval), the privacy/cost router, and per-call metering with FOCUS export. Unit-testable in Node.
- **`apps/web`** — React PWA, built as a fully static site (deployable on GitHub Pages). Service worker for offline use.

Inference goes through a single `ChatBackend` interface with interchangeable adapters:

| Adapter | Runs | Role |
|---|---|---|
| `webllm` | In-browser via WebGPU (worker) | Zero-install public demo; default for capable hardware |
| `ollama` | `localhost:11434` | Dev machines, desktops, older GPUs/CPU inference |
| `cloud` (BYOK) | Remote API, user's own key | Optional deeper responses; only ever receives redacted text |

Supporting choices: embeddings via transformers.js (local, in a worker); AES-GCM-256 through WebCrypto with an Argon2id-derived key-encryption key (WASM implementation, vendored/pinned — Argon2id is not in WebCrypto); persistence in IndexedDB with `navigator.storage.persist()` requested.

## Alternatives considered

- **Tauri / Electron desktop app.** Better filesystem control and room for larger local models, but it kills the one-click demo, adds per-OS packaging burden for a solo maintainer, and a desktop shell can wrap the finished web app later anyway. Deferred, not rejected.
- **Python backend (FastAPI) + web frontend.** Familiar and fast to build, but it reintroduces a server — the exact thing the product promises not to have — and splits the codebase across two languages.
- **Native mobile first (e.g., Apple's on-device foundation models).** The strongest on-device inference story on iOS, but requires a macOS/Xcode toolchain (maintainer develops on Linux) and locks the demo to one platform.
- **Plaintext local-first storage (as in comparable projects).** Simpler, but "local" without encryption fails Shadow's threat model (shared or stolen devices) — and that gap is precisely Shadow's differentiator.

## Consequences

- (+) $0 hosting; the demo is a URL; one language across core and UI; every core module testable without a browser.
- (+) The adapter seam keeps model and backend choices reversible as local-model quality improves.
- (−) In-browser model quality is capped (≈3-4B params, quantized). Mitigation: the router + redaction design lets hard queries delegate safely (see [ADR-002](./002-privacy-router.md)).
- (−) WebGPU availability varies, notably on Linux. Mitigation: feature-detect at onboarding, recommend the Ollama adapter when WebGPU is absent.
- (−) IndexedDB can be evicted under storage pressure. Mitigation: request persistent storage, and provide encrypted export/backup from M2.
- (−) Argon2id ships as WASM (extra ~100KB, supply-chain surface). Mitigation: pin and vendor the implementation; PBKDF2-SHA256 (600k+ iterations) as documented fallback.
