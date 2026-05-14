import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import crypto from "node:crypto";

import { LocalSubAgentRunner } from "./sub-agent.js";
import { MockProvider } from "../provider/mock-provider.js";
import type { ProviderAdapter } from "../provider/types.js";
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
    await createParentSessionFile(dataDir, "parent-session-1");
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

test("LocalSubAgentRunner sends messages to related sessions in the same session tree", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-workspace-"));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-data-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = dataDir;

  try {
    await createParentSessionFile(dataDir, "parent-session-1");
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
      /Session not-a-child was not found|same session tree/,
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
    assert.equal(initialStatus?.rootSessionId, parent);
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

test("LocalSubAgentRunner restores nested agent trees and supports recursive coordination", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-workspace-"));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-data-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = dataDir;

  try {
    const parent = await createParentSessionFile(dataDir, "parent-session-1");
    const provider: ProviderAdapter = {
      name: "nested-test",
      async complete(request) {
        const prompt = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
        if (/delegate twice/i.test(prompt)) {
          return {
            assistantText: "Delegating to a child agent.",
            toolCalls: [
              {
                id: crypto.randomUUID(),
                name: "spawn_agent",
                input: { task: "create a hello.py file", agentType: "worker" },
              },
            ],
            done: false,
          };
        }

        if (/create a hello\.py file/i.test(prompt)) {
          return {
            assistantText: "I will create hello.py.",
            toolCalls: [
              {
                id: crypto.randomUUID(),
                name: "write",
                input: { path: "hello.py", content: 'print("Hello, world!")\n' },
              },
            ],
            done: false,
          };
        }

        return { assistantText: "Nothing to do.", toolCalls: [], done: true };
      },
      async continueWithTools() {
        return { assistantText: "Task complete.", toolCalls: [], done: true };
      },
    };
    const runner = new LocalSubAgentRunner({
      workspaceRoot: workspace,
      provider,
      parentSessionId: parent,
      createToolAdapter: (subAgentRunner) => new LocalToolAdapter(workspace, subAgentRunner ? { subAgentRunner } : undefined),
    });

    const outer = await runner.run({ task: "delegate twice", agentType: "worker" }, new AbortController().signal);
    const direct = await runner.listChildSessions();
    const recursive = await runner.listChildSessions({ recursive: true });

    assert.equal(direct.length, 1);
    assert.equal(direct[0]?.id, outer.sessionId);
    assert.equal(direct[0]?.depth, 1);
    assert.equal(recursive.length, 2);
    assert.deepEqual(recursive.map((session) => session.depth).sort(), [1, 2]);

    const nested = recursive.find((session) => session.depth === 2);
    assert.ok(nested);
    const broadcast = await runner.broadcastMessage("Tree-wide note.", { sessionId: outer.sessionId, recursive: true });
    assert.equal(broadcast.length, 2);
    const sent = await runner.sendMessage(nested.id, "Report back when done.");
    assert.equal(sent.direction, "session_to_session");

    const nestedMessages = await runner.listAgentMessages(nested.id);
    assert.ok(nestedMessages.some((message) => message.content === "Tree-wide note."));
    assert.ok(nestedMessages.some((message) => message.content === "Report back when done."));

    const status = await runner.getTeamStatus({ recursive: true });
    assert.equal(status?.rootSessionId, parent);
    assert.equal(status?.focusSessionId, parent);
    assert.equal(status?.totalSessions, 3);

    const shutdown = await runner.requestShutdown(outer.sessionId, { recursive: true });
    assert.equal(shutdown.lifecycleState, "shutdown_requested");

    const cleaned = await runner.cleanupSession(outer.sessionId, { recursive: true });
    assert.equal(cleaned.lifecycleState, "cleaned_up");

    const nestedSession = await loadSession(nested.id);
    assert.equal(nestedSession.lifecycleState, "cleaned_up");
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

test("LocalSubAgentRunner shutdown requests abort active child runs", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-workspace-"));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-subagent-data-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = dataDir;

  try {
    const parent = await createParentSessionFile(dataDir, "parent-session-1");
    const provider: ProviderAdapter = {
      name: "shutdown-test",
      async complete(request) {
        const prompt = [...request.messages].reverse().find((message) => message.role === "user")?.content ?? "";
        if (/long sleep/i.test(prompt)) {
          return {
            assistantText: "Sleeping now.",
            toolCalls: [{ id: crypto.randomUUID(), name: "bash", input: { command: "sleep 5" } }],
            done: false,
          };
        }

        return { assistantText: "Nothing to do.", toolCalls: [], done: true };
      },
      async continueWithTools() {
        return { assistantText: "Task complete.", toolCalls: [], done: true };
      },
    };
    const runner = new LocalSubAgentRunner({
      workspaceRoot: workspace,
      provider,
      parentSessionId: parent,
      createToolAdapter: (subAgentRunner) => new LocalToolAdapter(workspace, subAgentRunner ? { subAgentRunner } : undefined),
    });

    const runPromise = runner.run({ task: "long sleep", agentType: "worker" }, new AbortController().signal);
    const activeChild = await waitForChildSession(runner);
    const activeRuns = await runner.listActiveRuns({ recursive: true });
    assert.ok(activeRuns.some((run) => run.sessionId === activeChild.id));
    const shutdown = await runner.requestShutdown(activeChild.id);

    assert.equal(shutdown.lifecycleState, "shutdown_requested");
    await assert.rejects(runPromise, /Shutdown requested by session/);

    const saved = await loadSession(activeChild.id);
    assert.equal(saved.lifecycleState, "shutdown_requested");

    const messages = await listAgentMessages(activeChild.id);
    assert.ok(messages.some((message) => /Shutdown requested by session/.test(message.content)));
    assert.ok(messages.some((message) => /Sub-agent worker stopped/.test(message.content)));
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

async function waitForChildSession(runner: LocalSubAgentRunner): Promise<{ id: string }> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const sessions = await runner.listChildSessions();
    if (sessions[0]) {
      return { id: sessions[0].id };
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for child session.");
}
