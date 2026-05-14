import { OperationCancelledError } from "../runtime/abort.js";

export interface ActiveAgentRunSummary {
  sessionId: string;
  parentSessionId?: string;
  agentType: string;
  startedAt: string;
}

interface ActiveAgentRun extends ActiveAgentRunSummary {
  controller: AbortController;
}

const activeRuns = new Map<string, ActiveAgentRun>();

export function registerActiveAgentRun(run: {
  sessionId: string;
  parentSessionId?: string;
  agentType: string;
  controller: AbortController;
}): () => void {
  activeRuns.set(run.sessionId, {
    sessionId: run.sessionId,
    parentSessionId: run.parentSessionId,
    agentType: run.agentType,
    startedAt: new Date().toISOString(),
    controller: run.controller,
  });

  return () => {
    activeRuns.delete(run.sessionId);
  };
}

export function getActiveAgentRun(sessionId: string): ActiveAgentRunSummary | null {
  const run = activeRuns.get(sessionId);
  if (!run) {
    return null;
  }

  return {
    sessionId: run.sessionId,
    parentSessionId: run.parentSessionId,
    agentType: run.agentType,
    startedAt: run.startedAt,
  };
}

export function listActiveAgentRuns(): ActiveAgentRunSummary[] {
  return [...activeRuns.values()]
    .map((run) => ({
      sessionId: run.sessionId,
      parentSessionId: run.parentSessionId,
      agentType: run.agentType,
      startedAt: run.startedAt,
    }))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

export function requestActiveAgentShutdown(sessionId: string, requestedBySessionId?: string): boolean {
  const run = activeRuns.get(sessionId);
  if (!run || run.controller.signal.aborted) {
    return false;
  }

  run.controller.abort(new OperationCancelledError(requestedBySessionId ? `Shutdown requested by session ${requestedBySessionId}.` : "Shutdown requested."));
  return true;
}
