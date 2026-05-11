import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { resolveHarnessPaths } from "../config/paths.js";
import {
  SESSION_SCHEMA_VERSION,
  type AgentMessageRecord,
  type PromptStash,
  type Session,
  type SessionLifecycleState,
  type SessionMessage,
  type SessionTreeNode,
} from "./types.js";

export interface SessionSummary {
  id: string;
  parentSessionId?: string;
  depth: number;
  createdAt: string;
  updatedAt: string;
  lifecycleState: SessionLifecycleState;
  messageCount: number;
  lastAssistantText: string;
}

export interface TeamStatusSummary {
  rootSessionId: string;
  focusSessionId: string;
  parentSessionId: string;
  totalSessions: number;
  counts: Record<SessionLifecycleState, number>;
  sessions: SessionSummary[];
}

export interface AgentMessageSummary {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  direction: "parent_to_child" | "child_to_parent" | "session_to_session";
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
    lifecycleState: "running",
    messages: [],
    agentMessages: [],
    loadedSkills: [],
    toolHistory: [],
  };
}

export async function saveSession(session: Session): Promise<void> {
  await saveSessionWithOptions(session, {});
}

export async function saveSessionWithOptions(session: Session, options: { allowTruncate?: boolean }): Promise<void> {
  await ensureStorage();
  const paths = resolveHarnessPaths();
  const sessionPath = path.join(paths.sessionsDir, `${session.id}.json`);
  const existing = await readSessionFile(sessionPath);
  const nextSession = existing ? mergeSessionForSave(existing, session, options) : session;
  nextSession.updatedAt = new Date().toISOString();
  const tempPath = path.join(paths.sessionsDir, `${session.id}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tempPath, JSON.stringify(nextSession, null, 2));
  await fs.rename(tempPath, sessionPath);
  Object.assign(session, nextSession);
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

export async function listChildSessions(parentSessionId: string, options?: { recursive?: boolean }): Promise<SessionSummary[]> {
  const sessions = await loadAllSessions();
  const nodes = options?.recursive ? collectDescendantNodes(sessions, parentSessionId) : collectDirectChildNodes(sessions, parentSessionId);
  return nodes.map((node) => toSessionSummary(getRequiredSession(sessions, node.sessionId), node.depth)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
  direction: "parent_to_child" | "child_to_parent" | "session_to_session";
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

export async function updateSessionLifecycle(sessionId: string, lifecycleState: SessionLifecycleState): Promise<Session> {
  const session = await loadSession(sessionId);
  session.lifecycleState = lifecycleState;
  await saveSession(session);
  return session;
}

export async function getTeamStatus(parentSessionId: string, options?: { recursive?: boolean }): Promise<TeamStatusSummary> {
  const sessions = await loadAllSessions();
  const rootSessionId = options?.recursive ? getRootSessionId(sessions, parentSessionId) : parentSessionId;
  const root = getRequiredSession(sessions, rootSessionId);
  const descendants = options?.recursive ? collectDescendantNodes(sessions, rootSessionId) : collectDirectChildNodes(sessions, parentSessionId);
  const summaries: SessionSummary[] = [toSessionSummary(root, 0)];

  if (options?.recursive) {
    summaries.push(...descendants.map((node) => toSessionSummary(getRequiredSession(sessions, node.sessionId), node.depth)));
  } else {
    const focus = getRequiredSession(sessions, parentSessionId);
    summaries[0] = toSessionSummary(focus, 0);
    summaries.push(...descendants.map((node) => toSessionSummary(getRequiredSession(sessions, node.sessionId), node.depth)));
  }

  const counts: Record<SessionLifecycleState, number> = {
    running: 0,
    shutdown_requested: 0,
    completed: 0,
    cleaned_up: 0,
  };
  for (const session of summaries) {
    counts[session.lifecycleState] += 1;
  }

  return {
    rootSessionId,
    focusSessionId: parentSessionId,
    parentSessionId,
    totalSessions: summaries.length,
    counts,
    sessions: summaries,
  };
}

export async function getSessionTree(sessionId: string): Promise<Array<SessionSummary>> {
  const sessions = await loadAllSessions();
  const rootSessionId = getRootSessionId(sessions, sessionId);
  const root = getRequiredSession(sessions, rootSessionId);
  const descendants = collectDescendantNodes(sessions, rootSessionId);
  return [toSessionSummary(root, 0), ...descendants.map((node) => toSessionSummary(getRequiredSession(sessions, node.sessionId), node.depth))].sort((left, right) => {
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

export async function isSameSessionTree(sourceSessionId: string, targetSessionId: string): Promise<boolean> {
  const sessions = await loadAllSessions();
  return getRootSessionId(sessions, sourceSessionId) === getRootSessionId(sessions, targetSessionId);
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
  const snapshot = snapshotSessionAtMessage(source, messageId);
  const branch = createSession(source.id);
  branch.messages = snapshot.messages;
  branch.toolHistory = snapshot.toolHistory;
  branch.loadedSkills = [...source.loadedSkills];
  return branch;
}

export function restoreSessionToMessage(session: Session, messageId: string): Session {
  const snapshot = snapshotSessionAtMessage(session, messageId);
  session.messages = snapshot.messages;
  session.toolHistory = snapshot.toolHistory;
  session.updatedAt = new Date().toISOString();
  return session;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function loadAllSessions(): Promise<Session[]> {
  await ensureStorage();
  const paths = resolveHarnessPaths();
  const entries = await fs.readdir(paths.sessionsDir, { withFileTypes: true });
  const sessions: Session[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const raw = await fs.readFile(path.join(paths.sessionsDir, entry.name), "utf8");
    sessions.push(normalizeSession(JSON.parse(raw) as Session));
  }

  return sessions;
}

function collectDirectChildNodes(sessions: Session[], parentSessionId: string): SessionTreeNode[] {
  return sessions
    .filter((session) => session.parentSessionId === parentSessionId)
    .map((session) => ({
      sessionId: session.id,
      parentSessionId: session.parentSessionId,
      depth: 1,
    }));
}

function collectDescendantNodes(sessions: Session[], parentSessionId: string): SessionTreeNode[] {
  const byParent = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!session.parentSessionId) {
      continue;
    }

    const bucket = byParent.get(session.parentSessionId) ?? [];
    bucket.push(session);
    byParent.set(session.parentSessionId, bucket);
  }

  const descendants: SessionTreeNode[] = [];
  const pending: SessionTreeNode[] = [{ sessionId: parentSessionId, depth: 0 }];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) {
      continue;
    }

    for (const child of byParent.get(current.sessionId) ?? []) {
      const node: SessionTreeNode = {
        sessionId: child.id,
        parentSessionId: child.parentSessionId,
        depth: current.depth + 1,
      };
      descendants.push(node);
      pending.push(node);
    }
  }

  return descendants;
}

function getRootSessionId(sessions: Session[], sessionId: string): string {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  let current = byId.get(sessionId);
  if (!current) {
    throw new Error(`Session ${sessionId} was not found.`);
  }

  const visited = new Set<string>();
  while (current.parentSessionId) {
    if (visited.has(current.id)) {
      throw new Error(`Session tree for ${sessionId} contains a cycle.`);
    }

    visited.add(current.id);
    const parent = byId.get(current.parentSessionId);
    if (!parent) {
      return current.parentSessionId;
    }

    current = parent;
  }

  return current.id;
}

function getRequiredSession(sessions: Session[], sessionId: string): Session {
  const session = sessions.find((candidate) => candidate.id === sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} was not found.`);
  }

  return session;
}

function toSessionSummary(session: Session, depth: number): SessionSummary {
  return {
    id: session.id,
    parentSessionId: session.parentSessionId,
    depth,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lifecycleState: session.lifecycleState,
    messageCount: session.messages.length,
    lastAssistantText: [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "",
  };
}

function normalizeSession(session: Session): Session {
  session.lifecycleState ??= "running";
  session.agentMessages ??= [];
  session.loadedSkills ??= [];
  return session;
}

async function readSessionFile(sessionPath: string): Promise<Session | null> {
  try {
    const raw = await fs.readFile(sessionPath, "utf8");
    return normalizeSession(JSON.parse(raw) as Session);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

function mergeSessionForSave(existing: Session, incoming: Session, options?: { allowTruncate?: boolean }): Session {
  const allowTruncate = options?.allowTruncate ?? false;
  return {
    ...existing,
    ...incoming,
    messages: allowTruncate || incoming.messages.length >= existing.messages.length ? incoming.messages : existing.messages,
    agentMessages: mergeAgentMessages(existing.agentMessages, incoming.agentMessages),
    toolHistory: allowTruncate || incoming.toolHistory.length >= existing.toolHistory.length ? incoming.toolHistory : existing.toolHistory,
    lifecycleState:
      incoming.lifecycleState === "running" && existing.lifecycleState !== "running" ? existing.lifecycleState : incoming.lifecycleState,
  };
}

function snapshotSessionAtMessage(source: Session, messageId: string): Pick<Session, "messages" | "toolHistory"> {
  const index = source.messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    throw new Error(`Message ${messageId} was not found in session ${source.id}.`);
  }

  const messages = source.messages.slice(0, index + 1);
  const retainedToolCallIds = new Set(
    messages.flatMap((message) => (message.role === "assistant" ? message.toolCalls.map((toolCall) => toolCall.id) : message.role === "tool" ? [message.toolCallId] : [])),
  );

  return {
    messages,
    toolHistory: source.toolHistory.filter((entry) => retainedToolCallIds.has(entry)),
  };
}

function mergeAgentMessages(existing: AgentMessageRecord[], incoming: AgentMessageRecord[]): AgentMessageRecord[] {
  const merged = new Map<string, AgentMessageRecord>();
  for (const message of existing) {
    merged.set(message.id, message);
  }

  for (const message of incoming) {
    merged.set(message.id, message);
  }

  return [...merged.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
