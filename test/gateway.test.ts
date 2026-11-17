import { describe, expect, it } from "vitest";
import { GatewayClient, GatewayError, anthropicBaseUrl, apiRoot, dashboardUrl, isChatModel } from "../src/gateway";

function sse(...events: string[]): Response {
  return new Response(events.map((event) => `data: ${event}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
}

describe("URLs", () => {
  it("builds the API root from any spelling of the base URL", () => {
    for (const url of ["https://api.otari.ai", "https://api.otari.ai/", "https://api.otari.ai/api", "https://api.otari.ai/api/v1"]) {
      expect(apiRoot(url)).toBe("https://api.otari.ai/api/v1");
    }
    expect(anthropicBaseUrl("http://localhost:8000")).toBe("http://localhost:8000/api");
  });

  it("picks the dashboard", () => {
    expect(dashboardUrl("https://eu.api.otari.ai", "")).toBe("https://otari.ai/dashboard");
    expect(dashboardUrl("http://localhost:8000/", "")).toBe("http://localhost:8000");
    expect(dashboardUrl("http://localhost:8000", "http://x")).toBe("http://x");
  });
});

describe("GatewayClient", () => {
  it("lists models with the key as a bearer token", async () => {
    let seen: RequestInit | undefined;
    const client = new GatewayClient("http://gw", "tk-1", async (_url, init) => {
      seen = init;
      return Response.json({ data: [{ id: "openai:gpt-5", type: "chat" }, { id: "openai:embed", type: "embedding" }] });
    });
    const models = await client.listModels();
    expect((seen?.headers as Record<string, string>).Authorization).toBe("Bearer tk-1");
    expect(models.filter(isChatModel).map((model) => model.id)).toEqual(["openai:gpt-5"]);
  });

  it("names the right region on a 421", async () => {
    const client = new GatewayClient("https://api.otari.ai", "tk", async () =>
      Response.json({ detail: "This API key belongs to eu.api.otari.ai. Send the request there instead." }, { status: 421 }),
    );
    const error = await client.listModels().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).misdirectedHost).toBe("eu.api.otari.ai");
  });

  it("reads an OpenAI-shaped error", async () => {
    const client = new GatewayClient("http://gw", "tk", async () => Response.json({ error: { message: "Budget exceeded" } }, { status: 402 }));
    await expect(client.listModels()).rejects.toMatchObject({ status: 402, detail: "Budget exceeded" });
  });

  it("streams chat chunks with usage requested", async () => {
    let body: Record<string, unknown> = {};
    const client = new GatewayClient("http://gw", "tk", async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return sse('{"choices":[{"index":0,"delta":{"content":"Hi"}}]}', '{"choices":[],"usage":{"cost_usd":"0.000120"}}', "[DONE]");
    });
    const chunks = [];
    for await (const chunk of client.streamChat({ model: "m", messages: [] })) chunks.push(chunk);
    expect(body).toMatchObject({ model: "m", stream: true, stream_options: { include_usage: true } });
    expect(chunks.map((chunk) => chunk.usage?.cost_usd ?? chunk.choices?.[0]?.delta?.content)).toEqual(["Hi", "0.000120"]);
  });

  it("raises an error event inside the stream", async () => {
    const client = new GatewayClient("http://gw", "tk", async () => sse('{"error":{"message":"provider down"}}'));
    const consume = async () => {
      for await (const _ of client.streamChat({})) {
        // drain
      }
    };
    await expect(consume()).rejects.toThrow("provider down");
  });
});
