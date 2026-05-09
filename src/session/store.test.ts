import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAssistantMessage, createUserMessage } from "./messages.js";
import { appendAgentMessage, branchSession, createSession, listAgentMessages, listChildSessions, saveSession } from "./store.js";

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
