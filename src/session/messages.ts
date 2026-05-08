import crypto from "node:crypto";

import type { ToolCall, ToolResult } from "../tools/types.js";
import type { AssistantMessage, ToolMessage, UserMessage } from "./types.js";

export function createUserMessage(content: string): UserMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    timestamp: new Date().toISOString(),
    content,
  };
}

export function createAssistantMessage(content: string, toolCalls: ToolCall[]): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    timestamp: new Date().toISOString(),
    content,
    toolCalls,
  };
}

export function createToolMessage(result: ToolResult): ToolMessage {
  return {
    id: crypto.randomUUID(),
    role: "tool",
    timestamp: new Date().toISOString(),
    toolCallId: result.callId,
    toolName: result.name,
    content: result.summary,
    status: result.ok ? "success" : "error",
    result,
  };
}
