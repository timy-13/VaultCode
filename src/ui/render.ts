import type { Session } from "../session/types.js";
import type { ToolExecutionRecord } from "../tools/types.js";

const color = {
  red: "\u001b[31m",
  green: "\u001b[32m",
  blue: "\u001b[34m",
  yellow: "\u001b[33m",
  gray: "\u001b[90m",
  reset: "\u001b[0m",
};

export function renderBanner(session: Session): void {
  process.stdout.write(`${color.blue}session${color.reset} ${session.id}\n`);
}

export function renderUserPrompt(prompt: string): void {
  process.stdout.write(`${color.green}>${color.reset} ${prompt}\n`);
}

export function renderAssistantMessage(content: string): void {
  process.stdout.write(`${color.blue}assistant${color.reset} ${content}\n`);
}

export function renderToolExecution(record: ToolExecutionRecord): void {
  const statusColor = record.status === "success" ? color.green : color.red;
  process.stdout.write(
    `${color.yellow}tool${color.reset} ${record.name} ${statusColor}${record.status}${color.reset} ${color.gray}${record.durationMs}ms${color.reset}\n`,
  );
}

export function renderInfo(message: string): void {
  process.stdout.write(`${color.gray}${message}${color.reset}\n`);
}

export function renderError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${color.red}${message}${color.reset}\n`);
}
