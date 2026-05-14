import { runAgentLoop } from "../agent/loop.js";
import { LocalSubAgentRunner } from "../agent/sub-agent.js";
import { loadConfig } from "../config/config.js";
import { createProvider } from "../provider/factory.js";
import { getAbortMessage, isAbortError, OperationCancelledError } from "../runtime/abort.js";
import { createUserMessage } from "../session/messages.js";
import { createSession, ensureStorage, loadSession, saveSession } from "../session/store.js";
import { injectEnabledSkills } from "../skills/prompt.js";
import { LocalToolAdapter } from "../tools/local-tools.js";
import { renderAssistantMessage, renderBanner, renderInfo, renderToolExecution, renderUserPrompt } from "../ui/render.js";
import type { CliArgs } from "../ui/cli.js";
import { maybeHandleSlashCommand } from "./slash-commands.js";

export async function runPrompt(args: CliArgs, workspaceRoot: string): Promise<void> {
  await ensureStorage();

  const config = await loadConfig({ provider: args.provider, model: args.model });
  const session = args.resumeSessionId ? await loadSession(args.resumeSessionId) : createSession();
  await injectEnabledSkills(session, workspaceRoot, config.skills?.enabled ?? []);
  const provider = createProvider(config);
  const subAgentRunner = new LocalSubAgentRunner({
    workspaceRoot,
    provider,
    model: config.model,
    parentSessionId: session.id,
    enabledSkills: config.skills?.enabled ?? [],
    createToolAdapter: () => new LocalToolAdapter(workspaceRoot, { session }),
  });
  const toolAdapter = new LocalToolAdapter(workspaceRoot, { subAgentRunner, session });

  renderBanner(session, {
    provider: config.provider,
    model: config.model,
    workspaceRoot,
  });

  if (await maybeHandleSlashCommand(args.prompt, session, workspaceRoot)) {
    return;
  }

  const controller = new AbortController();
  const onSigint = () => {
    controller.abort(new OperationCancelledError("Cancelled by user."));
    renderInfo("Cancellation requested.");
  };
  process.once("SIGINT", onSigint);

  renderUserPrompt(args.prompt);
  session.messages.push(createUserMessage(args.prompt));

  try {
    try {
      await runAgentLoop(
        session,
        provider,
        toolAdapter,
        config.model,
        renderAssistantMessage,
        renderToolExecution,
        controller.signal,
      );
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        renderInfo(getAbortMessage(error, "Cancelled by user."));
        return;
      }

      throw error;
    }
  } finally {
    process.removeListener("SIGINT", onSigint);
    await toolAdapter.dispose?.();
    await saveSession(session);
  }
}
