// Translation between VS Code's language model messages and Chat Completions. Parts are matched by shape rather than
// `instanceof`, so this runs (and is tested) without the `vscode` module.

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<Record<string, unknown>> | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

export interface RequestMessage {
  role: number;
  content: ReadonlyArray<unknown>;
  name?: string | undefined;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: object | undefined;
}

// LanguageModelChatMessageRole: User = 1, Assistant = 2, and System = 3 where VS Code sends one.
const ASSISTANT = 2;
const SYSTEM = 3;

type Part =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string }
  | { kind: "toolCall"; id: string; name: string; input: unknown }
  | { kind: "toolResult"; id: string; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function partText(value: unknown): string {
  if (isRecord(value) && typeof value.value === "string") return value.value;
  if (typeof value === "string") return value;
  if (isRecord(value) && "value" in value) return JSON.stringify(value.value);
  return JSON.stringify(value);
}

function classify(part: unknown): Part | undefined {
  if (!isRecord(part)) return undefined;
  if (typeof part.callId === "string" && typeof part.name === "string" && "input" in part) {
    return { kind: "toolCall", id: part.callId, name: part.name, input: part.input };
  }
  if (typeof part.callId === "string" && Array.isArray(part.content)) {
    return { kind: "toolResult", id: part.callId, text: part.content.map(partText).join("") };
  }
  if (typeof part.mimeType === "string" && part.data instanceof Uint8Array) {
    if (part.mimeType.startsWith("image/")) {
      return { kind: "image", url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}` };
    }
    if (part.mimeType.startsWith("text/") || part.mimeType === "application/json") {
      return { kind: "text", text: Buffer.from(part.data).toString("utf8") };
    }
    return undefined;
  }
  if (typeof part.value === "string") return { kind: "text", text: part.value };
  return undefined;
}

export function toChatMessages(messages: readonly RequestMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of messages) {
    const parts = message.content.map(classify).filter((part): part is Part => part !== undefined);
    const text = parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("");

    if (message.role === SYSTEM) {
      out.push({ role: "system", content: text });
      continue;
    }
    if (message.role === ASSISTANT) {
      const calls = parts.flatMap((part) =>
        part.kind === "toolCall"
          ? [{ id: part.id, type: "function" as const, function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) } }]
          : [],
      );
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }

    // A user turn carries the results of the previous turn's tool calls, which Chat Completions wants as
    // `tool` messages directly after the assistant message that asked for them.
    for (const part of parts) {
      if (part.kind === "toolResult") out.push({ role: "tool", tool_call_id: part.id, content: part.text });
    }
    const images = parts.flatMap((part) => (part.kind === "image" ? [part.url] : []));
    if (images.length) {
      out.push({
        role: "user",
        content: [
          ...(text ? [{ type: "text", text }] : []),
          ...images.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      });
    } else if (text) {
      out.push({ role: "user", content: text });
    }
  }
  return out;
}

export function toChatTools(tools: readonly ToolDefinition[] | undefined): Array<Record<string, unknown>> | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: "object", properties: {} },
    },
  }));
}

export interface CompletedToolCall {
  id: string;
  name: string;
  input: object;
}

/** Assembles streamed tool call fragments, which arrive keyed by index with the arguments split across chunks. */
export class ToolCallAccumulator {
  private readonly calls = new Map<number, { id: string; name: string; args: string }>();

  add(delta: { index: number; id?: string; function?: { name?: string; arguments?: string } }): void {
    const call = this.calls.get(delta.index) ?? { id: "", name: "", args: "" };
    if (delta.id) call.id = delta.id;
    if (delta.function?.name) call.name += delta.function.name;
    if (delta.function?.arguments) call.args += delta.function.arguments;
    this.calls.set(delta.index, call);
  }

  drain(): CompletedToolCall[] {
    const done = [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call]) => {
        let input: object = {};
        if (call.args.trim()) {
          const parsed: unknown = JSON.parse(call.args);
          input = isRecord(parsed) ? parsed : { value: parsed };
        }
        return { id: call.id || `call_${index}`, name: call.name, input };
      });
    this.calls.clear();
    return done;
  }
}
