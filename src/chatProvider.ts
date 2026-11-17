import * as vscode from "vscode";
import { ToolCallAccumulator, toChatMessages, toChatTools } from "./convert";
import type { GatewayModel } from "./gateway";
import { type OtariSession, describe } from "./session";
import type { SpendTracker } from "./spend";

const DEFAULT_CONTEXT = 128_000;
const DEFAULT_OUTPUT = 8_192;

export function toModelInformation(model: GatewayModel): vscode.LanguageModelChatInformation {
  const provider = model.id.includes(":") ? (model.id.split(":")[0] ?? "otari") : (model.owned_by ?? "otari");
  // models.dev leaves a field out when it does not know it: unknown is not unsupported, so tools default on.
  const tools = model.supported_parameters ? model.supported_parameters.includes("tools") : true;
  const images = model.architecture?.input_modalities?.includes("image") ?? false;
  return {
    id: model.id,
    name: model.name ?? model.id,
    family: provider,
    version: model.id,
    detail: provider,
    tooltip: `${model.id}, served through Otari`,
    maxInputTokens: model.context_window ?? DEFAULT_CONTEXT,
    maxOutputTokens: model.max_output_tokens ?? DEFAULT_OUTPUT,
    capabilities: { toolCalling: tools, imageInput: images },
  };
}

export class OtariChatProvider implements vscode.LanguageModelChatProvider {
  readonly onDidChangeLanguageModelChatInformation: vscode.Event<void>;

  constructor(
    private readonly session: OtariSession,
    private readonly spend: SpendTracker,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.onDidChangeLanguageModelChatInformation = session.onDidChange;
  }

  async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    if (!this.session.signedIn) {
      if (options.silent) return [];
      if (!(await this.session.signIn())) return [];
    }
    try {
      return (await this.session.chatModels()).map(toModelInformation);
    } catch (error) {
      this.log.error(`Listing models failed: ${describe(error)}`);
      if (!options.silent) void vscode.window.showErrorMessage(`Otari could not list models: ${describe(error)}`);
      return [];
    }
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const client = this.session.client();
    if (!client) throw new Error("Sign in to Otari first (Otari: Sign In).");

    const abort = new AbortController();
    const cancel = token.onCancellationRequested(() => abort.abort());
    const tags = vscode.workspace.getConfiguration("otari").get<Record<string, string>>("chat.tags", {});
    const tools = toChatTools(options.tools);
    const body: Record<string, unknown> = {
      ...pickModelOptions(options.modelOptions),
      model: model.id,
      messages: toChatMessages(messages),
      ...(tools ? { tools } : {}),
      ...(tools && options.toolMode === vscode.LanguageModelChatToolMode.Required ? { tool_choice: "required" } : {}),
      ...(Object.keys(tags).length ? { metadata: tags } : {}),
    };

    const calls = new ToolCallAccumulator();
    let cost: string | undefined;
    const flushCalls = () => {
      for (const call of calls.drain()) progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, call.input));
    };
    try {
      for await (const chunk of client.streamChat(body, abort.signal)) {
        for (const choice of chunk.choices ?? []) {
          if (choice.delta?.content) progress.report(new vscode.LanguageModelTextPart(choice.delta.content));
          for (const delta of choice.delta?.tool_calls ?? []) calls.add(delta);
          if (choice.finish_reason) flushCalls();
        }
        if (chunk.usage?.cost_usd !== undefined) cost = chunk.usage.cost_usd;
      }
      flushCalls();
    } catch (error) {
      if (token.isCancellationRequested) return;
      this.log.error(`Chat request to ${model.id} failed: ${describe(error)}`);
      throw new Error(`Otari: ${describe(error)}`);
    } finally {
      cancel.dispose();
      this.spend.record(model.id, cost);
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
  ): Promise<number> {
    // An estimate: the gateway serves many tokenizers and VS Code asks often, so a round trip per call is too slow.
    const value = typeof text === "string" ? text : JSON.stringify(toChatMessages([text]));
    return Math.ceil(value.length / 4);
  }
}

const PASSED_OPTIONS = ["temperature", "top_p", "max_tokens", "max_completion_tokens", "stop", "reasoning_effort"];

function pickModelOptions(options: { readonly [name: string]: unknown } | undefined): Record<string, unknown> {
  if (!options) return {};
  return Object.fromEntries(Object.entries(options).filter(([name]) => PASSED_OPTIONS.includes(name)));
}
