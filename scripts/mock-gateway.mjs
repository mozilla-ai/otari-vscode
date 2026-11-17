// A stand-in Otari for trying the extension without a real key or spend: `node scripts/mock-gateway.mjs [port]`.
// It lists two models, streams back what you said, and calls the first tool it is offered when you ask it to
// "use a tool". Any API key is accepted except "bad", which is refused with 401, and "eu", which gets a 421.
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8787);
const MODELS = [
  { id: "mock:fast", object: "model", created: 0, owned_by: "mock", name: "Mock Fast", type: "chat", context_window: 32000, max_output_tokens: 4096, supported_parameters: ["tools"] },
  { id: "mock:embed", object: "model", created: 0, owned_by: "mock", type: "embedding" },
];

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function lastUserText(messages) {
  const user = [...messages].reverse().find((message) => message.role === "user" || message.role === "tool");
  if (!user) return "";
  return typeof user.content === "string" ? user.content : JSON.stringify(user.content);
}

createServer(async (req, res) => {
  const key = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (key === "bad") return send(res, 401, { detail: "Invalid API key" });
  if (key === "eu") return send(res, 421, { detail: "This API key belongs to localhost:8787. Send the request there instead." });
  if (req.method === "GET" && req.url === "/api/v1/models") return send(res, 200, { object: "list", data: MODELS });
  if (req.method === "POST" && req.url === "/api/v1/chat/completions") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    console.log(`chat ${body.model}: ${body.messages.length} message(s), ${body.tools?.length ?? 0} tool(s), tags ${JSON.stringify(body.metadata ?? {})}`);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Otari-Request-ID": `mock-${Date.now()}` });
    const emit = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    const text = lastUserText(body.messages);
    const last = body.messages.at(-1);
    if (body.tools?.length && last?.role === "user" && /use a tool/i.test(text)) {
      const name = body.tools[0].function.name;
      emit({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name, arguments: "{" } }] } }] });
      emit({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] }, finish_reason: "tool_calls" }] });
    } else {
      const reply = last?.role === "tool" ? `The tool answered: ${text.slice(0, 200)}` : `You said: ${text.slice(0, 500)}`;
      for (const word of reply.split(/(?<= )/)) {
        emit({ choices: [{ index: 0, delta: { content: word } }] });
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      emit({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    }
    emit({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, cost_usd: "0.001230", pricing_source: "deployment" } });
    res.end("data: [DONE]\n\n");
    return;
  }
  send(res, 404, { detail: "Not found" });
}).listen(port, () => console.log(`Mock Otari on http://localhost:${port}`));
