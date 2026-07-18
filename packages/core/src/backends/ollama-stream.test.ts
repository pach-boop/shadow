import { describe, expect, it } from "vitest";

import { NdjsonBuffer, parseOllamaLine } from "./ollama-stream";

// Real-shaped Ollama /api/chat stream lines.
const delta = (content: string) =>
  JSON.stringify({
    model: "qwen2.5:3b",
    created_at: "2026-07-17T20:00:00.000Z",
    message: { role: "assistant", content },
    done: false,
  });

const FINAL = JSON.stringify({
  model: "qwen2.5:3b",
  created_at: "2026-07-17T20:00:02.000Z",
  message: { role: "assistant", content: "" },
  done_reason: "stop",
  done: true,
  prompt_eval_count: 26,
  eval_count: 298,
});

describe("parseOllamaLine", () => {
  it("extracts the content delta from a streaming line", () => {
    expect(parseOllamaLine(delta("Hola"))).toEqual({ content: "Hola", done: false });
  });

  it("reads token counts off the final line", () => {
    expect(parseOllamaLine(FINAL)).toEqual({
      content: "",
      done: true,
      promptEvalCount: 26,
      evalCount: 298,
    });
  });

  it("yields null for blank and non-JSON lines instead of throwing", () => {
    expect(parseOllamaLine("")).toBeNull();
    expect(parseOllamaLine("   ")).toBeNull();
    expect(parseOllamaLine("not json at all")).toBeNull();
  });
});

describe("NdjsonBuffer", () => {
  it("reassembles a line torn across network chunks", () => {
    const buffer = new NdjsonBuffer();
    const line = delta("Hola, ");

    // Tear mid-JSON: nothing complete yet, then the line closes.
    expect(buffer.push(line.slice(0, 10))).toEqual([]);
    const chunks = buffer.push(line.slice(10) + "\n" + delta("sombra").slice(0, 5));
    expect(chunks).toEqual([{ content: "Hola, ", done: false }]);
  });

  it("parses a multi-line chunk in order and keeps the partial tail", () => {
    const buffer = new NdjsonBuffer();

    const chunks = buffer.push(`${delta("a")}\n${delta("b")}\n${FINAL.slice(0, 8)}`);

    expect(chunks.map((c) => c.content)).toEqual(["a", "b"]);
  });

  it("flush recovers a final line without a trailing newline", () => {
    const buffer = new NdjsonBuffer();
    buffer.push(FINAL); // no newline: stays buffered

    const chunks = buffer.flush();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ done: true, evalCount: 298 });
    expect(buffer.flush()).toEqual([]); // buffer is spent
  });
});
