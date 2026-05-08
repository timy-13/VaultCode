import OpenAI from "openai";

import type { HarnessConfig } from "../config/config.js";
import { parseToolArguments, toOpenAiMessages, toOpenAiTools } from "./openai-provider.js";
import type { ProviderAdapter, ProviderRequest, ProviderResponse } from "./types.js";
import type { ToolResult } from "../tools/types.js";

const DEFAULT_OPENCODE_BASE_URL = "https://opencode.ai/zen/v1";

export class OpenCodeProvider implements ProviderAdapter {
  readonly name = "opencode";

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: HarnessConfig) {
    const apiKey = config.apiKeys.opencode;
    if (!apiKey) {
      throw new Error("OPENCODE_API_KEY is required when provider=opencode.");
    }

    if (!config.model) {
      throw new Error("A model is required when provider=opencode. Pass --model <model-id> or set TIMCODE_MODEL.");
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: process.env.OPENCODE_BASE_URL ?? DEFAULT_OPENCODE_BASE_URL,
    });
    this.model = config.model;
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
      throw new Error("OpenCode Zen returned no message choices.");
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
