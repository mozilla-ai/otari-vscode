import * as vscode from "vscode";
import { GatewayClient, GatewayError, type GatewayModel, dashboardUrl, isChatModel } from "./gateway";

const SECRET = "otari.apiKey";
const MODEL_TTL_MS = 5 * 60 * 1000;

interface GatewayChoice extends vscode.QuickPickItem {
  url?: string;
}

/** The signed-in gateway and key. The key lives in VS Code's secret storage and nowhere else. */
export class OtariSession implements vscode.Disposable {
  private apiKey: string | undefined;
  private models: { at: number; url: string; list: Promise<GatewayModel[]> } | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly subscriptions: vscode.Disposable[] = [this.changed];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.subscriptions.push(
      context.secrets.onDidChange(async (event) => {
        if (event.key !== SECRET) return;
        this.apiKey = await context.secrets.get(SECRET);
        this.invalidate();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("otari.gatewayUrl") || event.affectsConfiguration("otari.chat.models")) {
          this.invalidate();
        }
      }),
    );
  }

  async load(): Promise<void> {
    this.apiKey = await this.context.secrets.get(SECRET);
  }

  get gatewayUrl(): string {
    return vscode.workspace.getConfiguration("otari").get<string>("gatewayUrl", "https://api.otari.ai");
  }

  get dashboardUrl(): string {
    return dashboardUrl(this.gatewayUrl, vscode.workspace.getConfiguration("otari").get<string>("dashboardUrl", ""));
  }

  get signedIn(): boolean {
    return Boolean(this.apiKey);
  }

  get key(): string | undefined {
    return this.apiKey;
  }

  client(): GatewayClient | undefined {
    return this.apiKey ? new GatewayClient(this.gatewayUrl, this.apiKey) : undefined;
  }

  /** The chat models this key can call, cached for a few minutes and narrowed by `otari.chat.models`. */
  async chatModels(): Promise<GatewayModel[]> {
    const client = this.client();
    if (!client) return [];
    const now = Date.now();
    if (!this.models || this.models.url !== this.gatewayUrl || now - this.models.at > MODEL_TTL_MS) {
      const list = client.listModels();
      this.models = { at: now, url: this.gatewayUrl, list };
      list.catch(() => {
        if (this.models?.list === list) this.models = undefined;
      });
    }
    const wanted = vscode.workspace.getConfiguration("otari").get<string[]>("chat.models", []);
    const models = (await this.models.list).filter(isChatModel);
    return wanted.length ? models.filter((model) => wanted.includes(model.id)) : models;
  }

  invalidate(): void {
    this.models = undefined;
    this.changed.fire();
  }

  /** Prompts for the gateway and key, unless a script passes both (`otari.signIn` with `{ gatewayUrl, apiKey }`). */
  async signIn(given?: { gatewayUrl?: unknown; apiKey?: unknown }): Promise<boolean> {
    const scripted = typeof given?.gatewayUrl === "string" && typeof given.apiKey === "string";
    const gateway = scripted ? (given.gatewayUrl as string) : await this.pickGateway();
    if (!gateway) return false;

    const key = scripted
      ? (given.apiKey as string)
      : await vscode.window.showInputBox({
          title: "Otari API key",
          prompt: `An API key from ${gateway}. It is kept in VS Code's secret storage.`,
          password: true,
          ignoreFocusOut: true,
          validateInput: (value) => (value.trim() ? undefined : "Paste an API key"),
        });
    if (!key) return false;

    let url = gateway;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Checking the key with Otari" },
        () => new GatewayClient(url, key.trim()).listModels(),
      );
    } catch (error) {
      const host = error instanceof GatewayError ? error.misdirectedHost : undefined;
      if (!host) {
        void vscode.window.showErrorMessage(`Otari did not accept the key: ${describe(error)}`);
        return false;
      }
      // otari.ai answers a key from another region with 421 naming the right host.
      const move = await vscode.window.showWarningMessage(
        `This key belongs to ${host}. Use that gateway instead?`,
        "Use it",
        "Cancel",
      );
      if (move !== "Use it") return false;
      url = `https://${host}`;
    }

    await vscode.workspace.getConfiguration("otari").update("gatewayUrl", url, vscode.ConfigurationTarget.Global);
    await this.context.secrets.store(SECRET, key.trim());
    this.apiKey = key.trim();
    this.invalidate();
    void vscode.window.showInformationMessage(`Signed in to Otari at ${url}.`);
    return true;
  }

  async signOut(): Promise<void> {
    await this.context.secrets.delete(SECRET);
    this.apiKey = undefined;
    this.invalidate();
  }

  private async pickGateway(): Promise<string | undefined> {
    const current = this.gatewayUrl;
    const choices: GatewayChoice[] = [
      { label: "otari.ai", description: "https://api.otari.ai", url: "https://api.otari.ai" },
      { label: "otari.ai, EU region", description: "https://eu.api.otari.ai", url: "https://eu.api.otari.ai" },
      { label: "Your own gateway…", description: "Any Otari deployment" },
    ];
    for (const choice of choices) if (choice.url === current) choice.detail = "Current";
    const picked = await vscode.window.showQuickPick(choices, { title: "Which Otari?", ignoreFocusOut: true });
    if (!picked) return undefined;
    if (picked.url) return picked.url;
    const custom = choices.some((choice) => choice.url === current) ? "http://localhost:8000" : current;
    return vscode.window.showInputBox({
      title: "Gateway URL",
      prompt: "The gateway's base URL, without /api/v1",
      value: custom,
      ignoreFocusOut: true,
      validateInput: (value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === "http:" || parsed.protocol === "https:" ? undefined : "Use an http or https URL";
        } catch {
          return "Enter a URL, such as http://localhost:8000";
        }
      },
    });
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}

export function describe(error: unknown): string {
  if (error instanceof GatewayError) {
    if (error.status === 401) return "the API key was refused. Sign in again with a valid key.";
    if (error.status === 402) return `the budget or wallet is exhausted (${error.detail})`;
    if (error.status === 421) return error.detail;
    return `${error.status}: ${error.detail}`;
  }
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: string } }).cause?.code;
    return cause ? `${error.message} (${cause})` : error.message;
  }
  return String(error);
}
