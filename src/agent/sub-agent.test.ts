import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalSubAgentRunner } from "./sub-agent.js";
import { MockProvider } from "../provider/mock-provider.js";
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
