/**
 * Ollama chat backend — the local, dev-machine inference path.
 *
 * Talks to a locally running Ollama daemon (`localhost:11434` by
 * default) over `POST /api/chat` with streaming on. Because the daemon
 * runs on the user's own machine, nothing leaves the device on this
 * path — the architectural core of Shadow's promise (ADR-001).
 *
 * The NDJSON framing lives in `./ollama-stream`; this file owns the
 * fetch, the stream read loop, cancellation and error surfacing.
 */

import type {
  ChatBackend,
  ChatEvent,
  ChatMessage,
  ChatOptions,
  ChatUsage,
} from "./chat";
import { NdjsonBuffer, type OllamaChunk } from "./ollama-stream";

const DEFAULT_BASE_URL = "http://localhost:11434";

export interface OllamaConfig {
  /** The model tag to run, e.g. "qwen2.5:3b". */
  model: string;
  /** Daemon base URL; defaults to the local Ollama port. */
  baseUrl?: string;
  /** Injectable fetch, for tests. Defaults to the global. */
  fetch?: typeof fetch;
}

/** Thrown when the daemon is unreachable or returns a non-OK status. */
export class OllamaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OllamaError";
  }
}

export class OllamaBackend implements ChatBackend {
  readonly id = "ollama";
  readonly model: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(config: OllamaConfig) {
    this.model = config.model;
    this.#baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.#fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async *chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<ChatEvent> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, messages, stream: true }),
        signal: options.signal,
      });
    } catch (cause) {
      // A refused connection is the common case: Ollama isn't running.
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      throw new OllamaError(
        `Could not reach Ollama at ${this.#baseUrl}. Is it running?`,
      );
    }

    if (!response.ok) {
      throw new OllamaError(
        `Ollama returned ${response.status} ${response.statusText}`.trim(),
        response.status,
      );
    }
    if (!response.body) {
      throw new OllamaError("Ollama response had no body to stream");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const buffer = new NdjsonBuffer();
    const usage: ChatUsage = { inputTokens: 0, outputTokens: 0 };
    let complete = false;

    const drain = function* (chunks: OllamaChunk[]): Generator<ChatEvent> {
      for (const chunk of chunks) {
        if (chunk.content) yield { type: "delta", text: chunk.content };
        if (chunk.promptEvalCount !== undefined) usage.inputTokens = chunk.promptEvalCount;
        if (chunk.evalCount !== undefined) usage.outputTokens = chunk.evalCount;
        if (chunk.done) complete = true;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield* drain(buffer.push(decoder.decode(value, { stream: true })));
      }
      yield* drain(buffer.flush());
    } finally {
      reader.releaseLock();
    }

    // Only signal completion — and hand usage to the meter — when the
    // model actually finished. An interrupted stream ends silently.
    if (complete) yield { type: "done", usage };
  }
}
