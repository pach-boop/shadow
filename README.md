# Shadow

[![ci](https://github.com/pach-boop/shadow/actions/workflows/ci.yml/badge.svg)](https://github.com/pach-boop/shadow/actions/workflows/ci.yml)

**A fully private AI that follows you like your shadow — and answers to no one else.**

Shadow is an open-source, local-first AI companion. There is exactly **one chat**, and it carries **100% of your context**: everything you have ever told it, distilled into a long-term memory that never leaves your hands. Like your shadow, it goes where you go, knows your whole story, and belongs to you alone — the model runs on your device, every word is encrypted at rest, and nothing is stored for anyone but the person holding the key.

[Léeme en español](./README.es.md)

> **Status: pre-alpha.** This repository currently contains the design (README-first) and the architecture decision records. Code lands milestone by milestone — see the [roadmap](#roadmap).

## Why

People tell AI assistants things they have never told anyone. Companies ban AI assistants because employees paste confidential data into them. Both problems are the same problem: **conversations with cloud AI have no real confidentiality.** They can be retained — in 2025 a US court ordered a major provider to preserve even "deleted" chats — reviewed, subpoenaed, or fed into training pipelines. A privacy policy is a promise; Shadow replaces the promise with architecture:

- **The model runs on your device.** In the browser via WebGPU ([WebLLM](https://github.com/mlc-ai/web-llm)) with nothing to install, or against your local [Ollama](https://ollama.com). In local mode, nothing leaves your machine — so nothing can be logged, retained, subpoenaed, or trained on.
- **One chat, total memory.** No folders, no sessions, no starting over. Local embeddings retrieve your relevant history on every turn, and older history is distilled into a "deep memory" you can read, edit, or delete. The continuity *is* the product.
- **Encrypted at rest, erased by key.** Every record is AES-GCM encrypted with a key derived from your passphrase (Argon2id). There is no account and no server copy. "Delete everything" destroys the key — whatever bytes remain are noise.
- **The cloud is optional — and blind.** If you opt in to deeper responses (bring your own API key), a local model first redacts your text (names → roles, places → generic) and only the abstracted version is sent — the *privacy-conscious delegation* pattern from [PAPILLON (NAACL 2025)](https://arxiv.org/abs/2410.17127), productized.
- **Every inference call is metered.** Tokens, model, latency and cost per message ($0 when local), with export as [FOCUS](https://focus.finops.org/)-conformant billing data — the privacy router is also a cost router.

## How a message flows

1. Unlock: passphrase → Argon2id → unwraps the data key (held in memory only, auto-locks).
2. A local safety check runs (crisis lexicon → help resources shown; writing is never blocked).
3. Long-term memory: local embeddings (transformers.js) retrieve the most relevant past moments from the encrypted store.
4. The router scores the message for sensitivity and complexity, then picks a path:
   - **Local (default):** WebLLM in a worker, or Ollama on localhost. Streamed to the UI.
   - **Hybrid (opt-in + your own key):** local redaction → preview of the exact outgoing payload → cloud call → local re-personalization.
5. The call is metered (tokens, model, $, latency) into the cost dashboard and FOCUS export.
6. Message, reply and embeddings are AES-GCM encrypted and persisted to IndexedDB. Periodically, the local model distills older history into the editable, deletable deep memory.

## For teams

The same guarantee matters at work. Employees already paste confidential figures, code and strategy into AI chats — usually against policy, because the tools are useful. With Shadow, a team can use AI on confidential material with the guarantee made by architecture, not by contract: in local mode nothing leaves the employee's machine, nothing reaches anyone's servers, and nothing can train anyone's models. A policy-locked local-only mode for organizations is on the roadmap.

## What Shadow is not

Shadow is a private companion for thinking and reflection. It is **not therapy, not medical advice, and not a crisis service**, and it does not diagnose or treat anything. If you are struggling, please reach out: **988** (US) · **Línea de la Vida 800 911 2000** (MX) · your local emergency services. The app keeps these resources visible at all times.

## Roadmap

| Milestone | Deliverable | Status |
|---|---|---|
| M0 | README-first design + architecture decision records | ✅ |
| M1 | Local chat: React UI + Ollama adapter, streaming | — |
| M2 | Encryption at rest + cryptographic erase + encrypted export | — |
| M3 | The memory: local RAG over encrypted history + deep-memory view | — |
| M4 | Privacy/cost router + per-message metering + FOCUS export | — |
| M5 | Crisis resources, guided reflection packs (journaling, shadow work — es/en), in-browser WebLLM | — |
| M6 | v0.1.0 release + live demo on GitHub Pages | — |

## Related work

Shadow composes ideas that exist separately; none of the pieces below combine them:

- Odysseus, [Jan](https://github.com/janhq/jan), Open WebUI — excellent self-hosted AI workspaces you install and run on your own hardware. Shadow is the opposite shape: zero-install, one chat in a browser tab, encrypted at rest.
- [Memex](https://github.com/memex-lab/memex) — open-source local-first AI journal. Stores plaintext locally and sends raw prompts to whichever provider you configure; no encryption-at-rest, no redaction layer, no cost telemetry.
- [PAPILLON](https://arxiv.org/abs/2410.17127) — the academic prior for our router; a research pipeline, not a product.
- [RouteLLM](https://github.com/lm-sys/RouteLLM), NotDiamond — LLM routers optimizing cost/quality; privacy is not a routing dimension and there is no billing-standard export.
- [Standard Notes](https://standardnotes.com) — the model for honest client-side encryption in an open-source app (no AI).

## Stack

TypeScript monorepo: `packages/core` (storage, crypto, memory, router, metering — no UI) + `apps/web` (React PWA, deployable as a static site). Local inference through interchangeable adapters (WebLLM / Ollama / BYOK cloud). Embeddings via transformers.js. WebCrypto for AES-GCM and key derivation. Decisions and their reasoning live in [`docs/adr/`](./docs/adr/).

## AI transparency

Shadow is developed with AI assistance. Nothing is merged that the maintainer does not fully understand and stand behind. Design decisions are recorded as ADRs with their trade-offs.

## License

[Apache-2.0](./LICENSE)
