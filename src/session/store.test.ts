import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAssistantMessage, createUserMessage } from "./messages.js";
import {
  appendAgentMessage,
  branchSession,
  createSession,
  getSessionTree,
  getTeamStatus,
  isSameSessionTree,
  listAgentMessages,
  listChildSessions,
  restoreSessionToMessage,
  saveSession,
  saveSessionWithOptions,
  updateSessionLifecycle,
} from "./store.js";

test("branchSession keeps history through the selected message", () => {
  const session = createSession();
  const first = createUserMessage("one");
  const second = createAssistantMessage("two", [{ id: "tool-1", name: "write", input: { path: "a.txt" } }]);
  const third = createUserMessage("three");
  session.messages.push(first, second, third);
  session.toolHistory.push("tool-1", "tool-2");

  const branch = branchSession(session, second.id);

  assert.equal(branch.parentSessionId, session.id);
  assert.deepEqual(
    branch.messages.map((message) => message.id),
    [first.id, second.id],
  );
  assert.deepEqual(branch.toolHistory, ["tool-1"]);
});

test("restoreSessionToMessage truncates history through the selected message", () => {
  const session = createSession();
  const first = createUserMessage("one");
  const second = createAssistantMessage("two", [{ id: "tool-1", name: "write", input: { path: "a.txt" } }]);
  const third = createUserMessage("three");
  session.messages.push(first, second, third);
  session.toolHistory.push("tool-1", "tool-2");

  restoreSessionToMessage(session, second.id);

  assert.deepEqual(
    session.messages.map((message) => message.id),
    [first.id, second.id],
  );
  assert.deepEqual(session.toolHistory, ["tool-1"]);
});

test("saveSessionWithOptions allows persisted session truncation", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-session-store-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = dataDir;

  try {
    const session = createSession();
    const first = createUserMessage("one");
    const second = createAssistantMessage("two", [{ id: "tool-1", name: "write", input: { path: "a.txt" } }]);
    const third = createUserMessage("three");
    session.messages.push(first, second, third);
    session.toolHistory.push("tool-1", "tool-2");
    await saveSession(session);

    restoreSessionToMessage(session, second.id);
    await saveSessionWithOptions(session, { allowTruncate: true });

    const persisted = JSON.parse(
      await fs.readFile(path.join(dataDir, "sessions", `${session.id}.json`), "utf8"),
    ) as { messages: Array<{ id: string }>; toolHistory: string[] };
    assert.deepEqual(
      persisted.messages.map((message) => message.id),
      [first.id, second.id],
    );
    assert.deepEqual(persisted.toolHistory, ["tool-1"]);
  } finally {
    if (originalDataDir === undefined) {
      delete process.env.TIMCODE_DATA_DIR;
    } else {
      process.env.TIMCODE_DATA_DIR = originalDataDir;
    }

    if (originalConfigDir === undefined) {
      delete process.env.TIMCODE_CONFIG_DIR;
    } else {
      process.env.TIMCODE_CONFIG_DIR = originalConfigDir;
    }

    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("listChildSessions returns direct child summaries sorted by update time", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-session-store-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = dataDir;

  try {
    const childOne = createSession("parent-1");
    childOne.messages.push(createAssistantMessage("older result", []));
    const childTwo = createSession("parent-1");
    childTwo.messages.push(createAssistantMessage("newer result", []));
    const unrelated = createSession("parent-2");
    unrelated.messages.push(createAssistantMessage("ignore me", []));

    await saveSession(childOne);
    await saveSession(childTwo);
    await saveSession(unrelated);

    const childOnePath = path.join(dataDir, "sessions", `${childOne.id}.json`);
    const childTwoPath = path.join(dataDir, "sessions", `${childTwo.id}.json`);
    const childOneSaved = JSON.parse(await fs.readFile(childOnePath, "utf8")) as { [key: string]: unknown };
    const childTwoSaved = JSON.parse(await fs.readFile(childTwoPath, "utf8")) as { [key: string]: unknown };
    childOneSaved.updatedAt = "2024-01-01T00:00:00.000Z";
    childTwoSaved.updatedAt = "2024-01-02T00:00:00.000Z";
    await fs.writeFile(childOnePath, JSON.stringify(childOneSaved, null, 2));
    await fs.writeFile(childTwoPath, JSON.stringify(childTwoSaved, null, 2));

    const summaries = await listChildSessions("parent-1");
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0]?.id, childTwo.id);
    assert.equal(summaries[0]?.depth, 1);
    assert.equal(summaries[0]?.lastAssistantText, "newer result");
    assert.equal(summaries[1]?.id, childOne.id);
    assert.equal(summaries[1]?.messageCount, 1);
  } finally {
    if (originalDataDir === undefined) {
      delete process.env.TIMCODE_DATA_DIR;
    } else {
      process.env.TIMCODE_DATA_DIR = originalDataDir;
    }

    if (originalConfigDir === undefined) {
      delete process.env.TIMCODE_CONFIG_DIR;
    } else {
      process.env.TIMCODE_CONFIG_DIR = originalConfigDir;
    }

    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("appendAgentMessage and listAgentMessages persist parent-child notes", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-session-store-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = dataDir;

  try {
    const child = createSession("parent-1");
    await saveSession(child);

    await appendAgentMessage({
      sessionId: child.id,
      fromSessionId: "parent-1",
      toSessionId: child.id,
      direction: "parent_to_child",
      content: "Check the README first.",
    });

    const messages = await listAgentMessages(child.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.direction, "parent_to_child");
    assert.equal(messages[0]?.content, "Check the README first.");
  } finally {
    if (originalDataDir === undefined) {
      delete process.env.TIMCODE_DATA_DIR;
    } else {
      process.env.TIMCODE_DATA_DIR = originalDataDir;
    }

    if (originalConfigDir === undefined) {
      delete process.env.TIMCODE_CONFIG_DIR;
    } else {
      process.env.TIMCODE_CONFIG_DIR = originalConfigDir;
    }

    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("getTeamStatus aggregates parent and child lifecycle counts", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-session-store-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = dataDir;

  try {
    const parent = createSession();
    const childOne = createSession(parent.id);
    const childTwo = createSession(parent.id);
    await saveSession(parent);
    await saveSession(childOne);
    await saveSession(childTwo);
    await updateSessionLifecycle(childOne.id, "completed");
    await updateSessionLifecycle(childTwo.id, "shutdown_requested");

    const status = await getTeamStatus(parent.id);
    assert.equal(status.totalSessions, 3);
    assert.equal(status.rootSessionId, parent.id);
    assert.equal(status.focusSessionId, parent.id);
    assert.deepEqual(status.counts, {
      running: 1,
      shutdown_requested: 1,
      completed: 1,
      cleaned_up: 0,
    });
  } finally {
    if (originalDataDir === undefined) {
      delete process.env.TIMCODE_DATA_DIR;
    } else {
      process.env.TIMCODE_DATA_DIR = originalDataDir;
    }

    if (originalConfigDir === undefined) {
      delete process.env.TIMCODE_CONFIG_DIR;
    } else {
      process.env.TIMCODE_CONFIG_DIR = originalConfigDir;
    }

    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("recursive team traversal restores the full session tree from any node", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-session-store-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = dataDir;

  try {
    const root = createSession();
    const child = createSession(root.id);
    const grandchild = createSession(child.id);
    const cousin = createSession(root.id);
    await saveSession(root);
    await saveSession(child);
    await saveSession(grandchild);
    await saveSession(cousin);

    const descendants = await listChildSessions(root.id, { recursive: true });
    assert.deepEqual(
      descendants
        .map((session) => [session.id, session.depth] as const)
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      [
        [child.id, 1],
        [cousin.id, 1],
        [grandchild.id, 2],
      ].sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    );

    const tree = await getSessionTree(grandchild.id);
    assert.deepEqual(
      tree
        .map((session) => [session.id, session.depth] as const)
        .sort((left, right) => Number(left[1]) - Number(right[1]) || String(left[0]).localeCompare(String(right[0]))),
      [
        [root.id, 0],
        [child.id, 1],
        [cousin.id, 1],
        [grandchild.id, 2],
      ].sort((left, right) => Number(left[1]) - Number(right[1]) || String(left[0]).localeCompare(String(right[0]))),
    );

    const status = await getTeamStatus(grandchild.id, { recursive: true });
    assert.equal(status.rootSessionId, root.id);
    assert.equal(status.focusSessionId, grandchild.id);
    assert.equal(status.totalSessions, 4);
    assert.equal(await isSameSessionTree(grandchild.id, cousin.id), true);
  } finally {
    if (originalDataDir === undefined) {
      delete process.env.TIMCODE_DATA_DIR;
    } else {
      process.env.TIMCODE_DATA_DIR = originalDataDir;
    }

    if (originalConfigDir === undefined) {
      delete process.env.TIMCODE_CONFIG_DIR;
    } else {
      process.env.TIMCODE_CONFIG_DIR = originalConfigDir;
    }

    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
