import { createInterface } from "node:readline/promises";
import type { Session, SessionMessage } from "../session/types.js";

export interface BranchSelection {
  action: "fork" | "restore";
  messageId: string;
}

export interface BranchPickerIO {
  write(text: string): void;
  ask(prompt: string): Promise<string>;
  close(): void;
}

export async function chooseBranchSelection(session: Session, io: BranchPickerIO = createBranchPickerIO()): Promise<BranchSelection | null> {
  try {
    if (session.messages.length === 0) {
      io.write("No messages in this session to branch from.\n");
      return null;
    }

    io.write(formatBranchMessageList(session.messages));
    const selectedMessage = await promptForMessage(session.messages, io);
    if (!selectedMessage) {
      io.write("Cancelled branch selection.\n");
      return null;
    }

    const action = await promptForAction(io);
    if (!action) {
      io.write("Cancelled branch selection.\n");
      return null;
    }

    return {
      action,
      messageId: selectedMessage.id,
    };
  } finally {
    io.close();
  }
}

export function formatBranchMessageList(messages: SessionMessage[]): string {
  const lines = ["Select a message to branch from:"];
  for (const [index, message] of messages.entries()) {
    lines.push(`${index + 1}. [${message.role}] ${formatMessagePreview(message)} (${message.id})`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function formatMessagePreview(message: SessionMessage): string {
  const raw =
    message.role === "tool"
      ? `${message.toolName}: ${message.content}`
      : message.content;
  const singleLine = raw.replace(/\s+/g, " ").trim();
  if (singleLine.length <= 72) {
    return singleLine || "(empty)";
  }

  return `${singleLine.slice(0, 69)}...`;
}

async function promptForMessage(messages: SessionMessage[], io: BranchPickerIO): Promise<SessionMessage | null> {
  while (true) {
    const answer = (await io.ask("Message number (or q to cancel): ")).trim().toLowerCase();
    if (answer === "q" || answer === "quit") {
      return null;
    }

    const index = Number(answer);
    if (Number.isInteger(index) && index >= 1 && index <= messages.length) {
      return messages[index - 1] ?? null;
    }

    io.write(`Select a number between 1 and ${messages.length}.\n`);
  }
}

async function promptForAction(io: BranchPickerIO): Promise<BranchSelection["action"] | null> {
  while (true) {
    const answer = (await io.ask("Action: [f]ork, [r]estore, or q to cancel: ")).trim().toLowerCase();
    if (answer === "q" || answer === "quit") {
      return null;
    }

    if (answer === "f" || answer === "fork") {
      return "fork";
    }

    if (answer === "r" || answer === "restore") {
      return "restore";
    }

    io.write("Choose fork or restore.\n");
  }
}

function createBranchPickerIO(): BranchPickerIO {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    write(text: string): void {
      process.stdout.write(text);
    },
    ask(prompt: string): Promise<string> {
      return rl.question(prompt);
    },
    close(): void {
      rl.close();
    },
  };
}
