# Otari for VS Code

Use your [Otari](https://github.com/mozilla-ai/otari) gateway from VS Code, on otari.ai or your own deployment.

- **Otari models in VS Code chat.** Every chat model your API key can call shows up in the chat model picker
  and to any extension that uses VS Code's language model API. Requests go through Otari's budgets, routing
  and guardrails, are tagged `source=vscode`, and their cost shows in the status bar.
- **Route coding agents through Otari.** One command points Claude Code (the CLI in VS Code terminals, or
  the extension), Codex (an `otari` profile) or any OpenAI-compatible agent (Cline, Roo Code, Kilo Code,
  Continue) at your gateway.
- **Agent Guardrails in the editor.** A repository's `.otari/` gates are validated on save and their
  findings land in Problems on the gate that caused them. Dry run a command or path, check a branch's
  changes, register the hook, or generate gates from `AGENTS.md`, all from the command palette.

## Getting started

1. Run **Otari: Sign In**, pick otari.ai, its EU region or your own gateway, and paste an API key. The key
   is kept in VS Code's secret storage. A key from the other otari.ai region is detected and the gateway
   switched for you.
2. Open chat, open the model picker, choose **Manage Models…** and enable the Otari models you want.
3. Click **Otari** in the status bar for everything else.

Agent Guardrails need the `otari` command: `brew install mozilla-ai/tap/otari`.

## Where each agent's settings go

| Agent | What the extension does | Where the key ends up |
| --- | --- | --- |
| Terminals in VS Code | Sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_CUSTOM_HEADERS`, `OTARI_API_KEY` and `OTARI_BASE_URL` in new integrated terminals, so `claude` and `codex --profile otari` use Otari. | In memory only; rebuilt from secret storage on start. |
| Claude Code extension | Adds the same variables to the `claudeCode.environmentVariables` user setting, after asking. | Your user `settings.json`, in plain text. The extension only reads its environment from there. |
| Codex | Appends a `[model_providers.otari]` provider and an `[profiles.otari]` profile to `~/.codex/config.toml`. Plain `codex` keeps your default. | Nowhere: Codex reads `OTARI_API_KEY`. |
| Cline, Roo Code, Kilo Code, Continue | Copies the base URL and setup to the clipboard for the agent's OpenAI-compatible provider form. | Wherever that agent keeps it. |

**Otari: Route Coding Agents Through Otari → Stop routing** undoes the terminal and Claude Code settings.

On your own gateway, Claude Code's key needs **Mismatched `user` field: Always accept**; see
[Use with Claude Code](https://github.com/mozilla-ai/otari/blob/main/docs/use-with-claude-code.md#on-your-own-gateway).

## Settings

| Setting | Default | |
| --- | --- | --- |
| `otari.gatewayUrl` | `https://api.otari.ai` | The gateway, without `/api/v1`. |
| `otari.dashboardUrl` | empty | Defaults to otari.ai's dashboard, or the gateway URL for your own gateway. |
| `otari.chat.models` | `[]` | Limit chat to these model ids. Empty offers every chat model. |
| `otari.chat.tags` | `{"source": "vscode"}` | Request tags on every chat request. |
| `otari.cliPath` | `otari` | The `otari` command for Agent Guardrails. |
| `otari.guardrails.validateOnSave` | `true` | Validate when a file under `.otari/` is saved. |

## Known limits

- The status bar shows what chat in this window cost, from the `usage.cost_usd` each response carries.
  An API key cannot read its organization's usage or remaining budget, so neither is shown yet.
- `otari guardrails validate` has no machine-readable output, so findings are read from its text.
- Token counts VS Code asks for are estimated (four characters a token).

## Development

```sh
npm install
npm run build          # bundle to dist/
npm test               # unit tests, and the client against the mock gateway
npm run test:integration   # runs inside VS Code; VSCODE_PATH=/path/to/Code uses your own install
npm run package        # otari-vscode-<version>.vsix
```

Press F5 in VS Code to start an Extension Development Host. `npm run mock` starts a stand-in gateway on
`http://localhost:8787` that accepts any key, lists a `mock:fast` model, echoes what you say, and calls the
first tool it is offered when you ask it to "use a tool". The keys `bad` and `eu` exercise the 401 and 421
paths.

## License

Apache 2.0
