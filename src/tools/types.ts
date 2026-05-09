export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface JsonArray extends Array<JsonValue> {}

export interface ToolInputSchemaProperty {
  type: "string" | "number" | "boolean";
  description: string;
}

export interface ToolInputSchema {
  [key: string]: unknown;
  type: "object";
  properties: Record<string, ToolInputSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  ok: boolean;
  cancelled?: boolean;
  summary: string;
  data?: JsonValue;
  error?: {
    message: string;
  };
}

export interface ToolExecutionRecord {
  callId: string;
  name: string;
  status: "success" | "error" | "cancelled";
  durationMs: number;
  summary: string;
}

export interface ToolAdapter {
  listTools(): ToolDefinition[];
  executeTool(call: ToolCall, signal: AbortSignal): Promise<ToolResult>;
  dispose?(): Promise<void>;
}
