import assert from "node:assert/strict";
import test from "node:test";

import { createAssistantMessage, createToolMessage, createUserMessage } from "../session/messages.js";
import { toOpenAiMessages, toOpenAiTools } from "./openai-provider.js";

test("toOpenAiTools exposes JSON schema parameters", () => {
  const tools = toOpenAiTools([
    {
      name: "write",
      description: "Write a file",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "file path" },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  ]);

  assert.equal(tools[0]?.function.name, "write");
  assert.deepEqual(tools[0]?.function.parameters, {
    type: "object",
    properties: {
      path: { type: "string", description: "file path" },
    },
    required: ["path"],
    additionalProperties: false,
  });
});

test("toOpenAiMessages preserves assistant tool calls and tool results", () => {
  const toolCall = {
    id: "call-1",
    name: "write",
    input: { path: "hello.py", content: 'print("hi")\n' },
  };
  const messages = toOpenAiMessages([
    createUserMessage("create hello"),
    createAssistantMessage("Creating file", [toolCall]),
    createToolMessage({
      callId: "call-1",
      name: "write",
      ok: true,
      summary: "Wrote hello.py",
      data: { path: "hello.py" },
    }),
  ]);

  assert.equal(messages[1]?.role, "assistant");
  if (messages[1]?.role !== "assistant") {
    throw new Error("Expected assistant message");
  }

  assert.equal(messages[1].tool_calls?.[0]?.id, "call-1");
  assert.equal(messages[2]?.role, "tool");
  if (messages[2]?.role !== "tool") {
    throw new Error("Expected tool message");
  }

  assert.equal(typeof messages[2].content, "string");
  assert.match(messages[2].content as string, /Wrote hello\.py/);
});
