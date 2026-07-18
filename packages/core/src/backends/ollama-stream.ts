/**
 * Framing and parsing for Ollama's streaming chat endpoint
 * (`POST /api/chat`).
 *
 * Ollama streams newline-delimited JSON: one object per line carrying a
 * `message.content` delta, then a final line with `done: true` and the
 * token counts. Network chunks tear lines at arbitrary points, so the
 * fetch layer (M1) pushes raw text here and this buffer owns the
 * framing — the UI never sees a torn line, and the cost meter (M4)
 * reads its token counts off the final chunk.
 */

export interface OllamaChunk {
  /** Text delta for this chunk (empty on the final line). */
  content: string;
  /** True on the terminating line of a response. */
  done: boolean;
  /** Input tokens — reported by Ollama on the final chunk only. */
  promptEvalCount?: number;
  /** Output tokens — reported by Ollama on the final chunk only. */
  evalCount?: number;
}

/** Parse one NDJSON line; blank or non-JSON lines yield null. */
export function parseOllamaLine(line: string): OllamaChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const message = data["message"] as { content?: unknown } | undefined;
  const chunk: OllamaChunk = {
    content: typeof message?.content === "string" ? message.content : "",
    done: data["done"] === true,
  };
  if (typeof data["prompt_eval_count"] === "number") {
    chunk.promptEvalCount = data["prompt_eval_count"];
  }
  if (typeof data["eval_count"] === "number") {
    chunk.evalCount = data["eval_count"];
  }
  return chunk;
}

/**
 * Reassembles NDJSON lines from arbitrarily torn network chunks.
 * Push raw text as it arrives; complete lines come back parsed and in
 * order. Call {@link NdjsonBuffer.flush} when the stream closes to
 * recover a final line without a trailing newline.
 */
export class NdjsonBuffer {
  #partial = "";

  push(text: string): OllamaChunk[] {
    this.#partial += text;
    const lines = this.#partial.split("\n");
    this.#partial = lines.pop() ?? "";
    return lines
      .map(parseOllamaLine)
      .filter((chunk): chunk is OllamaChunk => chunk !== null);
  }

  flush(): OllamaChunk[] {
    const rest = this.#partial;
    this.#partial = "";
    const parsed = parseOllamaLine(rest);
    return parsed ? [parsed] : [];
  }
}
