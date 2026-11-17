// HTTP client for the parts of the Otari API the extension uses. No `vscode` import, so it is unit tested directly.
import { parseSse } from "./sse";

export interface GatewayModel {
  id: string;
  name?: string;
  owned_by?: string;
  type?: string;
  context_window?: number;
  max_output_tokens?: number;
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
}

export interface ChatToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export interface ChatChunk {
  choices?: Array<{
    index: number;
    delta?: { content?: string | null; tool_calls?: ChatToolCallDelta[] };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost_usd?: string } | null;
}

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Otari answered ${status}: ${detail}`);
  }

  /** The host a 421 names: otari.ai serves a key only in the region that minted it. */
  get misdirectedHost(): string | undefined {
    if (this.status !== 421) return undefined;
    return /belongs to (\S+?)\.?\s+Send/.exec(this.detail)?.[1];
  }
}

export function apiRoot(gatewayUrl: string): string {
  return `${gatewayUrl.trim().replace(/\/+$/, "").replace(/\/api(\/v1)?$/, "")}/api/v1`;
}

/** The Anthropic base URL Claude Code wants: it appends `/v1/messages` itself. */
export function anthropicBaseUrl(gatewayUrl: string): string {
  return apiRoot(gatewayUrl).replace(/\/v1$/, "");
}

export function isOtariAi(gatewayUrl: string): boolean {
  try {
    const host = new URL(gatewayUrl).hostname;
    return host === "otari.ai" || host.endsWith(".otari.ai");
  } catch {
    return false;
  }
}

export function dashboardUrl(gatewayUrl: string, configured: string): string {
  if (configured.trim()) return configured.trim();
  return isOtariAi(gatewayUrl) ? "https://otari.ai/dashboard" : gatewayUrl.trim().replace(/\/+$/, "");
}

/** Chat models only: the listing also carries embedding, rerank and other kinds the chat API refuses. */
export function isChatModel(model: GatewayModel): boolean {
  return model.type === undefined || model.type === "chat";
}

async function errorFrom(response: Response): Promise<GatewayError> {
  const text = await response.text().catch(() => "");
  let detail = text || response.statusText;
  try {
    const body = JSON.parse(text) as { detail?: unknown; error?: { message?: string } };
    if (typeof body.detail === "string") detail = body.detail;
    else if (body.error?.message) detail = body.error.message;
    else if (body.detail !== undefined) detail = JSON.stringify(body.detail);
  } catch {
    // Not JSON; keep the text.
  }
  return new GatewayError(response.status, detail);
}

export class GatewayClient {
  constructor(
    private readonly gatewayUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, "User-Agent": "otari-vscode", ...extra };
  }

  async listModels(signal?: AbortSignal): Promise<GatewayModel[]> {
    const response = await this.fetchImpl(`${apiRoot(this.gatewayUrl)}/models`, { headers: this.headers(), signal });
    if (!response.ok) throw await errorFrom(response);
    const body = (await response.json()) as { data?: GatewayModel[] };
    return body.data ?? [];
  }

  async *streamChat(body: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<ChatChunk> {
    const response = await this.fetchImpl(`${apiRoot(this.gatewayUrl)}/chat/completions`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json", Accept: "text/event-stream" }),
      body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
      signal,
    });
    if (!response.ok || !response.body) throw await errorFrom(response);
    for await (const data of parseSse(response.body)) {
      if (data === "[DONE]") return;
      const chunk = JSON.parse(data) as ChatChunk & { error?: { message?: string } };
      if (chunk.error) throw new GatewayError(response.status, chunk.error.message ?? JSON.stringify(chunk.error));
      yield chunk;
    }
  }
}
