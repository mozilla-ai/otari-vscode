// Runs test/integration/suite.cjs inside a real VS Code: the local install when VSCODE_PATH points at it,
// otherwise a downloaded one, VSCODE_VERSION (`stable`, `1.104.0`) if set.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The otari CLI reads .otari/ at the git root, so the fixture gets a repository of its own.
const workspace = mkdtempSync(path.join(tmpdir(), "otari-vscode-"));
cpSync(path.join(root, "test/fixtures/broken"), workspace, { recursive: true });
execFileSync("git", ["init", "-q"], { cwd: workspace });
// SUITE=e2e signs in to the mock gateway and chats through VS Code's language model API.
const suite = process.env.SUITE === "e2e" ? "e2e.cjs" : "suite.cjs";
let mock;
const env = { ...(process.env.SCREENSHOT ? { SCREENSHOT: process.env.SCREENSHOT } : {}) };
if (suite === "e2e.cjs") {
  const { spawn } = await import("node:child_process");
  mock = spawn(process.execPath, [path.join(root, "scripts/mock-gateway.mjs"), "18788"], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((resolve) => mock.stdout.once("data", resolve));
  mock.stdout.on("data", (data) => process.stdout.write(`[mock] ${data}`));
  env.MOCK_URL = "http://localhost:18788";
}
try {
await runTests({
  ...(process.env.VSCODE_PATH ? { vscodeExecutablePath: process.env.VSCODE_PATH } : {}),
  ...(process.env.VSCODE_VERSION ? { version: process.env.VSCODE_VERSION } : {}),
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, "test/integration", suite),
  extensionTestsEnv: env,
  launchArgs: [workspace, "--disable-extensions", "--skip-welcome", "--skip-release-notes"],
});
} finally {
  mock?.kill();
}
