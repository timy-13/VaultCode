import crypto from "node:crypto";

import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "./types.js";
import type { ToolResult } from "../tools/types.js";

export class MockProvider implements ProviderAdapter {
  readonly name = "mock";

  async complete(request: ProviderRequest): Promise<ProviderResponse> {
    const lastUserMessage = [...request.messages].reverse().find((message) => message.role === "user");
    const prompt = lastUserMessage?.content ?? "";

    if (/create a hello\.py file/i.test(prompt)) {
      return {
        assistantText: "I will create `hello.py` in the workspace.",
        toolCalls: [
          {
            id: crypto.randomUUID(),
            name: "write",
            input: {
              path: "hello.py",
              content: 'print("Hello, world!")\n',
            },
          },
        ],
        done: false,
      };
    }

    if (/readme/i.test(prompt)) {
      return {
        assistantText: "I can scaffold the harness core, but the mock provider only automates a narrow set of tasks right now.",
        toolCalls: [],
        done: true,
      };
    }

    return {
      assistantText: "The mock provider is active. It can handle `create a hello.py file` end-to-end while the real LLM adapters are still being implemented.",
      toolCalls: [],
      done: true,
    };
  }

  async continueWithTools(_request: ProviderRequest, results: ToolResult[]): Promise<ProviderResponse> {
    const failed = results.find((result) => !result.ok);
    if (failed) {
      return {
        assistantText: `The tool call failed: ${failed.error?.message ?? "unknown error"}`,
        toolCalls: [],
        done: true,
      };
    }

    return {
      assistantText: "Task complete.",
      toolCalls: [],
      done: true,
    };
  }
}
