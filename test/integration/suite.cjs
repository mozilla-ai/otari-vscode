const assert = require("node:assert");
const vscode = require("vscode");

async function waitFor(check, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error("Timed out");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

exports.run = async () => {
  const extension = vscode.extensions.getExtension("mozilla-ai.otari-vscode");
  assert.ok(extension, "extension is installed");
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const id of ["otari.signIn", "otari.routeAgents", "otari.guardrails.validate", "otari.showMenu"]) {
    assert.ok(commands.includes(id), `${id} is registered`);
  }

  // Signed out, the provider answers a silent listing with no models rather than prompting.
  const models = await vscode.lm.selectChatModels({ vendor: "otari" });
  assert.deepStrictEqual(models, []);

  // The fixture's guardrail does not load, which should land on the gate in Problems.
  const file = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, ".otari", "guardrails.yml");
  const diagnostics = await waitFor(() => {
    const found = vscode.languages.getDiagnostics(file);
    return found.length ? found : undefined;
  });
  console.log("Guardrail diagnostics:", diagnostics.map((d) => `${d.range.start.line}: ${d.message}`));
  assert.strictEqual(diagnostics[0].source, "otari guardrails");
  assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
  assert.strictEqual(diagnostics[0].range.start.line, 6, "points at the gate's id line");
};
