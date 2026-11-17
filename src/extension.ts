import * as vscode from "vscode";
import { OtariChatProvider } from "./chatProvider";
import { GuardrailsController } from "./guardrails";
import { OtariSession } from "./session";
import { SpendTracker } from "./spend";
import { AgentWiring } from "./wiring";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const log = vscode.window.createOutputChannel("Otari", { log: true });
  const session = new OtariSession(context);
  await session.load();
  const spend = new SpendTracker(session);
  const guardrails = new GuardrailsController(log);
  const wiring = new AgentWiring(context, session);
  const chat = new OtariChatProvider(session, spend, log);

  context.subscriptions.push(
    log,
    session,
    spend,
    guardrails,
    wiring,
    vscode.lm.registerLanguageModelChatProvider("otari", chat),
    vscode.commands.registerCommand("otari.signIn", () => session.signIn()),
    vscode.commands.registerCommand("otari.signOut", () => session.signOut()),
    vscode.commands.registerCommand("otari.openDashboard", () => vscode.env.openExternal(vscode.Uri.parse(session.dashboardUrl))),
    vscode.commands.registerCommand("otari.refreshModels", () => session.invalidate()),
    vscode.commands.registerCommand("otari.routeAgents", () => wiring.route()),
    vscode.commands.registerCommand("otari.resetSpend", () => spend.reset()),
    vscode.commands.registerCommand("otari.guardrails.validate", async () => {
      const folder = await pickFolder(guardrails, "Validate which folder's guardrails?");
      if (folder) await guardrails.validate(folder, true);
    }),
    vscode.commands.registerCommand("otari.guardrails.dryRun", async () => {
      const folder = await pickFolder(guardrails, "Dry run which folder's guardrails?");
      if (folder) await guardrails.dryRun(folder);
    }),
    vscode.commands.registerCommand("otari.guardrails.check", async () => {
      const folder = await pickFolder(guardrails, "Check which folder's changes?");
      if (!folder) return;
      const base = await vscode.window.showInputBox({
        title: "Check changes since",
        prompt: "A branch or commit. HEAD checks the uncommitted change.",
        value: "origin/main",
      });
      if (base) await guardrails.inTerminal(folder, ["guardrails", "check", "--base", base], "Otari guardrails check");
    }),
    vscode.commands.registerCommand("otari.guardrails.setupHook", async () => {
      const folder = await pickFolder(guardrails, "Register the hook in which folder?", true);
      if (!folder) return;
      const harness = await vscode.window.showQuickPick(["claude-code", "codex"], { title: "Which agent?" });
      if (harness) await guardrails.inTerminal(folder, ["hook", "setup", "--harness", harness], "Otari hook setup");
    }),
    vscode.commands.registerCommand("otari.guardrails.generate", async () => {
      const folder = await pickFolder(guardrails, "Generate guardrails in which folder?", true);
      if (folder) await guardrails.inTerminal(folder, ["guardrails", "generate"], "Otari guardrails generate");
    }),
    vscode.commands.registerCommand("otari.showMenu", () => showMenu(session)),
  );

  void guardrails.validateAll();
}

async function pickFolder(
  guardrails: GuardrailsController,
  title: string,
  anyFolder = false,
): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = anyFolder ? [...(vscode.workspace.workspaceFolders ?? [])] : await guardrails.foldersWithGuardrails();
  if (!folders.length) {
    const message = anyFolder ? "Open a folder first." : "No folder here has guardrails under .otari/.";
    const pick = await vscode.window.showInformationMessage(message, ...(anyFolder ? [] : ["Generate From AGENTS.md"]));
    if (pick) await vscode.commands.executeCommand("otari.guardrails.generate");
    return undefined;
  }
  if (folders.length === 1) return folders[0];
  return vscode.window.showWorkspaceFolderPick({ placeHolder: title });
}

async function showMenu(session: OtariSession): Promise<void> {
  const items: Array<vscode.QuickPickItem & { command?: string }> = session.signedIn
    ? [
        { label: "Chat", kind: vscode.QuickPickItemKind.Separator },
        { label: "$(comment-discussion) Open Chat", detail: "Pick an Otari model from the chat model picker.", command: "workbench.action.chat.open" },
        { label: "$(refresh) Refresh Models", command: "otari.refreshModels" },
        { label: "$(debug-restart) Reset Session Spend", command: "otari.resetSpend" },
        { label: "Agents", kind: vscode.QuickPickItemKind.Separator },
        { label: "$(plug) Route Coding Agents Through Otari", command: "otari.routeAgents" },
        { label: "Agent Guardrails", kind: vscode.QuickPickItemKind.Separator },
        { label: "$(shield) Validate", command: "otari.guardrails.validate" },
        { label: "$(beaker) Dry Run a Command or Path", command: "otari.guardrails.dryRun" },
        { label: "$(git-compare) Check Changes", command: "otari.guardrails.check" },
        { label: "$(gear) Register the Hook", command: "otari.guardrails.setupHook" },
        { label: "Account", kind: vscode.QuickPickItemKind.Separator },
        { label: "$(link-external) Open Dashboard", description: session.dashboardUrl, command: "otari.openDashboard" },
        { label: "$(sign-out) Sign Out", description: session.gatewayUrl, command: "otari.signOut" },
      ]
    : [
        { label: "$(sign-in) Sign In", command: "otari.signIn" },
        { label: "$(shield) Validate Agent Guardrails", command: "otari.guardrails.validate" },
      ];
  const picked = await vscode.window.showQuickPick(items, { title: "Otari" });
  if (picked?.command) await vscode.commands.executeCommand(picked.command);
}

export function deactivate(): void {}
