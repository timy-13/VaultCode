import OpenAI from "openai";
import type { ChatCompletionAssistantMessageParam, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

import type { HarnessConfig } from "../config/config.js";
import type { SessionMessage } from "../session/types.js";
import type { ToolDefinition, ToolResult } from "../tools/types.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "./types.js";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

export class OpenAiProvider implements ProviderAdapter {
  readonly name = "openai";

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: HarnessConfig) {
    const apiKey = config.apiKeys.openai;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required when provider=openai.");
    }

    this.client = new OpenAI({ apiKey });
    this.model = config.model ?? DEFAULT_OPENAI_MODEL;
  }

  async complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    return this.runCompletion(request, signal);
  }

  async continueWithTools(request: ProviderRequest, _results: ToolResult[], signal: AbortSignal): Promise<ProviderResponse> {
    return this.runCompletion(request, signal);
  }

  private async runCompletion(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const response = await this.client.chat.completions.create(
      {
        model: request.model ?? this.model,
        messages: toOpenAiMessages(request.messages),
        tools: toOpenAiTools(request.availableTools),
        tool_choice: request.availableTools.length > 0 ? "auto" : undefined,
      },
      { signal },
    );

    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error("OpenAI returned no message choices.");
    }

    const toolCalls =
      message.tool_calls?.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        input: parseToolArguments(toolCall.function.arguments, toolCall.function.name),
      })) ?? [];

    return {
      assistantText: message.content ?? (toolCalls.length > 0 ? "Calling tools." : ""),
      toolCalls,
      done: toolCalls.length === 0,
    };
  }
}

export function toOpenAiTools(tools: ToolDefinition[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

export function toOpenAiMessages(messages: SessionMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message) => {
    switch (message.role) {
      case "system":
        return { role: "system", content: message.content };
      case "user":
        return { role: "user", content: message.content };
      case "assistant": {
        const assistantMessage: ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: message.content || null,
        };

        if (message.toolCalls.length > 0) {
          assistantMessage.tool_calls = message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function",
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.input),
            },
          }));
        }

        return assistantMessage;
      }
      case "tool":
        return {
          role: "tool",
          tool_call_id: message.toolCallId,
          content: stringifyToolResult(message.result),
        };
      default:
        return assertNever(message);
    }
  });
}

function stringifyToolResult(result: ToolResult): string {
  return JSON.stringify({
    ok: result.ok,
    summary: result.summary,
    data: result.data,
    error: result.error,
  });
}

export function parseToolArguments(raw: string, toolName: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Tool arguments must be an object.");
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to parse tool arguments for ${toolName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected message role: ${JSON.stringify(value)}`);
}
