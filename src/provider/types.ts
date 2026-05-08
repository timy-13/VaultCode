import type { SessionMessage } from "../session/types.js";
import type { ToolCall, ToolDefinition, ToolResult } from "../tools/types.js";

export interface ProviderRequest {
  model?: string;
  messages: SessionMessage[];
  availableTools: ToolDefinition[];
}

export interface ProviderResponse {
  assistantText: string;
  toolCalls: ToolCall[];
  done: boolean;
}

export interface ProviderAdapter {
  name: string;
  complete(request: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>;
  continueWithTools(request: ProviderRequest, results: ToolResult[], signal: AbortSignal): Promise<ProviderResponse>;
}
