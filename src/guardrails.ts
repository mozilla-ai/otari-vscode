import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { type GuardrailFinding, gateLine, gateNamedIn, parseValidateOutput } from "./guardrailsOutput";

const INSTALL = "brew install mozilla-ai/tap/otari";

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Agent Guardrails in the editor: validation findings in Problems, and the `otari` CLI one command away. */
export class GuardrailsController implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("otari-guardrails");
  private readonly subscriptions: vscode.Disposable[] = [this.diagnostics];
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly published = new Map<string, vscode.Uri[]>();
  private missingCliShown = false;

  constructor(private readonly output: vscode.LogOutputChannel) {
    this.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (!vscode.workspace.getConfiguration("otari").get<boolean>("guardrails.validateOnSave", true)) return;
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (folder && isGuardrailFile(document.uri)) this.schedule(folder);
      }),
    );
  }

  private get cli(): string {
    return vscode.workspace.getConfiguration("otari").get<string>("cliPath", "otari") || "otari";
  }

  async foldersWithGuardrails(): Promise<vscode.WorkspaceFolder[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const found = await Promise.all(
      folders.map(async (folder) => ((await guardrailFiles(await repoRoot(folder))).length ? folder : undefined)),
    );
    return found.filter((folder): folder is vscode.WorkspaceFolder => folder !== undefined);
  }

  async validateAll(): Promise<void> {
    for (const folder of await this.foldersWithGuardrails()) await this.validate(folder);
  }

  private schedule(folder: vscode.WorkspaceFolder): void {
    const key = folder.uri.toString();
    clearTimeout(this.pending.get(key));
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        void this.validate(folder);
      }, 300),
    );
  }

  async validate(folder: vscode.WorkspaceFolder, notify = false): Promise<void> {
    const result = await this.run(folder, ["guardrails", "validate"]);
    if (!result) return;
    this.output.info(`otari guardrails validate in ${folder.name}:\n${result.stdout}${result.stderr}`);
    const parsed = parseValidateOutput(result.stdout, result.stderr);
    const root = await repoRoot(folder);
    const files = await guardrailFiles(root);
    const fallback = files[0] ?? vscode.Uri.joinPath(root, ".otari", "guardrails.yml");
    const byFile = new Map<string, { uri: vscode.Uri; items: vscode.Diagnostic[] }>();
    const add = async (uri: vscode.Uri, diagnostic: vscode.Diagnostic) => {
      const entry = byFile.get(uri.toString()) ?? { uri, items: [] };
      entry.items.push(diagnostic);
      byFile.set(uri.toString(), entry);
    };

    for (const finding of parsed.findings) {
      const uri = finding.file ? resolveGuardrailFile(root, finding.file) : fallback;
      const line = finding.gateId ? await lineOfGate(uri, finding.gateId) : 0;
      await add(uri, toDiagnostic(finding, line));
    }
    if (parsed.fatal) {
      const gate = gateNamedIn(parsed.fatal);
      let target = fallback;
      let line = 0;
      for (const file of gate ? files : []) {
        const found = await lineOfGate(file, gate ?? "");
        if (found > 0 || (await read(file)).includes(gate ?? "")) {
          target = file;
          line = found;
          break;
        }
      }
      await add(target, toDiagnostic({ severity: "error", message: parsed.fatal }, line));
    }

    for (const uri of this.published.get(folder.uri.toString()) ?? []) this.diagnostics.delete(uri);
    for (const { uri, items } of byFile.values()) this.diagnostics.set(uri, items);
    this.published.set(folder.uri.toString(), [...byFile.values()].map(({ uri }) => uri));

    if (notify) {
      const summary = parsed.fatal ? `The guardrail did not load: ${parsed.fatal}` : (parsed.summary ?? "Validated.");
      const show = parsed.fatal || parsed.findings.some((finding) => finding.severity !== "accepted");
      const message = `${folder.name}: ${summary}`;
      if (show) void vscode.window.showWarningMessage(message, "Show Problems").then((pick) => pick && vscode.commands.executeCommand("workbench.actions.view.problems"));
      else void vscode.window.showInformationMessage(message);
    }
  }

  async dryRun(folder: vscode.WorkspaceFolder): Promise<void> {
    const kind = await vscode.window.showQuickPick(
      [
        { label: "A shell command", flag: "--command", prompt: "A command an agent might run, such as git push --force" },
        { label: "A file path", flag: "--path", prompt: "A repository-relative path an agent might edit" },
      ],
      { title: "What should the guardrails see?" },
    );
    if (!kind) return;
    const value = await vscode.window.showInputBox({ title: kind.label, prompt: kind.prompt, ignoreFocusOut: true });
    if (!value) return;
    const result = await this.run(folder, ["guardrails", "validate", kind.flag, value]);
    if (!result) return;
    this.output.info(`Dry run of ${kind.flag} ${value} in ${folder.name}:\n${result.stdout}${result.stderr}`);
    this.output.show(true);
  }

  async inTerminal(folder: vscode.WorkspaceFolder, args: string[], name: string): Promise<void> {
    if (!(await this.ensureCli(folder))) return;
    const terminal = vscode.window.createTerminal({ name, cwd: folder.uri });
    terminal.show();
    terminal.sendText([this.cli, ...args].map(shellQuote).join(" "));
  }

  private async ensureCli(folder: vscode.WorkspaceFolder): Promise<boolean> {
    return (await this.run(folder, ["--version"])) !== undefined;
  }

  private run(folder: vscode.WorkspaceFolder, args: string[]): Promise<RunResult | undefined> {
    return new Promise((resolve) => {
      execFile(this.cli, args, { cwd: folder.uri.fsPath, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } }, (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          this.reportMissingCli();
          resolve(undefined);
          return;
        }
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout, stderr });
      });
    });
  }

  private reportMissingCli(): void {
    this.output.warn(`The otari command was not found at "${this.cli}".`);
    if (this.missingCliShown) return;
    this.missingCliShown = true;
    void vscode.window
      .showWarningMessage("Agent Guardrails need the otari command.", "Install with Homebrew", "Set Path")
      .then((pick) => {
        if (pick === "Install with Homebrew") {
          const terminal = vscode.window.createTerminal({ name: "Install otari" });
          terminal.show();
          terminal.sendText(INSTALL);
        } else if (pick === "Set Path") {
          void vscode.commands.executeCommand("workbench.action.openSettings", "otari.cliPath");
        }
      });
  }

  dispose(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}

function toDiagnostic(finding: GuardrailFinding, line: number): vscode.Diagnostic {
  const severity =
    finding.severity === "error"
      ? vscode.DiagnosticSeverity.Error
      : finding.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Hint;
  const prefix = finding.gateId ? `${finding.gateId}: ` : "";
  const accepted = finding.severity === "accepted" ? " (accepted)" : "";
  const diagnostic = new vscode.Diagnostic(new vscode.Range(line, 0, line, 1000), `${prefix}${finding.message}${accepted}`, severity);
  diagnostic.source = "otari guardrails";
  if (finding.code) diagnostic.code = finding.code;
  return diagnostic;
}

function isGuardrailFile(uri: vscode.Uri): boolean {
  return uri.fsPath.split(path.sep).includes(".otari");
}

/** The CLI reads `.otari/` at the git root, which is not the workspace folder when the folder is a subdirectory. */
function repoRoot(folder: vscode.WorkspaceFolder): Promise<vscode.Uri> {
  return new Promise((resolve) => {
    // --show-cdup rather than --show-toplevel keeps the folder's own spelling of the path, where the toplevel
    // would resolve symlinks (macOS's /var is /private/var) and file diagnostics under a URI no editor has open.
    execFile("git", ["rev-parse", "--show-cdup"], { cwd: folder.uri.fsPath }, (error, stdout) => {
      resolve(error ? folder.uri : vscode.Uri.file(path.resolve(folder.uri.fsPath, stdout.trim() || ".")));
    });
  });
}

async function guardrailFiles(root: vscode.Uri): Promise<vscode.Uri[]> {
  const pattern = new vscode.RelativePattern(root, ".otari/{guardrails.yml,guardrails.yaml,guardrails/**/*.yml,guardrails/**/*.yaml}");
  const found = await vscode.workspace.findFiles(pattern);
  if (found.length) return found.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
  // findFiles only searches inside the workspace, and the git root may be above it.
  const single = vscode.Uri.joinPath(root, ".otari", "guardrails.yml");
  return (await exists(single)) ? [single] : [];
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function resolveGuardrailFile(root: vscode.Uri, file: string): vscode.Uri {
  if (file.startsWith("~/")) return vscode.Uri.file(path.join(os.homedir(), file.slice(2)));
  if (path.isAbsolute(file)) return vscode.Uri.file(file);
  return vscode.Uri.joinPath(root, file);
}

async function read(uri: vscode.Uri): Promise<string> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return "";
  }
}

async function lineOfGate(uri: vscode.Uri, gateId: string): Promise<number> {
  return gateLine(await read(uri), gateId);
}

function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
