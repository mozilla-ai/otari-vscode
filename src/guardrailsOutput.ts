// Reads the text `otari guardrails validate` prints. The CLI has no machine-readable output yet, so this follows
// the format its `guardrails_validate` command writes:
//   "  <error|warning|accepted>[<code>]: <gate id> (<file>): <message>"
// and a Click failure as "Error: <message>".

export type Severity = "error" | "warning" | "accepted";

export interface GuardrailFinding {
  severity: Severity;
  code?: string;
  gateId?: string;
  file?: string;
  message: string;
}

export interface ValidateResult {
  findings: GuardrailFinding[];
  summary?: string;
  /** The command refused to load the guardrail at all, so no gate was checked. */
  fatal?: string;
}

const FINDING = /^\s+(error|warning|accepted)(?:\[([^\]]+)\])?: (.*)$/;
const LOCATED = /^([^\s:()]+(?::[^\s:()]+)?) \(([^)]+)\): ([\s\S]*)$/;
const SUMMARY = /^\d+ error\(s\), \d+ warning\(s\)/;

export function parseValidateOutput(stdout: string, stderr = ""): ValidateResult {
  const findings: GuardrailFinding[] = [];
  let summary: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const match = FINDING.exec(line);
    if (match) {
      const [, severity, code, rest = ""] = match;
      const located = LOCATED.exec(rest);
      findings.push({
        severity: severity as Severity,
        ...(code ? { code } : {}),
        ...(located ? { gateId: located[1], file: located[2], message: located[3] ?? "" } : { message: rest }),
      });
    } else if (SUMMARY.test(line.trim())) {
      summary = line.trim();
    }
  }
  const fatal = /^Error: (.*)$/m.exec(stderr)?.[1] ?? /^Error: (.*)$/m.exec(stdout)?.[1];
  return { findings, ...(summary ? { summary } : {}), ...(fatal ? { fatal } : {}) };
}

/** The zero-based line declaring a gate, so a finding lands on the gate rather than the top of the file. */
export function gateLine(fileText: string, gateId: string): number {
  const bare = gateId.replace(/^user:/, "");
  const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const declaration = new RegExp(`^\\s*(?:-\\s*)?id:\\s*["']?${escaped}["']?\\s*(?:#.*)?$`);
  const lines = fileText.split(/\r?\n/);
  const index = lines.findIndex((line) => declaration.test(line));
  return index === -1 ? 0 : index;
}

/** The gate a load error names, as in "Unknown field(s) in gate 'component-layering'". */
export function gateNamedIn(message: string): string | undefined {
  return /gate '([^']+)'/.exec(message)?.[1];
}
