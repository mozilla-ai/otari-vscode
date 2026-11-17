import * as vscode from "vscode";
import type { OtariSession } from "./session";

/**
 * Spend of the chat requests this window sent, from the `usage.cost_usd` each response carries. An API key
 * cannot read its organization's usage, so this is what the extension can show without a dashboard session.
 */
export class SpendTracker implements vscode.Disposable {
  private total = 0;
  private requests = 0;
  private unpriced = 0;
  private last: { model: string; cost?: number } | undefined;
  private readonly item = vscode.window.createStatusBarItem("otari.status", vscode.StatusBarAlignment.Right, 100);
  private readonly subscription: vscode.Disposable;

  constructor(private readonly session: OtariSession) {
    this.item.name = "Otari";
    this.item.command = "otari.showMenu";
    this.subscription = session.onDidChange(() => this.render());
    this.render();
    this.item.show();
  }

  record(model: string, costUsd: string | undefined): void {
    this.requests += 1;
    const cost = costUsd === undefined ? undefined : Number(costUsd);
    if (cost === undefined || Number.isNaN(cost)) this.unpriced += 1;
    else this.total += cost;
    this.last = { model, ...(cost === undefined || Number.isNaN(cost) ? {} : { cost }) };
    this.render();
  }

  reset(): void {
    this.total = 0;
    this.requests = 0;
    this.unpriced = 0;
    this.last = undefined;
    this.render();
  }

  private render(): void {
    if (!this.session.signedIn) {
      this.item.text = "$(sign-in) Otari";
      this.item.tooltip = "Sign in to Otari";
      this.item.command = "otari.signIn";
      return;
    }
    this.item.command = "otari.showMenu";
    this.item.text = this.requests ? `$(pulse) Otari ${money(this.total)}` : "$(pulse) Otari";
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**Otari** at \`${this.session.gatewayUrl}\`\n\n`);
    if (this.requests) {
      tooltip.appendMarkdown(`Chat in this window: ${money(this.total)} over ${this.requests} request(s)`);
      if (this.unpriced) tooltip.appendMarkdown(`, ${this.unpriced} without a price`);
      tooltip.appendMarkdown("\n\n");
      if (this.last) {
        tooltip.appendMarkdown(
          `Last: \`${this.last.model}\`${this.last.cost === undefined ? "" : `, ${money(this.last.cost)}`}\n\n`,
        );
      }
    } else {
      tooltip.appendMarkdown("No chat requests through Otari in this window yet.\n\n");
    }
    tooltip.appendMarkdown("Click for Otari commands.");
    this.item.tooltip = tooltip;
  }

  dispose(): void {
    this.subscription.dispose();
    this.item.dispose();
  }
}

export function money(usd: number): string {
  if (usd === 0) return "$0";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}
