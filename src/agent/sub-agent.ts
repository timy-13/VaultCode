import { runAgentLoop } from "./loop.js";
import { createUserMessage, createSystemMessage } from "../session/messages.js";
import { createSession, saveSession } from "../session/store.js";
import type { ProviderAdapter } from "../provider/types.js";
import { LocalToolAdapter } from "../tools/local-tools.js";
import type { ToolAdapter, ToolExecutionRecord } from "../tools/types.js";

export interface SubAgentRunRequest {
  task: string;
  agentType?: string;
}

export interface SubAgentRunResult {
  sessionId: string;
  parentSessionId?: string;
  agentType: string;
  assistantText: string;
  toolRecords: ToolExecutionRecord[];
}

export interface SubAgentRunner {
  run(request: SubAgentRunRequest, signal: AbortSignal): Promise<SubAgentRunResult>;
}

export class LocalSubAgentRunner implements SubAgentRunner {
  constructor(
    private readonly options: {
      workspaceRoot: string;
      provider: ProviderAdapter;
      model?: string;
      parentSessionId?: string;
      createToolAdapter?: () => ToolAdapter;
      saveSession?: typeof saveSession;
    },
  ) {}

  async run(request: SubAgentRunRequest, signal: AbortSignal): Promise<SubAgentRunResult> {
    const session = createSession(this.options.parentSessionId);
    const agentType = request.agentType?.trim() || "worker";
    const toolAdapter = this.options.createToolAdapter?.() ?? new LocalToolAdapter(this.options.workspaceRoot);

    session.messages.push(createSystemMessage(buildSubAgentSystemPrompt(agentType)));
    session.messages.push(createUserMessage(request.task));

    try {
      const result = await runAgentLoop(
        session,
        this.options.provider,
        toolAdapter,
        this.options.model,
        () => {},
        () => {},
        signal,
      );
      const assistantText = [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";

      return {
        sessionId: session.id,
        parentSessionId: session.parentSessionId,
        agentType,
        assistantText,
        toolRecords: result.records,
      };
    } finally {
      await toolAdapter.dispose?.();
      await (this.options.saveSession ?? saveSession)(session);
    }
  }
}

function buildSubAgentSystemPrompt(agentType: string): string {
  return `You are the ${agentType} sub-agent. Work only on the delegated task, use tools if needed, and return a concise result for the parent agent.`;
}
