import { runAgentLoop } from "../agent/loop.js";
import { loadConfig } from "../config/config.js";
import { createProvider } from "../provider/factory.js";
import { createUserMessage } from "../session/messages.js";
import { createSession, ensureStorage, loadSession, saveSession } from "../session/store.js";
import { LocalToolAdapter } from "../tools/local-tools.js";
import { renderAssistantMessage, renderBanner, renderInfo, renderToolExecution, renderUserPrompt } from "../ui/render.js";
import type { CliArgs } from "../ui/cli.js";
import { maybeHandleSlashCommand } from "./slash-commands.js";

export async function runPrompt(args: CliArgs, workspaceRoot: string): Promise<void> {
  await ensureStorage();

  const config = await loadConfig({ provider: args.provider, model: args.model });
  const session = args.resumeSessionId ? await loadSession(args.resumeSessionId) : createSession();
  const provider = createProvider(config);
  const toolAdapter = new LocalToolAdapter(workspaceRoot);

  renderBanner(session);

  if (await maybeHandleSlashCommand(args.prompt, session)) {
    return;
  }

  const controller = new AbortController();
  process.once("SIGINT", () => {
    controller.abort(new Error("Cancelled by user."));
    renderInfo("Cancellation requested.");
  });

  renderUserPrompt(args.prompt);
  session.messages.push(createUserMessage(args.prompt));

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
  } finally {
    await saveSession(session);
  }
}
