import { runAgentLoop } from "./loop.js";
import { listAgentDefinitions, resolveAgentDefinition } from "./registry.js";
import { createUserMessage, createSystemMessage } from "../session/messages.js";
import {
  appendAgentMessage,
  createSession,
  listAgentMessages,
  listChildSessions,
  loadSession,
  saveSession,
  type AgentMessageSummary,
  type SessionSummary,
} from "../session/store.js";
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
  listAgentTypes(): Promise<Array<{ name: string; description: string }>>;
  listChildSessions(): Promise<SessionSummary[]>;
  listAgentMessages(sessionId: string): Promise<AgentMessageSummary[]>;
  sendMessage(sessionId: string, content: string): Promise<AgentMessageSummary>;
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
    const definition = resolveAgentDefinition(request.agentType);
    const toolAdapter = this.options.createToolAdapter?.() ?? new LocalToolAdapter(this.options.workspaceRoot);

    session.messages.push(createSystemMessage(definition.systemPrompt));
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
        agentType: definition.name,
        assistantText,
        toolRecords: result.records,
      };
    } finally {
      await toolAdapter.dispose?.();
      await (this.options.saveSession ?? saveSession)(session);
      if (session.parentSessionId) {
        await appendAgentMessage({
          sessionId: session.id,
          fromSessionId: session.id,
          toSessionId: session.parentSessionId,
          direction: "child_to_parent",
          content: `Sub-agent ${definition.name} completed: ${[...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? ""}`.trim(),
        });
      }
    }
  }

  async listAgentTypes(): Promise<Array<{ name: string; description: string }>> {
    return listAgentDefinitions().map((definition) => ({
      name: definition.name,
      description: definition.description,
    }));
  }

  async listChildSessions(): Promise<SessionSummary[]> {
    if (!this.options.parentSessionId) {
      return [];
    }

    return listChildSessions(this.options.parentSessionId);
  }

  async listAgentMessages(sessionId: string): Promise<AgentMessageSummary[]> {
    if (!this.options.parentSessionId) {
      return [];
    }

    await this.assertDirectChildSession(sessionId);
    return listAgentMessages(sessionId);
  }

  async sendMessage(sessionId: string, content: string): Promise<AgentMessageSummary> {
    if (!this.options.parentSessionId) {
      throw new Error("Parent session is not configured for this runner.");
    }

    await this.assertDirectChildSession(sessionId);
    return appendAgentMessage({
      sessionId,
      fromSessionId: this.options.parentSessionId,
      toSessionId: sessionId,
      direction: "parent_to_child",
      content,
    });
  }

  private async assertDirectChildSession(sessionId: string): Promise<void> {
    const session = await loadSession(sessionId);
    if (session.parentSessionId !== this.options.parentSessionId) {
      throw new Error(`Session ${sessionId} is not a direct child of ${this.options.parentSessionId}.`);
    }
  }
}
