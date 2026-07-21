import { describe, expect, it, vi } from "vitest";

import type { ChatEvent } from "./chat";
import { OllamaBackend, OllamaError } from "./ollama";

// Real-shaped Ollama /api/chat NDJSON lines (each a complete line).
const delta = (content: string) =>
  JSON.stringify({
    model: "qwen2.5:3b",
    message: { role: "assistant", content },
    done: false,
  }) + "\n";

const FINAL =
  JSON.stringify({
    model: "qwen2.5:3b",
    message: { role: "assistant", content: "" },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 26,
    eval_count: 298,
  }) + "\n";

function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
}

/** A fetch stub that streams `pieces` back as the response body. */
function respondWith(pieces: string[], init?: ResponseInit): typeof fetch {
  return (async () => new Response(streamOf(pieces), init)) as unknown as typeof fetch;
}

async function collect(iter: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const ev of iter) events.push(ev);
  return events;
}

describe("OllamaBackend", () => {
  it("streams text deltas then a terminal done with usage", async () => {
    const backend = new OllamaBackend({
      model: "qwen2.5:3b",
      fetch: respondWith([delta("Hola "), delta("mundo"), FINAL]),
    });

    const events = await collect(backend.chat([{ role: "user", content: "hi" }]));

    expect(events).toEqual([
      { type: "delta", text: "Hola " },
      { type: "delta", text: "mundo" },
      { type: "done", usage: { inputTokens: 26, outputTokens: 298 } },
    ]);
  });

  it("reassembles deltas when the network tears lines mid-JSON", async () => {
    const whole = delta("Hola ") + delta("mundo") + FINAL;
    const torn = [whole.slice(0, 5), whole.slice(5, 42), whole.slice(42)];
    const backend = new OllamaBackend({
      model: "qwen2.5:3b",
      fetch: respondWith(torn),
    });

    const events = await collect(backend.chat([{ role: "user", content: "hi" }]));

    const text = events
      .filter((e): e is { type: "delta"; text: string } => e.type === "delta")
      .map((e) => e.text)
      .join("");
    expect(text).toBe("Hola mundo");
    expect(events.at(-1)).toEqual({
      type: "done",
      usage: { inputTokens: 26, outputTokens: 298 },
    });
  });

  it("ends without a done event when the stream is cut short", async () => {
    // No FINAL line: the model never signaled completion.
    const backend = new OllamaBackend({
      model: "qwen2.5:3b",
      fetch: respondWith([delta("Hola"), delta(" mun")]),
    });

    const events = await collect(backend.chat([{ role: "user", content: "hi" }]));

    expect(events.every((e) => e.type === "delta")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("throws OllamaError with the status on a non-OK response", async () => {
    const backend = new OllamaBackend({
      model: "qwen2.5:3b",
      fetch: respondWith([], { status: 500, statusText: "Internal Server Error" }),
    });

    await expect(collect(backend.chat([{ role: "user", content: "hi" }]))).rejects.toMatchObject(
      { name: "OllamaError", status: 500 },
    );
  });

  it("surfaces a friendly error when the daemon is unreachable", async () => {
    const refused = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const backend = new OllamaBackend({ model: "qwen2.5:3b", fetch: refused });

    await expect(collect(backend.chat([{ role: "user", content: "hi" }]))).rejects.toThrow(
      /Is it running\?/,
    );
  });

  it("propagates an abort instead of mislabeling it as unreachable", async () => {
    const aborting = (async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as unknown as typeof fetch;
    const backend = new OllamaBackend({ model: "qwen2.5:3b", fetch: aborting });

    await expect(
      collect(backend.chat([{ role: "user", content: "hi" }])),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("posts a streaming chat request with the model and messages", async () => {
    const spy = vi.fn(
      (_url: string, _init: RequestInit): Promise<Response> =>
        Promise.resolve(new Response(streamOf([FINAL]))),
    );
    const backend = new OllamaBackend({
      model: "qwen2.5:3b",
      baseUrl: "http://localhost:11434/",
      fetch: spy as unknown as typeof fetch,
    });

    await collect(backend.chat([{ role: "user", content: "hola" }]));

    expect(spy).toHaveBeenCalledOnce();
    const call = spy.mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe("http://localhost:11434/api/chat"); // trailing slash trimmed
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: "qwen2.5:3b",
      stream: true,
      messages: [{ role: "user", content: "hola" }],
    });
  });
});
