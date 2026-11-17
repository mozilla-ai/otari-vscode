import { describe, expect, it } from "vitest";
import { ToolCallAccumulator, toChatMessages, toChatTools } from "../src/convert";

const text = (value: string) => ({ value });

describe("toChatMessages", () => {
  it("maps user and assistant text", () => {
    expect(
      toChatMessages([
        { role: 1, content: [text("Hi "), text("there")] },
        { role: 2, content: [text("Hello")] },
      ]),
    ).toEqual([
      { role: "user", content: "Hi there" },
      { role: "assistant", content: "Hello" },
    ]);
  });

  it("maps a tool call and its result", () => {
    expect(
      toChatMessages([
        { role: 2, content: [{ callId: "c1", name: "read", input: { path: "a.ts" } }] },
        { role: 1, content: [{ callId: "c1", content: [text("file body")] }, text("now fix it")] },
      ]),
    ).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: '{"path":"a.ts"}' } }],
      },
      { role: "tool", tool_call_id: "c1", content: "file body" },
      { role: "user", content: "now fix it" },
    ]);
  });

  it("maps a system message and images", () => {
    const image = { mimeType: "image/png", data: new Uint8Array([1, 2, 3]) };
    expect(toChatMessages([{ role: 3, content: [text("Be brief")] }, { role: 1, content: [text("What is this?"), image] }])).toEqual([
      { role: "system", content: "Be brief" },
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
        ],
      },
    ]);
  });

  it("drops parts it does not know", () => {
    expect(toChatMessages([{ role: 1, content: [42, null, { mimeType: "application/zip", data: new Uint8Array() }] }])).toEqual([]);
  });
});

describe("toChatTools", () => {
  it("returns nothing for no tools", () => {
    expect(toChatTools([])).toBeUndefined();
  });

  it("defaults a missing schema to an empty object", () => {
    expect(toChatTools([{ name: "now", description: "time" }])).toEqual([
      { type: "function", function: { name: "now", description: "time", parameters: { type: "object", properties: {} } } },
    ]);
  });
});

describe("ToolCallAccumulator", () => {
  it("joins fragmented arguments per index", () => {
    const calls = new ToolCallAccumulator();
    calls.add({ index: 0, id: "a", function: { name: "read", arguments: '{"pa' } });
    calls.add({ index: 1, id: "b", function: { name: "list", arguments: "" } });
    calls.add({ index: 0, function: { arguments: 'th":"x"}' } });
    expect(calls.drain()).toEqual([
      { id: "a", name: "read", input: { path: "x" } },
      { id: "b", name: "list", input: {} },
    ]);
    expect(calls.drain()).toEqual([]);
  });

  it("throws on arguments that are not JSON", () => {
    const calls = new ToolCallAccumulator();
    calls.add({ index: 0, id: "a", function: { name: "read", arguments: "{oops" } });
    expect(() => calls.drain()).toThrow();
  });
});
