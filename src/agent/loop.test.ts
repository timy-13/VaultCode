import assert from "node:assert/strict";
import test from "node:test";

import { runAgentLoop } from "./loop.js";
import { OperationCancelledError } from "../runtime/abort.js";
import { createSession } from "../session/store.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "../provider/types.js";
import type { ToolAdapter, ToolCall, ToolDefinition, ToolExecutionRecord, ToolResult } from "../tools/types.js";

test("runAgentLoop stops after a cancelled tool result", async () => {
  const session = createSession();
  const toolRecords: ToolExecutionRecord[] = [];
  let continueCalled = false;

  const provider: ProviderAdapter = {
    name: "test-provider",
    async complete(_request: ProviderRequest): Promise<ProviderResponse> {
      return {
        assistantText: "Running a tool.",
        toolCalls: [{ id: "call-1", name: "bash", input: { command: "sleep 5" } }],
        done: false,
      };
    },
    async continueWithTools(): Promise<ProviderResponse> {
      continueCalled = true;
      return { assistantText: "should not happen", toolCalls: [], done: true };
    },
  };

  const tools: ToolAdapter = {
    listTools(): ToolDefinition[] {
      return [];
    },
    async executeTool(call: ToolCall): Promise<ToolResult> {
      return {
        callId: call.id,
        name: call.name,
        ok: false,
        cancelled: true,
        summary: "Tool bash cancelled",
        error: { message: "Cancelled by user." },
      };
    },
  };

  await assert.rejects(
    () =>
      runAgentLoop(session, provider, tools, undefined, () => {}, (record) => {
        toolRecords.push(record);
      }, new AbortController().signal),
    (error: unknown) => error instanceof OperationCancelledError,
  );

  assert.equal(continueCalled, false);
  assert.equal(toolRecords.length, 1);
  assert.equal(toolRecords[0]?.status, "cancelled");
  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[0]?.role, "assistant");
  assert.equal(session.messages[1]?.role, "tool");
  if (session.messages[1]?.role !== "tool") {
    throw new Error("Expected a tool message");
  }

  assert.equal(session.messages[1].status, "cancelled");
});

test("runAgentLoop propagates provider cancellation before mutating the session", async () => {
  const session = createSession();

  const provider: ProviderAdapter = {
    name: "test-provider",
    async complete(_request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(signal.reason ?? new OperationCancelledError("Cancelled by user."));
          },
          { once: true },
        );
      });
    },
    async continueWithTools(): Promise<ProviderResponse> {
      throw new Error("continueWithTools should not be called");
    },
  };

  const tools: ToolAdapter = {
    listTools(): ToolDefinition[] {
      return [];
    },
    async executeTool(): Promise<ToolResult> {
      throw new Error("executeTool should not be called");
    },
  };

  const controller = new AbortController();
  const runPromise = runAgentLoop(session, provider, tools, undefined, () => {}, () => {}, controller.signal);
  controller.abort(new OperationCancelledError("Cancelled by user."));

  await assert.rejects(runPromise, (error: unknown) => error instanceof OperationCancelledError);
  assert.equal(session.messages.length, 0);
  assert.equal(session.toolHistory.length, 0);
});
