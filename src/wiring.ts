import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  CODEX_PROFILE,
  type EnvVar,
  claudeCodeEnv,
  codexConfigBlock,
  codexHasOtari,
  mergeEnv,
  openAiCompatibleSettings,
  withoutOtariEnv,
} from "./agentConfig";
import { apiRoot, isOtariAi } from "./gateway";
import { type OtariSession, describe } from "./session";

const TERMINALS_ON = "otari.routeTerminals";
const CLAUDE_SETTING = "claudeCode.environmentVariables";
const DOCS = "https://github.com/mozilla-ai/otari/blob/main/docs";

type Target = "terminals" | "claudeExtension" | "codex" | "other" | "stop";

/** Points coding agents at Otari: Claude Code, Codex, and anything that takes an OpenAI-compatible endpoint. */
export class AgentWiring implements vscode.Disposable {
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly session: OtariSession,
  ) {
    // The terminal variables hold the key, so they are kept in memory and rebuilt from secret storage each start.
    context.environmentVariableCollection.persistent = false;
    context.environmentVariableCollection.description = "Routes Claude Code and Codex through Otari";
    this.subscription = session.onDidChange(() => this.applyTerminals());
    this.applyTerminals();
  }

  private get terminalsOn(): boolean {
    return this.context.globalState.get<boolean>(TERMINALS_ON, false);
  }

  private applyTerminals(): void {
    const collection = this.context.environmentVariableCollection;
    collection.clear();
    const key = this.session.key;
    if (!this.terminalsOn || !key) return;
    const tags = vscode.workspace.getConfiguration("otari").get<Record<string, string>>("chat.tags", {});
    for (const env of claudeCodeEnv(this.session.gatewayUrl, key, tags)) collection.replace(env.name, env.value);
    collection.replace("OTARI_API_KEY", key);
    collection.replace("OTARI_BASE_URL", apiRoot(this.session.gatewayUrl));
  }

  async route(): Promise<void> {
    if (!this.session.signedIn && !(await this.session.signIn())) return;
    const items: Array<vscode.QuickPickItem & { target: Target }> = [
      {
        target: "terminals",
        label: "Terminals in VS Code",
        description: this.terminalsOn ? "On" : undefined,
        detail: "Claude Code and Codex CLIs started in a new integrated terminal use Otari. The key stays in memory.",
      },
      {
        target: "claudeExtension",
        label: "Claude Code extension",
        detail: `Writes ANTHROPIC_BASE_URL and your key to the ${CLAUDE_SETTING} user setting.`,
      },
      {
        target: "codex",
        label: "Codex",
        detail: `Adds an "${CODEX_PROFILE}" profile to ~/.codex/config.toml. Run codex --profile ${CODEX_PROFILE}.`,
      },
      {
        target: "other",
        label: "Cline, Roo Code, Kilo Code, Continue and others",
        detail: "Copies the OpenAI-compatible settings to paste into the agent's provider form.",
      },
      { target: "stop", label: "Stop routing through Otari", detail: "Undoes the terminal and Claude Code extension settings." },
    ];
    const picked = await vscode.window.showQuickPick(items, { title: "Route which agents through Otari?", ignoreFocusOut: true });
    if (!picked) return;
    try {
      switch (picked.target) {
        case "terminals":
          await this.context.globalState.update(TERMINALS_ON, true);
          this.applyTerminals();
          void vscode.window.showInformationMessage("New terminals now route Claude Code and Codex through Otari.");
          break;
        case "claudeExtension":
          await this.routeClaudeExtension();
          break;
        case "codex":
          await this.routeCodex();
          break;
        case "other":
          await vscode.env.clipboard.writeText(openAiCompatibleSettings(this.session.gatewayUrl));
          void vscode.window.showInformationMessage("Copied the OpenAI-compatible settings for Otari to the clipboard.");
          break;
        case "stop":
          await this.stop();
          break;
      }
      if (picked.target === "terminals" || picked.target === "claudeExtension") this.noteUserMismatch();
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not configure the agent: ${describe(error)}`);
    }
  }

  private async routeClaudeExtension(): Promise<void> {
    const key = this.session.key;
    if (!key) return;
    const model = await this.pickModel("Model for Claude Code", (id) => id.startsWith("anthropic:"), true);
    if (model === null) return;
    const confirm = await vscode.window.showWarningMessage(
      "The Claude Code extension reads its environment from your VS Code user settings, so your Otari API key will be stored there in plain text.",
      { modal: true },
      "Write the settings",
    );
    if (confirm !== "Write the settings") return;
    const config = vscode.workspace.getConfiguration();
    const tags = vscode.workspace.getConfiguration("otari").get<Record<string, string>>("chat.tags", {});
    const existing = config.get<EnvVar[]>(CLAUDE_SETTING, []);
    const updated = mergeEnv(existing, claudeCodeEnv(this.session.gatewayUrl, key, tags, model));
    await config.update(CLAUDE_SETTING, updated, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage("Claude Code will use Otari in its next session.");
  }

  private async routeCodex(): Promise<void> {
    const file = vscode.Uri.file(path.join(os.homedir(), ".codex", "config.toml"));
    let text = "";
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
    } catch {
      // No config yet; it is created below.
    }
    if (codexHasOtari(text)) {
      const open = await vscode.window.showInformationMessage("~/.codex/config.toml already has an Otari provider.", "Open It");
      if (open) await vscode.window.showTextDocument(file);
      return;
    }
    const model = await this.pickModel("Model for Codex", (id) => id.startsWith("openai:"), false);
    if (!model) return;
    const separator = text && !text.endsWith("\n") ? "\n" : "";
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file.fsPath)));
    await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(text + separator + codexConfigBlock(this.session.gatewayUrl, model)));
    const terminals = this.terminalsOn ? "" : " Turn on Terminals in VS Code, or export OTARI_API_KEY, so Codex has the key.";
    const pick = await vscode.window.showInformationMessage(`Added the "${CODEX_PROFILE}" Codex profile.${terminals}`, "Open config.toml");
    if (pick) await vscode.window.showTextDocument(file);
  }

  private async stop(): Promise<void> {
    await this.context.globalState.update(TERMINALS_ON, false);
    this.applyTerminals();
    const config = vscode.workspace.getConfiguration();
    const existing = config.get<EnvVar[]>(CLAUDE_SETTING, []);
    const remaining = withoutOtariEnv(existing);
    if (remaining.length !== existing.length) {
      await config.update(CLAUDE_SETTING, remaining.length ? remaining : undefined, vscode.ConfigurationTarget.Global);
    }
    void vscode.window.showInformationMessage(
      "Terminals and the Claude Code extension no longer route through Otari. A Codex profile stays until you remove it.",
    );
  }

  /** `undefined` is "keep the agent's default", `null` is cancelled. */
  private async pickModel(title: string, preferred: (id: string) => boolean, allowDefault: boolean): Promise<string | undefined | null> {
    let ids: string[] = [];
    try {
      ids = (await this.session.chatModels()).map((model) => model.id);
    } catch (error) {
      void vscode.window.showWarningMessage(`Could not list models: ${describe(error)}`);
    }
    const sorted = [...ids.filter(preferred), ...ids.filter((id) => !preferred(id))];
    const items: Array<vscode.QuickPickItem & { value?: string }> = [
      ...(allowDefault ? [{ label: "Keep the agent's default model", value: undefined }] : []),
      ...sorted.map((id) => ({ label: id, value: id })),
      { label: "Type a model id…", value: "\u0000custom" },
    ];
    const picked = await vscode.window.showQuickPick(items, { title, ignoreFocusOut: true, matchOnDescription: true });
    if (!picked) return null;
    if (picked.value === "\u0000custom") {
      return (await vscode.window.showInputBox({ title, prompt: "An Otari model id, such as anthropic:claude-sonnet-4-6" })) ?? null;
    }
    return picked.value;
  }

  private noteUserMismatch(): void {
    if (isOtariAi(this.session.gatewayUrl)) return;
    void vscode.window
      .showInformationMessage(
        "On your own gateway, Claude Code's key needs \"Mismatched user field\" set to Always accept, or its requests are refused.",
        "Read How",
      )
      .then((pick) => pick && vscode.env.openExternal(vscode.Uri.parse(`${DOCS}/use-with-claude-code.md#on-your-own-gateway`)));
  }

  dispose(): void {
    this.subscription.dispose();
  }
}
