import { describe, expect, it } from "vitest";
import { claudeCodeEnv, codexConfigBlock, codexHasOtari, mergeEnv, tagsHeader, withoutOtariEnv } from "../src/agentConfig";

describe("Claude Code", () => {
  it("builds the environment, tags percent-encoded", () => {
    expect(claudeCodeEnv("https://api.otari.ai", "tk", { source: "vscode", note: "a,b" }, "anthropic:claude-sonnet-4-6")).toEqual([
      { name: "ANTHROPIC_BASE_URL", value: "https://api.otari.ai/api" },
      { name: "ANTHROPIC_AUTH_TOKEN", value: "tk" },
      { name: "ANTHROPIC_MODEL", value: "anthropic:claude-sonnet-4-6" },
      { name: "ANTHROPIC_CUSTOM_HEADERS", value: "Otari-Tags: source=vscode,note=a%2Cb" },
    ]);
    expect(tagsHeader({})).toBeUndefined();
  });

  it("merges into and removes from an existing list without touching other variables", () => {
    const existing = [{ name: "FOO", value: "1" }, { name: "ANTHROPIC_BASE_URL", value: "old" }];
    const merged = mergeEnv(existing, claudeCodeEnv("http://gw", "tk", {}));
    expect(merged).toEqual([
      { name: "FOO", value: "1" },
      { name: "ANTHROPIC_BASE_URL", value: "http://gw/api" },
      { name: "ANTHROPIC_AUTH_TOKEN", value: "tk" },
    ]);
    expect(withoutOtariEnv(merged)).toEqual([{ name: "FOO", value: "1" }]);
  });
});

describe("Codex", () => {
  it("writes a provider and profile that never hold the key", () => {
    const block = codexConfigBlock("https://eu.api.otari.ai", "openai:gpt-5.4");
    expect(block).toContain('base_url = "https://eu.api.otari.ai/api/v1"');
    expect(block).toContain('env_key = "OTARI_API_KEY"');
    expect(block).toContain('[profiles.otari]\nmodel_provider = "otari"\nmodel = "openai:gpt-5.4"');
    expect(codexHasOtari(`model = "x"\n${block}`)).toBe(true);
    expect(codexHasOtari('[model_providers.other]\n')).toBe(false);
  });
});
