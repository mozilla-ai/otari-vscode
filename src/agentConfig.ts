// The settings each coding agent needs to send its traffic through Otari. Pure, so it is tested without VS Code;
// `wiring.ts` decides where they are written.
import { anthropicBaseUrl, apiRoot } from "./gateway";

export interface EnvVar {
  name: string;
  value: string;
}

/** Tags for Claude Code, which can add a header but not a body field. */
export function tagsHeader(tags: Record<string, string>): string | undefined {
  const pairs = Object.entries(tags).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return pairs.length ? `Otari-Tags: ${pairs.join(",")}` : undefined;
}

export function claudeCodeEnv(gatewayUrl: string, apiKey: string, tags: Record<string, string>, model?: string): EnvVar[] {
  const header = tagsHeader(tags);
  return [
    { name: "ANTHROPIC_BASE_URL", value: anthropicBaseUrl(gatewayUrl) },
    { name: "ANTHROPIC_AUTH_TOKEN", value: apiKey },
    ...(model ? [{ name: "ANTHROPIC_MODEL", value: model }] : []),
    ...(header ? [{ name: "ANTHROPIC_CUSTOM_HEADERS", value: header }] : []),
  ];
}

/** Replaces the named variables in an existing `claudeCode.environmentVariables` list and keeps the others. */
export function mergeEnv(existing: readonly EnvVar[], updates: readonly EnvVar[]): EnvVar[] {
  const names = new Set(updates.map((env) => env.name));
  return [...existing.filter((env) => !names.has(env.name)), ...updates];
}

/** Removes what `claudeCodeEnv` writes, leaving the rest of the list alone. */
export function withoutOtariEnv(existing: readonly EnvVar[]): EnvVar[] {
  const ours = new Set(["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL", "ANTHROPIC_CUSTOM_HEADERS"]);
  return existing.filter((env) => !ours.has(env.name));
}

export const CODEX_PROFILE = "otari";

/**
 * A Codex provider and a profile that selects it, so `codex --profile otari` routes through Otari while plain
 * `codex` keeps whatever the user had. The key is read from OTARI_API_KEY, never written to the file.
 */
export function codexConfigBlock(gatewayUrl: string, model: string): string {
  return [
    "",
    "[model_providers.otari]",
    'name = "Otari"',
    `base_url = ${JSON.stringify(apiRoot(gatewayUrl))}`,
    'wire_api = "responses"',
    'env_key = "OTARI_API_KEY"',
    "",
    `[profiles.${CODEX_PROFILE}]`,
    'model_provider = "otari"',
    `model = ${JSON.stringify(model)}`,
    "",
  ].join("\n");
}

export function codexHasOtari(configText: string): boolean {
  return /^\s*\[model_providers\.otari\]\s*$/m.test(configText);
}

/** What any OpenAI-compatible tool reads, for the agents the extension cannot configure itself. */
export function openAiCompatibleSettings(gatewayUrl: string): string {
  return [
    "Provider: OpenAI Compatible",
    `Base URL: ${apiRoot(gatewayUrl)}`,
    "API key: your Otari API key",
    "Model: an Otari model id, such as anthropic:claude-sonnet-4-6",
  ].join("\n");
}
