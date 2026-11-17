// Runs the real client against scripts/mock-gateway.mjs over HTTP, the way the extension talks to a gateway.
import { type ChildProcess, spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ToolCallAccumulator } from "../src/convert";
import { GatewayClient } from "../src/gateway";

const PORT = 18787;
let server: ChildProcess;

beforeAll(async () => {
  server = spawn(process.execPath, ["scripts/mock-gateway.mjs", String(PORT)]);
  await new Promise<void>((resolve) => server.stdout?.once("data", () => resolve()));
});
afterAll(() => {
  server.kill();
});

describe("against the mock gateway", () => {
  const client = new GatewayClient(`http://localhost:${PORT}`, "tk");

  it("streams text and reports the cost", async () => {
    let text = "";
    let cost: string | undefined;
    for await (const chunk of client.streamChat({ model: "mock:fast", messages: [{ role: "user", content: "hello there" }] })) {
      text += chunk.choices?.[0]?.delta?.content ?? "";
      cost = chunk.usage?.cost_usd ?? cost;
    }
    expect(text).toBe("You said: hello there");
    expect(cost).toBe("0.001230");
  });

  it("assembles a streamed tool call", async () => {
    const calls = new ToolCallAccumulator();
    const tools = [{ type: "function", function: { name: "now", parameters: { type: "object" } } }];
    for await (const chunk of client.streamChat({ model: "mock:fast", tools, messages: [{ role: "user", content: "use a tool" }] })) {
      for (const delta of chunk.choices?.[0]?.delta?.tool_calls ?? []) calls.add(delta);
    }
    expect(calls.drain()).toEqual([{ id: "call_1", name: "now", input: {} }]);
  });

  it("is refused with a bad key", async () => {
    await expect(new GatewayClient(`http://localhost:${PORT}`, "bad").listModels()).rejects.toMatchObject({ status: 401 });
  });
});
