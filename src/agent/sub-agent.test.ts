import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalSubAgentRunner } from "./sub-agent.js";
import { MockProvider } from "../provider/mock-provider.js";
import { listAgentMessages, loadSession } from "../session/store.js";
import { LocalToolAdapter } from "../tools/local-tools.js";

test("LocalSubAgentRunner saves an isolated child session and returns its result", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-workspace-"));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-data-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = dataDir;

  try {
    const runner = new LocalSubAgentRunner({
      workspaceRoot: workspace,
      provider: new MockProvider(),
      parentSessionId: "parent-session-1",
      createToolAdapter: () => new LocalToolAdapter(workspace),
    });

    const result = await runner.run(
      {
        task: "create a hello.py file",
        agentType: "worker",
      },
      new AbortController().signal,
    );

    assert.equal(result.agentType, "worker");
    assert.equal(result.parentSessionId, "parent-session-1");
    assert.equal(result.assistantText, "Task complete.");
    assert.equal(result.toolRecords.length, 1);
    assert.equal(result.toolRecords[0]?.name, "write");

    const sessionPath = path.join(dataDir, "sessions", `${result.sessionId}.json`);
    const savedSession = JSON.parse(await fs.readFile(sessionPath, "utf8")) as {
      parentSessionId?: string;
      messages: Array<{ role: string; content?: string }>;
    };

    assert.equal(savedSession.parentSessionId, "parent-session-1");
    assert.equal(savedSession.messages[0]?.role, "system");
    assert.match(savedSession.messages[0]?.content ?? "", /worker sub-agent/);
    assert.equal(savedSession.messages[1]?.role, "user");

    const helloPath = path.join(workspace, "hello.py");
    assert.equal(await fs.readFile(helloPath, "utf8"), 'print("Hello, world!")\n');

    const childSession = await loadSession(result.sessionId);
    assert.equal(childSession.lifecycleState, "completed");

    const childMessages = await listAgentMessages(result.sessionId);
    assert.equal(childMessages.length, 1);
    assert.equal(childMessages[0]?.direction, "child_to_parent");
    assert.match(childMessages[0]?.content ?? "", /Sub-agent worker completed/);
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

    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("LocalSubAgentRunner lists built-in agent types and rejects unknown ones", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-workspace-"));

  try {
    const runner = new LocalSubAgentRunner({
      workspaceRoot: workspace,
      provider: new MockProvider(),
      createToolAdapter: () => new LocalToolAdapter(workspace),
    });

    const agentTypes = await runner.listAgentTypes();
    assert.deepEqual(
      agentTypes.map((agentType) => agentType.name),
      ["worker", "explorer", "reviewer", "general"],
    );

    await assert.rejects(
      () => runner.run({ task: "do something", agentType: "unknown" }, new AbortController().signal),
      /Unknown agent type: unknown/,
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("LocalSubAgentRunner sends messages only to direct child sessions", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-workspace-"));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-data-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = dataDir;

  try {
    const runner = new LocalSubAgentRunner({
      workspaceRoot: workspace,
      provider: new MockProvider(),
      parentSessionId: "parent-session-1",
      createToolAdapter: () => new LocalToolAdapter(workspace),
    });

    const child = await runner.run({ task: "create a hello.py file", agentType: "worker" }, new AbortController().signal);
    const sent = await runner.sendMessage(child.sessionId, "Double-check the output.");
    assert.equal(sent.direction, "parent_to_child");
    assert.equal(sent.toSessionId, child.sessionId);

    const messages = await runner.listAgentMessages(child.sessionId);
    assert.equal(messages.length, 2);
    assert.match(messages[0]?.content ?? "", /Sub-agent worker completed/);
    assert.equal(messages[1]?.content, "Double-check the output.");

    await assert.rejects(
      () => runner.sendMessage("not-a-child", "hello"),
      /ENOENT|not a direct child/,
    );
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

    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("LocalSubAgentRunner exposes team status and lifecycle transitions for direct children", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-workspace-"));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-data-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = dataDir;

  try {
    const parent = await createParentSessionFile(dataDir, "parent-session-1");
    const runner = new LocalSubAgentRunner({
      workspaceRoot: workspace,
      provider: new MockProvider(),
      parentSessionId: parent,
      createToolAdapter: () => new LocalToolAdapter(workspace),
    });

    const child = await runner.run({ task: "create a hello.py file", agentType: "worker" }, new AbortController().signal);
    const initialStatus = await runner.getTeamStatus();
    assert.equal(initialStatus?.totalSessions, 2);
    assert.equal(initialStatus?.counts.completed, 1);

    const shutdown = await runner.requestShutdown(child.sessionId);
    assert.equal(shutdown.lifecycleState, "shutdown_requested");
    const cleaned = await runner.cleanupSession(child.sessionId);
    assert.equal(cleaned.lifecycleState, "cleaned_up");

    const finalStatus = await runner.getTeamStatus();
    assert.equal(finalStatus?.counts.cleaned_up, 1);
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

    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

async function createParentSessionFile(dataDir: string, sessionId: string): Promise<string> {
  const sessionsDir = path.join(dataDir, "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    path.join(sessionsDir, `${sessionId}.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lifecycleState: "running",
        messages: [],
        agentMessages: [],
        toolHistory: [],
      },
      null,
      2,
    ),
  );
  return sessionId;
}
