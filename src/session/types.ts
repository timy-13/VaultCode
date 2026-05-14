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
  status: "success" | "error" | "cancelled";
  result: ToolResult;
}

export type SessionMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface AgentMessageRecord {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  direction: "parent_to_child" | "child_to_parent" | "session_to_session";
  createdAt: string;
  content: string;
}

export interface LoadedSkillRecord {
  name: string;
  description: string;
  dependencies: string[];
  source: "global" | "project";
  directoryPath: string;
  entryFilePath: string;
  resourcePaths: string[];
  metadataWarnings: string[];
}

export type SessionLifecycleState = "running" | "shutdown_requested" | "completed" | "cleaned_up";

export interface Session {
  schemaVersion: number;
  id: string;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  lifecycleState: SessionLifecycleState;
  messages: SessionMessage[];
  agentMessages: AgentMessageRecord[];
  loadedSkills: LoadedSkillRecord[];
  toolHistory: string[];
}

export interface SessionTreeNode {
  sessionId: string;
  parentSessionId?: string;
  depth: number;
}

export interface PromptStash {
  version: number;
  entries: Record<string, string>;
}
