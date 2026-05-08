import type { ToolCall, ToolResult } from "../tools/types.js";

export const SESSION_SCHEMA_VERSION = 1;

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface MessageBase {
  id: string;
  role: MessageRole;
  timestamp: string;
}

export interface SystemMessage extends MessageBase {
  role: "system";
  content: string;
}

export interface UserMessage extends MessageBase {
  role: "user";
  content: string;
}

export interface AssistantMessage extends MessageBase {
  role: "assistant";
  content: string;
  toolCalls: ToolCall[];
}

export interface ToolMessage extends MessageBase {
  role: "tool";
  content: string;
  toolName: string;
  toolCallId: string;
  status: "success" | "error";
  result: ToolResult;
}

export type SessionMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface Session {
  schemaVersion: number;
  id: string;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
  toolHistory: string[];
}

export interface PromptStash {
  version: number;
  entries: Record<string, string>;
}
