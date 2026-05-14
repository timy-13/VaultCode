import { runAgentLoop } from "./loop.js";
import { listActiveAgentRuns, registerActiveAgentRun, requestActiveAgentShutdown } from "./live-registry.js";
import { listAgentDefinitions, resolveAgentDefinition } from "./registry.js";
import { createUserMessage, createSystemMessage } from "../session/messages.js";
import {
  appendAgentMessage,
  createSession,
  getSessionTree,
  getTeamStatus,
  isSameSessionTree,
  listAgentMessages,
  listChildSessions,
  loadSession,
  saveSession,
  updateSessionLifecycle,
  type AgentMessageSummary,
  type SessionSummary,
  type TeamStatusSummary,
} from "../session/store.js";
import type { ProviderAdapter } from "../provider/types.js";
import { OperationCancelledError, isAbortError } from "../runtime/abort.js";
import { injectEnabledSkills } from "../skills/prompt.js";
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
  listChildSessions(options?: { recursive?: boolean }): Promise<SessionSummary[]>;
  listActiveRuns(options?: { sessionId?: string; recursive?: boolean }): Promise<Array<{ sessionId: string; parentSessionId?: string; agentType: string; startedAt: string }>>;
  listAgentMessages(sessionId: string): Promise<AgentMessageSummary[]>;
  sendMessage(sessionId: string, content: string): Promise<AgentMessageSummary>;
  broadcastMessage(content: string, options?: { sessionId?: string; recursive?: boolean; includeSelf?: boolean }): Promise<AgentMessageSummary[]>;
  getTeamStatus(options?: { recursive?: boolean }): Promise<TeamStatusSummary | null>;
  requestShutdown(sessionId: string, options?: { recursive?: boolean }): Promise<SessionSummary>;
  cleanupSession(sessionId: string, options?: { recursive?: boolean }): Promise<SessionSummary>;
}

export class LocalSubAgentRunner implements SubAgentRunner {
  constructor(
    private readonly options: {
      workspaceRoot: string;
      provider: ProviderAdapter;
      model?: string;
      parentSessionId?: string;
      enabledSkills?: string[];
      createToolAdapter?: (subAgentRunner?: SubAgentRunner) => ToolAdapter;
      saveSession?: typeof saveSession;
    },
  ) {}

  async run(request: SubAgentRunRequest, signal: AbortSignal): Promise<SubAgentRunResult> {
    const session = createSession(this.options.parentSessionId);
    const definition = resolveAgentDefinition(request.agentType);
    const runController = new AbortController();
    const stopForwardingAbort = forwardAbort(signal, runController);
    const unregisterActiveRun = registerActiveAgentRun({
      sessionId: session.id,
      parentSessionId: session.parentSessionId,
      agentType: definition.name,
      controller: runController,
    });
    const childRunner = new LocalSubAgentRunner({
      workspaceRoot: this.options.workspaceRoot,
      provider: this.options.provider,
      model: this.options.model,
      parentSessionId: session.id,
      enabledSkills: this.options.enabledSkills,
      createToolAdapter: this.options.createToolAdapter,
      saveSession: this.options.saveSession,
    });
    const toolAdapter =
      this.options.createToolAdapter?.(childRunner) ??
      new LocalToolAdapter(this.options.workspaceRoot, {
        session,
        subAgentRunner: childRunner,
      });
    let completed = false;

    session.messages.push(createSystemMessage(definition.systemPrompt));
    await injectEnabledSkills(session, this.options.workspaceRoot, this.options.enabledSkills ?? []);
    session.messages.push(createUserMessage(request.task));
    await (this.options.saveSession ?? saveSession)(session);

    try {
      const result = await runAgentLoop(
        session,
        this.options.provider,
        toolAdapter,
        this.options.model,
        () => {},
        () => {},
        runController.signal,
      );
      const assistantText = [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
      completed = true;

      return {
        sessionId: session.id,
        parentSessionId: session.parentSessionId,
        agentType: definition.name,
        assistantText,
        toolRecords: result.records,
      };
    } catch (error) {
      if (isAbortError(error) || runController.signal.aborted) {
        throw new OperationCancelledError(runController.signal.reason instanceof Error ? runController.signal.reason.message : "Cancelled by user.");
      }

      throw error;
    } finally {
      unregisterActiveRun();
      stopForwardingAbort();
      await toolAdapter.dispose?.();

      const persisted = await loadSessionSafe(session.id);
      if (persisted) {
        session.agentMessages = persisted.agentMessages;
      }
      session.lifecycleState = persisted?.lifecycleState === "shutdown_requested" || runController.signal.aborted ? "shutdown_requested" : completed ? "completed" : session.lifecycleState;
      await (this.options.saveSession ?? saveSession)(session);
      if (session.parentSessionId) {
        const terminalVerb = session.lifecycleState === "shutdown_requested" ? "stopped" : "completed";
        await appendAgentMessage({
          sessionId: session.id,
          fromSessionId: session.id,
          toSessionId: session.parentSessionId,
          direction: "child_to_parent",
          content: `Sub-agent ${definition.name} ${terminalVerb}: ${[...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? ""}`.trim(),
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

  async listChildSessions(options?: { recursive?: boolean }): Promise<SessionSummary[]> {
    if (!this.options.parentSessionId) {
      return [];
    }

    return listChildSessions(this.options.parentSessionId, options);
  }

  async listActiveRuns(options?: { sessionId?: string; recursive?: boolean }): Promise<Array<{ sessionId: string; parentSessionId?: string; agentType: string; startedAt: string }>> {
    if (!this.options.parentSessionId) {
      return [];
    }

    const targetSessionId = options?.sessionId ?? this.options.parentSessionId;
    await this.assertSameSessionTree(targetSessionId);
    const allowedSessionIds = new Set(
      options?.recursive
        ? [targetSessionId, ...(await listChildSessions(targetSessionId, { recursive: true })).map((session) => session.id)]
        : [targetSessionId],
    );

    return listActiveAgentRuns().filter((run) => allowedSessionIds.has(run.sessionId));
  }

  async listAgentMessages(sessionId: string): Promise<AgentMessageSummary[]> {
    if (!this.options.parentSessionId) {
      return [];
    }

    await this.assertSameSessionTree(sessionId);
    return listAgentMessages(sessionId);
  }

  async sendMessage(sessionId: string, content: string): Promise<AgentMessageSummary> {
    if (!this.options.parentSessionId) {
      throw new Error("Parent session is not configured for this runner.");
    }

    await this.assertSameSessionTree(sessionId);
    return appendAgentMessage({
      sessionId,
      fromSessionId: this.options.parentSessionId,
      toSessionId: sessionId,
      direction: await this.getMessageDirection(this.options.parentSessionId, sessionId),
      content,
    });
  }

  async broadcastMessage(content: string, options?: { sessionId?: string; recursive?: boolean; includeSelf?: boolean }): Promise<AgentMessageSummary[]> {
    if (!this.options.parentSessionId) {
      throw new Error("Parent session is not configured for this runner.");
    }

    const targetSessionId = options?.sessionId ?? this.options.parentSessionId;
    await this.assertSameSessionTree(targetSessionId);
    const recipients = new Set<string>();
    if (options?.includeSelf || targetSessionId !== this.options.parentSessionId) {
      recipients.add(targetSessionId);
    }

    if (options?.recursive ?? true) {
      for (const child of await listChildSessions(targetSessionId, { recursive: true })) {
        if (!options?.includeSelf && child.id === this.options.parentSessionId) {
          continue;
        }

        recipients.add(child.id);
      }
    }

    const messages: AgentMessageSummary[] = [];
    for (const recipientSessionId of recipients) {
      messages.push(
        await appendAgentMessage({
          sessionId: recipientSessionId,
          fromSessionId: this.options.parentSessionId,
          toSessionId: recipientSessionId,
          direction: await this.getMessageDirection(this.options.parentSessionId, recipientSessionId),
          content,
        }),
      );
    }

    return messages;
  }

  async getTeamStatus(options?: { recursive?: boolean }): Promise<TeamStatusSummary | null> {
    if (!this.options.parentSessionId) {
      return null;
    }

    return getTeamStatus(this.options.parentSessionId, options);
  }

  async requestShutdown(sessionId: string, options?: { recursive?: boolean }): Promise<SessionSummary> {
    if (!this.options.parentSessionId) {
      throw new Error("Parent session is not configured for this runner.");
    }

    await this.assertSameSessionTree(sessionId);
    const targetSessionIds = options?.recursive ? (await listChildSessions(sessionId, { recursive: true })).map((session) => session.id) : [];
    const allTargets = [sessionId, ...targetSessionIds];

    let updatedSession: Awaited<ReturnType<typeof loadSession>> | null = null;
    for (const targetSessionId of allTargets) {
      const session = await updateSessionLifecycle(targetSessionId, "shutdown_requested");
      requestActiveAgentShutdown(targetSessionId, this.options.parentSessionId);
      await appendAgentMessage({
        sessionId: targetSessionId,
        fromSessionId: this.options.parentSessionId,
        toSessionId: targetSessionId,
        direction: await this.getMessageDirection(this.options.parentSessionId, targetSessionId),
        content: `Shutdown requested by session ${this.options.parentSessionId}.`,
      });
      if (targetSessionId === sessionId) {
        updatedSession = session;
      }
    }

    if (!updatedSession) {
      throw new Error(`Session ${sessionId} was not found.`);
    }

    return toSessionSummary(updatedSession);
  }

  async cleanupSession(sessionId: string, options?: { recursive?: boolean }): Promise<SessionSummary> {
    if (!this.options.parentSessionId) {
      throw new Error("Parent session is not configured for this runner.");
    }

    await this.assertSameSessionTree(sessionId);
    const targetSessionIds = options?.recursive ? (await listChildSessions(sessionId, { recursive: true })).map((session) => session.id) : [];
    const allTargets = [sessionId, ...targetSessionIds];

    let updatedSession: Awaited<ReturnType<typeof loadSession>> | null = null;
    for (const targetSessionId of allTargets) {
      const session = await updateSessionLifecycle(targetSessionId, "cleaned_up");
      if (targetSessionId === sessionId) {
        updatedSession = session;
      }
    }

    if (!updatedSession) {
      throw new Error(`Session ${sessionId} was not found.`);
    }

    return toSessionSummary(updatedSession);
  }

  private async assertSameSessionTree(sessionId: string): Promise<void> {
    if (sessionId === this.options.parentSessionId) {
      return;
    }

    const isSameTree = await isSameSessionTree(this.options.parentSessionId ?? "", sessionId);
    if (!isSameTree) {
      throw new Error(`Session ${sessionId} is not part of the same session tree as ${this.options.parentSessionId}.`);
    }
  }

  private async getMessageDirection(fromSessionId: string, toSessionId: string): Promise<"parent_to_child" | "child_to_parent" | "session_to_session"> {
    const target = await loadSession(toSessionId);
    if (target.parentSessionId === fromSessionId) {
      return "parent_to_child";
    }

    const sender = await loadSession(fromSessionId);
    if (sender.parentSessionId === toSessionId) {
      return "child_to_parent";
    }

    return "session_to_session";
  }
}

function toSessionSummary(session: Awaited<ReturnType<typeof loadSession>>): SessionSummary {
  return {
    id: session.id,
    parentSessionId: session.parentSessionId,
    depth: 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lifecycleState: session.lifecycleState,
    messageCount: session.messages.length,
    lastAssistantText: [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "",
  };
}

function forwardAbort(source: AbortSignal, target: AbortController): () => void {
  if (source.aborted) {
    target.abort(source.reason);
    return () => {};
  }

  const onAbort = () => {
    target.abort(source.reason);
  };
  source.addEventListener("abort", onAbort, { once: true });
  return () => {
    source.removeEventListener("abort", onAbort);
  };
}

async function loadSessionSafe(sessionId: string): Promise<Awaited<ReturnType<typeof loadSession>> | null> {
  try {
    return await loadSession(sessionId);
  } catch {
    return null;
  }
}
