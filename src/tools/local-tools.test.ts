import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { SubAgentRunner } from "../agent/sub-agent.js";
import type { WorkspaceLspService } from "../lsp/types.js";
import { LocalToolAdapter } from "./local-tools.js";

test("local tool definitions expose structured schemas", () => {
  const adapter = new LocalToolAdapter(process.cwd());
  const write = adapter.listTools().find((tool) => tool.name === "write");
  const lspDiagnostics = adapter.listTools().find((tool) => tool.name === "lsp_diagnostics");
  const listAgentTypes = adapter.listTools().find((tool) => tool.name === "list_agent_types");
  const listAgentMessages = adapter.listTools().find((tool) => tool.name === "list_agent_messages");
  const spawnAgent = adapter.listTools().find((tool) => tool.name === "spawn_agent");

  assert.ok(write);
  assert.ok(lspDiagnostics);
  assert.equal(listAgentTypes, undefined);
  assert.equal(listAgentMessages, undefined);
  assert.equal(spawnAgent, undefined);
  assert.deepEqual(write?.inputSchema.required, ["path", "content"]);
  assert.equal(write?.inputSchema.additionalProperties, false);
});

test("write tool returns structured result payload", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-tools-"));

  try {
    const adapter = new LocalToolAdapter(workspace);
    const result = await adapter.executeTool(
      {
        id: "call-1",
        name: "write",
        input: { path: "nested/hello.txt", content: "hello\n" },
      },
      new AbortController().signal,
    );

    assert.equal(result.ok, true);
    assert.equal(result.summary, "Wrote nested/hello.txt");
    assert.deepEqual(result.data, { path: "nested/hello.txt", bytesWritten: 6 });
    const written = await fs.readFile(path.join(workspace, "nested/hello.txt"), "utf8");
    assert.equal(written, "hello\n");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("bash tool reports cancellation distinctly", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-tools-"));

  try {
    const adapter = new LocalToolAdapter(workspace);
    const controller = new AbortController();
    const resultPromise = adapter.executeTool(
      {
        id: "call-2",
        name: "bash",
        input: { command: "sleep 5" },
      },
      controller.signal,
    );

    setTimeout(() => {
      controller.abort(new Error("Cancelled by user."));
    }, 50);

    const result = await resultPromise;
    assert.equal(result.ok, false);
    assert.equal(result.cancelled, true);
    assert.equal(result.summary, "Tool bash cancelled");
    assert.equal(result.error?.message, "Cancelled by user.");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("lsp tools return structured results through an injected service", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-tools-"));

  try {
    const fakeLsp: WorkspaceLspService = {
      async getDiagnostics(filePath: string) {
        return [
          {
            message: "Missing semicolon",
            severity: "warning",
            range: {
              start: { line: 0, character: 1 },
              end: { line: 0, character: 2 },
            },
          },
        ];
      },
      async getDefinition() {
        return [
          {
            path: "src/example.ts",
            range: {
              start: { line: 1, character: 0 },
              end: { line: 1, character: 3 },
            },
          },
        ];
      },
      async getReferences() {
        return [];
      },
      async getCompletions() {
        return [
          {
            label: "console",
            kind: "6",
            detail: "const console: Console",
            documentation: "Node console",
          },
        ];
      },
      async dispose() {},
    };

    const adapter = new LocalToolAdapter(workspace, { lspService: fakeLsp });
    const diagnosticsResult = await adapter.executeTool(
      {
        id: "call-3",
        name: "lsp_diagnostics",
        input: { path: "src/example.ts" },
      },
      new AbortController().signal,
    );
    const definitionResult = await adapter.executeTool(
      {
        id: "call-4",
        name: "lsp_definition",
        input: { path: "src/example.ts", line: 0, character: 1 },
      },
      new AbortController().signal,
    );
    const completionsResult = await adapter.executeTool(
      {
        id: "call-4b",
        name: "lsp_completions",
        input: { path: "src/example.ts", line: 0, character: 1 },
      },
      new AbortController().signal,
    );

    assert.equal(diagnosticsResult.ok, true);
    assert.equal(diagnosticsResult.summary, "Found 1 diagnostic(s) in src/example.ts");
    assert.deepEqual(diagnosticsResult.data, {
      path: "src/example.ts",
      diagnostics: [
        {
          message: "Missing semicolon",
          severity: "warning",
          source: null,
          code: null,
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 2 },
          },
        },
      ],
    });

    assert.equal(definitionResult.ok, true);
    assert.equal(definitionResult.summary, "Found 1 definition location(s) for src/example.ts:0:1");
    assert.equal(completionsResult.ok, true);
    assert.equal(completionsResult.summary, "Found 1 completion item(s) for src/example.ts:0:1");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("lsp tool failures stay structured when the server is unavailable", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-tools-"));

  try {
    const failingLsp: WorkspaceLspService = {
      async getDiagnostics() {
        throw new Error("TypeScript LSP is unavailable. Install `typescript-language-server`.");
      },
      async getDefinition() {
        throw new Error("unexpected");
      },
      async getCompletions() {
        throw new Error("unexpected");
      },
      async getReferences() {
        throw new Error("unexpected");
      },
      async dispose() {},
    };

    const adapter = new LocalToolAdapter(workspace, { lspService: failingLsp });
    const result = await adapter.executeTool(
      {
        id: "call-5",
        name: "lsp_diagnostics",
        input: { path: "src/example.ts" },
      },
      new AbortController().signal,
    );

    assert.equal(result.ok, false);
    assert.equal(result.summary, "Tool lsp_diagnostics failed");
    assert.match(result.error?.message ?? "", /TypeScript LSP is unavailable/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("spawn_agent returns structured child-agent results through an injected runner", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-tools-"));

  try {
    const fakeRunner: SubAgentRunner = {
      async run(request) {
        return {
          sessionId: "child-session-1",
          parentSessionId: "parent-session-1",
          agentType: request.agentType ?? "worker",
          assistantText: "Delegated task complete.",
          toolRecords: [
            {
              callId: "child-call-1",
              name: "read",
              status: "success",
              durationMs: 12,
              summary: "Read README.md",
            },
          ],
        };
      },
      async listAgentTypes() {
        return [{ name: "worker", description: "general execution agent" }];
      },
      async listChildSessions() {
        return [
          {
            id: "child-session-1",
            parentSessionId: "parent-session-1",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:01.000Z",
            messageCount: 3,
            lastAssistantText: "Delegated task complete.",
          },
        ];
      },
      async listAgentMessages(sessionId: string) {
        return [
          {
            id: "message-1",
            fromSessionId: "parent-session-1",
            toSessionId: sessionId,
            direction: "parent_to_child",
            createdAt: "2024-01-01T00:00:02.000Z",
            content: "Double-check the output.",
          },
        ];
      },
      async sendMessage(sessionId: string, content: string) {
        return {
          id: "message-2",
          fromSessionId: "parent-session-1",
          toSessionId: sessionId,
          direction: "parent_to_child",
          createdAt: "2024-01-01T00:00:03.000Z",
          content,
        };
      },
    };

    const adapter = new LocalToolAdapter(workspace, { subAgentRunner: fakeRunner });
    const listAgentTypesTool = adapter.listTools().find((tool) => tool.name === "list_agent_types");
    const listAgentSessionsTool = adapter.listTools().find((tool) => tool.name === "list_agent_sessions");
    const listAgentMessagesTool = adapter.listTools().find((tool) => tool.name === "list_agent_messages");
    const sendAgentMessageTool = adapter.listTools().find((tool) => tool.name === "send_agent_message");
    const spawnTool = adapter.listTools().find((tool) => tool.name === "spawn_agent");
    assert.ok(listAgentTypesTool);
    assert.ok(listAgentSessionsTool);
    assert.ok(listAgentMessagesTool);
    assert.ok(sendAgentMessageTool);
    assert.ok(spawnTool);

    const agentTypesResult = await adapter.executeTool(
      {
        id: "call-5a",
        name: "list_agent_types",
        input: {},
      },
      new AbortController().signal,
    );
    const agentSessionsResult = await adapter.executeTool(
      {
        id: "call-5b",
        name: "list_agent_sessions",
        input: {},
      },
      new AbortController().signal,
    );
    const agentMessagesResult = await adapter.executeTool(
      {
        id: "call-5c",
        name: "list_agent_messages",
        input: { sessionId: "child-session-1" },
      },
      new AbortController().signal,
    );
    const sendAgentMessageResult = await adapter.executeTool(
      {
        id: "call-5d",
        name: "send_agent_message",
        input: { sessionId: "child-session-1", content: "Double-check the output." },
      },
      new AbortController().signal,
    );

    const result = await adapter.executeTool(
      {
        id: "call-6",
        name: "spawn_agent",
        input: { task: "Review the README", agentType: "worker" },
      },
      new AbortController().signal,
    );

    assert.equal(agentTypesResult.ok, true);
    assert.deepEqual(agentTypesResult.data, {
      agentTypes: [{ name: "worker", description: "general execution agent" }],
    });
    assert.equal(agentSessionsResult.ok, true);
    assert.deepEqual(agentSessionsResult.data, {
      sessions: [
        {
          id: "child-session-1",
          parentSessionId: "parent-session-1",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:01.000Z",
          messageCount: 3,
          lastAssistantText: "Delegated task complete.",
        },
      ],
    });
    assert.equal(agentMessagesResult.ok, true);
    assert.deepEqual(agentMessagesResult.data, {
      sessionId: "child-session-1",
      messages: [
        {
          id: "message-1",
          fromSessionId: "parent-session-1",
          toSessionId: "child-session-1",
          direction: "parent_to_child",
          createdAt: "2024-01-01T00:00:02.000Z",
          content: "Double-check the output.",
        },
      ],
    });
    assert.equal(sendAgentMessageResult.ok, true);
    assert.deepEqual(sendAgentMessageResult.data, {
      id: "message-2",
      fromSessionId: "parent-session-1",
      toSessionId: "child-session-1",
      direction: "parent_to_child",
      createdAt: "2024-01-01T00:00:03.000Z",
      content: "Double-check the output.",
    });
    assert.equal(result.ok, true);
    assert.equal(result.summary, "Sub-agent worker completed in session child-session-1");
    assert.deepEqual(result.data, {
      sessionId: "child-session-1",
      parentSessionId: "parent-session-1",
      agentType: "worker",
      assistantText: "Delegated task complete.",
      toolRecords: [
        {
          callId: "child-call-1",
          name: "read",
          status: "success",
          durationMs: 12,
          summary: "Read README.md",
        },
      ],
    });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
