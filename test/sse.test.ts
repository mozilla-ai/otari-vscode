import { describe, expect, it } from "vitest";
import { parseSse } from "../src/sse";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const data of parseSse(stream)) out.push(data);
  return out;
}

describe("parseSse", () => {
  it("yields each event's data, split across chunks", async () => {
    expect(await collect(streamOf('data: {"a":', "1}\n\ndata: [DONE]\n\n"))).toEqual(['{"a":1}', "[DONE]"]);
  });

  it("handles CRLF, comments and multi-line data", async () => {
    expect(await collect(streamOf(": ping\r\n\r\ndata: one\r\ndata: two\r\n\r\n"))).toEqual(["one\ntwo"]);
  });

  it("yields a final event with no trailing blank line", async () => {
    expect(await collect(streamOf("data: last"))).toEqual(["last"]);
  });
});
