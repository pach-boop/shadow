/**
 * The inference seam (ADR-001). One interface, three implementations:
 * `ollama` (this milestone), `webllm` (in-browser), and a redacting
 * `cloud` adapter (ADR-002). The UI and the cost meter depend only on
 * this interface, never on a concrete backend.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Token counts for one exchange — the input the M4 cost meter reads. */
export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * A streamed turn is a sequence of `delta` events and, when the model
 * finishes cleanly, a terminal `done` carrying usage. A stream cut
 * short (network drop, abort) simply ends without a `done` — the
 * absence is the signal that the turn was incomplete, so the meter
 * never records phantom zero-token usage.
 */
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "done"; usage: ChatUsage };

export interface ChatOptions {
  /** Abort the in-flight turn; the async iterator rejects with the signal's reason. */
  signal?: AbortSignal;
}

export interface ChatBackend {
  /** Stable identifier for logging and cost attribution, e.g. "ollama". */
  readonly id: string;
  /** The model this backend will run, e.g. "qwen2.5:3b". */
  readonly model: string;
  chat(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatEvent>;
}
