// Runs test/integration/suite.cjs inside a real VS Code: the local install when VSCODE_PATH points at it,
// otherwise a downloaded one.
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
await runTests({
  ...(process.env.VSCODE_PATH ? { vscodeExecutablePath: process.env.VSCODE_PATH } : {}),
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, "test/integration/suite.cjs"),
  launchArgs: [workspace, "--disable-extensions", "--skip-welcome", "--skip-release-notes"],
});
