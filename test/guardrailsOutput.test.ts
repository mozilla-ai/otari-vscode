import { describe, expect, it } from "vitest";
import { gateLine, gateNamedIn, parseValidateOutput } from "../src/guardrailsOutput";

const OUTPUT = `.otari/guardrails: composed from 13 files, 28 gate(s), schema 1.0.
  error: no-push (.otari/guardrails/git.yml): verifier script is missing
  warning[shell-write-unseen]: user:no-edits (~/.otari/guardrails.yml): sees only edit tools
  accepted[judge-gate-cap]: 6 judge gates, over the 5 one Stop event evaluates.
1 error(s), 1 warning(s), 1 accepted.
`;

describe("parseValidateOutput", () => {
  it("reads located, user-level and unlocated findings", () => {
    const result = parseValidateOutput(OUTPUT);
    expect(result.summary).toBe("1 error(s), 1 warning(s), 1 accepted.");
    expect(result.findings).toEqual([
      { severity: "error", gateId: "no-push", file: ".otari/guardrails/git.yml", message: "verifier script is missing" },
      {
        severity: "warning",
        code: "shell-write-unseen",
        gateId: "user:no-edits",
        file: "~/.otari/guardrails.yml",
        message: "sees only edit tools",
      },
      { severity: "accepted", code: "judge-gate-cap", message: "6 judge gates, over the 5 one Stop event evaluates." },
    ]);
    expect(result.fatal).toBeUndefined();
  });

  it("reports a guardrail that did not load", () => {
    const result = parseValidateOutput("", "Error: Unknown field(s) in gate 'component-layering': 'accept_warnings'.\n");
    expect(result.findings).toEqual([]);
    expect(result.fatal).toBe("Unknown field(s) in gate 'component-layering': 'accept_warnings'.");
    expect(gateNamedIn(result.fatal ?? "")).toBe("component-layering");
  });
});

describe("gateLine", () => {
  const yaml = `schema: 1.0\ngates:\n  - id: other\n    type: path\n  - id: "no-push"  # comment\n    type: command\n`;

  it("finds the gate's declaration", () => {
    expect(gateLine(yaml, "no-push")).toBe(4);
    expect(gateLine(yaml, "user:other")).toBe(2);
  });

  it("falls back to the first line", () => {
    expect(gateLine(yaml, "missing")).toBe(0);
    expect(gateLine(yaml, "no")).toBe(0);
  });
});
