import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { resolveHarnessPaths } from "../config/paths.js";
import { SESSION_SCHEMA_VERSION, type AgentMessageRecord, type PromptStash, type Session, type SessionMessage } from "./types.js";

export interface SessionSummary {
  id: string;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastAssistantText: string;
}

export interface AgentMessageSummary {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  direction: "parent_to_child" | "child_to_parent";
  createdAt: string;
  content: string;
}

export async function ensureStorage(): Promise<void> {
  const paths = resolveHarnessPaths();
  await fs.mkdir(paths.configDir, { recursive: true });
  await fs.mkdir(paths.sessionsDir, { recursive: true });
  await fs.mkdir(paths.dataDir, { recursive: true });
}

export function createSession(parentSessionId?: string): Session {
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    parentSessionId,
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
    agentMessages: [],
    toolHistory: [],
  };
}

export async function saveSession(session: Session): Promise<void> {
  await ensureStorage();
  session.updatedAt = new Date().toISOString();
  const paths = resolveHarnessPaths();
  const sessionPath = path.join(paths.sessionsDir, `${session.id}.json`);
  await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
}

export async function loadSession(sessionId: string): Promise<Session> {
  const paths = resolveHarnessPaths();
  const sessionPath = path.join(paths.sessionsDir, `${sessionId}.json`);
  const raw = await fs.readFile(sessionPath, "utf8");
  const session = normalizeSession(JSON.parse(raw) as Session);

  if (session.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new Error(`Unsupported session schema version: ${session.schemaVersion}`);
  }

  return session;
}

export async function listChildSessions(parentSessionId: string): Promise<SessionSummary[]> {
  await ensureStorage();
  const paths = resolveHarnessPaths();
  const entries = await fs.readdir(paths.sessionsDir, { withFileTypes: true });
  const sessions: SessionSummary[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const raw = await fs.readFile(path.join(paths.sessionsDir, entry.name), "utf8");
    const session = normalizeSession(JSON.parse(raw) as Session);
    if (session.parentSessionId !== parentSessionId) {
      continue;
    }

    const lastAssistantText = [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
    sessions.push({
      id: session.id,
      parentSessionId: session.parentSessionId,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      lastAssistantText,
    });
  }

  return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function appendMessage<T extends SessionMessage>(session: Session, message: T): T {
  session.messages.push(message);
  session.updatedAt = new Date().toISOString();
  return message;
}

export async function appendAgentMessage(params: {
  sessionId: string;
  fromSessionId: string;
  toSessionId: string;
  direction: "parent_to_child" | "child_to_parent";
  content: string;
}): Promise<AgentMessageRecord> {
  const session = await loadSession(params.sessionId);
  const record: AgentMessageRecord = {
    id: crypto.randomUUID(),
    fromSessionId: params.fromSessionId,
    toSessionId: params.toSessionId,
    direction: params.direction,
    createdAt: new Date().toISOString(),
    content: params.content,
  };
  session.agentMessages.push(record);
  await saveSession(session);
  return record;
}

export async function listAgentMessages(sessionId: string): Promise<AgentMessageSummary[]> {
  const session = await loadSession(sessionId);
  return [...session.agentMessages]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((message) => ({
      id: message.id,
      fromSessionId: message.fromSessionId,
      toSessionId: message.toSessionId,
      direction: message.direction,
      createdAt: message.createdAt,
      content: message.content,
    }));
}

export async function loadStash(): Promise<PromptStash> {
  await ensureStorage();
  const paths = resolveHarnessPaths();

  try {
    const raw = await fs.readFile(paths.stashFile, "utf8");
    return JSON.parse(raw) as PromptStash;
  } catch (error) {
    if (isMissingFileError(error)) {
      return { version: 1, entries: {} };
    }

    throw error;
  }
}

export async function saveStash(stash: PromptStash): Promise<void> {
  await ensureStorage();
  const paths = resolveHarnessPaths();
  await fs.writeFile(paths.stashFile, JSON.stringify(stash, null, 2));
}

export function branchSession(source: Session, messageId: string): Session {
  const index = source.messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    throw new Error(`Message ${messageId} was not found in session ${source.id}.`);
  }

  const branch = createSession(source.id);
  branch.messages = source.messages.slice(0, index + 1);
  const retainedToolCallIds = new Set(
    branch.messages.flatMap((message) => (message.role === "assistant" ? message.toolCalls.map((toolCall) => toolCall.id) : message.role === "tool" ? [message.toolCallId] : [])),
  );
  branch.toolHistory = source.toolHistory.filter((entry) => retainedToolCallIds.has(entry));
  return branch;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function normalizeSession(session: Session): Session {
  session.agentMessages ??= [];
  return session;
}
