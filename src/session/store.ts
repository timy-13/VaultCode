import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { resolveHarnessPaths } from "../config/paths.js";
import { SESSION_SCHEMA_VERSION, type PromptStash, type Session, type SessionMessage } from "./types.js";

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
  const session = JSON.parse(raw) as Session;

  if (session.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new Error(`Unsupported session schema version: ${session.schemaVersion}`);
  }

  return session;
}

export function appendMessage<T extends SessionMessage>(session: Session, message: T): T {
  session.messages.push(message);
  session.updatedAt = new Date().toISOString();
  return message;
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
