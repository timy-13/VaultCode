import type { Session } from "../session/types.js";
import type { ToolExecutionRecord } from "../tools/types.js";

const color = {
  red: "\u001b[31m",
  green: "\u001b[32m",
  blue: "\u001b[34m",
  yellow: "\u001b[33m",
  gray: "\u001b[90m",
  cyan: "\u001b[36m",
  reset: "\u001b[0m",
};

export interface BannerContext {
  provider: string;
  model?: string;
  workspaceRoot: string;
}

export function renderBanner(session: Session, context: BannerContext): void {
  process.stdout.write(formatBanner(session, context));
}

export function renderUserPrompt(prompt: string): void {
  process.stdout.write(`${color.green}user${color.reset}\n${indentBlock(prompt)}\n`);
}

export function renderAssistantMessage(content: string): void {
  process.stdout.write(`${color.blue}assistant${color.reset}\n${indentBlock(content || "(no text)")}\n`);
}

export function renderToolExecution(record: ToolExecutionRecord): void {
  const statusColor = record.status === "success" ? color.green : record.status === "cancelled" ? color.yellow : color.red;
  process.stdout.write(`${color.yellow}tool${color.reset} ${record.name} ${statusColor}${record.status}${color.reset} ${color.gray}${record.durationMs}ms${color.reset}\n`);
  process.stdout.write(`${indentBlock(record.summary)}\n`);
}

export function renderInfo(message: string): void {
  process.stdout.write(`${color.gray}${message}${color.reset}\n`);
}

export function renderError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${color.red}${message}${color.reset}\n`);
}

export function formatBanner(session: Session, context: BannerContext): string {
  const model = context.model ?? "default";
  return [
    `${color.blue}session${color.reset} ${session.id}`,
    `${color.cyan}provider${color.reset} ${context.provider}  ${color.cyan}model${color.reset} ${model}`,
    `${color.cyan}workspace${color.reset} ${context.workspaceRoot}`,
    `${color.gray}${"-".repeat(60)}${color.reset}`,
  ].join("\n") + "\n";
}

function indentBlock(content: string): string {
  const lines = content.split(/\r?\n/);
  return lines.map((line) => `${color.gray}|${color.reset} ${line}`).join("\n");
}
