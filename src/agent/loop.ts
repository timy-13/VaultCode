import { createAssistantMessage, createToolMessage } from "../session/messages.js";
import type { Session } from "../session/types.js";
import type { ProviderAdapter } from "../provider/types.js";
import type { ToolAdapter, ToolExecutionRecord, ToolResult } from "../tools/types.js";

export interface AgentLoopResult {
  records: ToolExecutionRecord[];
}

export async function runAgentLoop(
  session: Session,
  provider: ProviderAdapter,
  tools: ToolAdapter,
  model: string | undefined,
  onAssistant: (content: string) => void,
  onToolRecord: (record: ToolExecutionRecord) => void,
  signal: AbortSignal,
): Promise<AgentLoopResult> {
  const records: ToolExecutionRecord[] = [];

  let response = await provider.complete(
    {
      model,
      messages: session.messages,
      availableTools: tools.listTools(),
    },
    signal,
  );

  while (true) {
    const assistantMessage = createAssistantMessage(
      response.assistantText,
      response.toolCalls,
    );
    session.messages.push(assistantMessage);
    onAssistant(response.assistantText);

    if (response.toolCalls.length === 0 || response.done) {
      break;
    }

    const results: ToolResult[] = [];
    for (const call of response.toolCalls) {
      const startedAt = Date.now();
      const result = await tools.executeTool(call, signal);
      const record: ToolExecutionRecord = {
        callId: call.id,
        name: call.name,
        status: result.ok ? "success" : "error",
        durationMs: Date.now() - startedAt,
      };
      records.push(record);
      session.toolHistory.push(call.id);
      session.messages.push(createToolMessage(result));
      onToolRecord(record);
      results.push(result);
    }

    response = await provider.continueWithTools(
      {
        model,
        messages: session.messages,
        availableTools: tools.listTools(),
      },
      results,
      signal,
    );
  }

  return { records };
}
