// Signs in to the mock gateway and talks to the Otari models through VS Code's own language model API.
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const vscode = require("vscode");

async function collect(response) {
  const parts = [];
  for await (const part of response.stream) parts.push(part);
  return parts;
}

exports.run = async () => {
  const extension = vscode.extensions.getExtension("mozilla-ai.otari-vscode");
  await extension.activate();

  assert.strictEqual(
    await vscode.commands.executeCommand("otari.signIn", { gatewayUrl: process.env.MOCK_URL, apiKey: "tk-test" }),
    true,
    "signed in",
  );

  const models = await vscode.lm.selectChatModels({ vendor: "otari" });
  console.log("Otari models:", models.map((model) => `${model.id} (${model.name}, ${model.maxInputTokens} tokens)`));
  assert.deepStrictEqual(models.map((model) => model.id), ["mock:fast"], "chat models only");
  const [model] = models;

  const token = new vscode.CancellationTokenSource().token;
  const text = await collect(await model.sendRequest([vscode.LanguageModelChatMessage.User("hello from VS Code")], {}, token));
  const reply = text.map((part) => part.value ?? "").join("");
  console.log("Reply:", reply);
  assert.strictEqual(reply, "You said: hello from VS Code");

  const tools = [{ name: "now", description: "The time", inputSchema: { type: "object", properties: {} } }];
  const toolParts = await collect(await model.sendRequest([vscode.LanguageModelChatMessage.User("use a tool")], { tools }, token));
  const call = toolParts.find((part) => part instanceof vscode.LanguageModelToolCallPart);
  console.log("Tool call:", call && { callId: call.callId, name: call.name, input: call.input });
  assert.ok(call && call.name === "now", "the model called the tool");

  const followUp = await collect(
    await model.sendRequest(
      [
        vscode.LanguageModelChatMessage.User("use a tool"),
        vscode.LanguageModelChatMessage.Assistant([call]),
        vscode.LanguageModelChatMessage.User([new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart("15:42")])]),
      ],
      { tools },
      token,
    ),
  );
  const answer = followUp.map((part) => part.value ?? "").join("");
  console.log("After the tool result:", answer);
  assert.ok(answer.includes("15:42"), "the tool result reached the gateway");

  if (process.env.SCREENSHOT) {
    await vscode.commands.executeCommand("workbench.action.chat.open");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    try {
      execFileSync("screencapture", ["-x", process.env.SCREENSHOT]);
      console.log("Screenshot:", process.env.SCREENSHOT);
    } catch {
      console.log("No screenshot: macOS needs Screen Recording permission for VS Code.");
    }
  }
};
