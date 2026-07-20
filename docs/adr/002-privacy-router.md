# ADR-002: Privacy-conscious delegation router (local by default, redact before cloud)

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Shadow's central trade-off: privacy pushes toward small on-device models
(≈3-4B quantized in a browser, somewhat larger via Ollama), while answer
quality on hard questions pushes toward frontier cloud models. The naive
resolutions both fail:

- **Local-only forever** caps quality. Users who hit that ceiling will
  paste their most sensitive question into a cloud chatbot anyway —
  outside Shadow, with zero protection. The product would have exported
  exactly the behavior it exists to prevent.
- **Cloud by default** inverts the promise. "Your words never leave your
  machine" cannot coexist with a default network path.

The claim "nothing leaves your device" must therefore survive the moment
a user genuinely needs a better answer.

## Decision

A router scores every message on two signals and picks a path:

1. **Sensitivity** — does the raw text carry names, places, identifying
   or intimate detail? In a personal companion the prior is *high*;
   detection only lowers it, never the reverse.
2. **Need** — is the local model likely sufficient? (Length, task shape,
   an explicit "deeper answer" request from the user.)

Paths:

- **Local (default, and the only path unless the user opts in):**
  WebLLM or Ollama. Nothing leaves the device, ever.
- **Hybrid (opt-in + user's own API key):** before any network call, the
  *local* model rewrites the outgoing text — names → roles, places →
  generic, unique details → abstracted. Only the redacted brief is sent;
  the mapping used to re-personalize the answer never leaves the device.
  The user can preview the exact outgoing payload before it goes.

Every call on every path is metered (tokens, model, latency, cost — $0
when local) and exportable as FOCUS rows, so the privacy router doubles
as a cost router.

This is the *privacy-conscious delegation* pattern from PAPILLON
(NAACL 2025), productized. PAPILLON reports ~85% quality retention with
~7.5% privacy leakage on its benchmark — those figures set the reference
bar for our own leakage evaluation.

## Alternatives considered

- **Cost/quality-only routing (RouteLLM, NotDiamond).** Mature prior
  art, but privacy is not a routing dimension in any of them — for
  Shadow it is *the* dimension. Rejected as the primary criterion;
  their cost lens survives in the metering.
- **Cloud by default with local fallback.** Best answers, dead promise.
  Rejected outright.
- **No cloud path at all.** Simplest honest story, but see Context —
  it pushes the hardest questions out of the product's protection.
- **Confidential computing / TEEs for server-side inference.** Would
  let a server compute without reading plaintext, but requires exactly
  the infrastructure Shadow promises not to have (ADR-001: no backend),
  plus attestation UX no consumer can audit. Out of scope; revisit only
  if a zero-backend deployment of it ever becomes practical.

## Consequences

- (+) Hard questions get frontier quality without surrendering raw text;
  the promise stays architectural rather than contractual.
- (+) Leakage is measurable: a synthetic-PII evaluation against the
  PAPILLON reference figures becomes the acceptance gate before the
  hybrid path ships enabled (M4/M5 criterion).
- (+) Metering on every path feeds the FOCUS export — one seam for both
  guarantees (privacy and cost).
- (−) The hybrid path adds latency: a local classify-and-redact pass in
  front of the cloud call. Acceptable for a reflective journaling
  cadence; would be wrong for a latency-critical product.
- (−) Redaction is imperfect by nature. Mitigations: sensitivity prior
  stays high, the preview shows the exact payload, and the leakage eval
  is a release gate, not a dashboard vanity metric.
- (−) Two paths mean more UX surface (opt-in flow, preview, per-message
  path indicator). The indicator doubles as the trust signal, so this
  cost buys visibility rather than pure complexity.
