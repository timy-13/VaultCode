import { branchSession, loadStash, saveSession, saveStash } from "../session/store.js";
import type { Session } from "../session/types.js";
import { renderInfo } from "../ui/render.js";

export async function maybeHandleSlashCommand(prompt: string, session: Session): Promise<boolean> {
  if (!prompt.startsWith("/")) {
    return false;
  }

  const [command, ...rest] = prompt.trim().split(/\s+/);

  if (command === "/stash") {
    await handleStash(rest);
    return true;
  }

  if (command === "/branch") {
    const targetMessageId = rest[0];
    if (!targetMessageId) {
      throw new Error("Usage: /branch <message-id>");
    }

    const branched = branchSession(session, targetMessageId);
    await saveSession(branched);
    renderInfo(`Created branch ${branched.id} from ${session.id}`);
    return true;
  }

  throw new Error(`Unknown slash command: ${command}`);
}

async function handleStash(args: string[]): Promise<void> {
  const stash = await loadStash();
  const action = args[0];

  if (action === "save") {
    const name = args[1];
    const content = args.slice(2).join(" ").trim();
    if (!name || !content) {
      throw new Error("Usage: /stash save <name> <content>");
    }

    stash.entries[name] = content;
    await saveStash(stash);
    renderInfo(`Saved stash entry ${name}`);
    return;
  }

  if (action === "list") {
    const names = Object.keys(stash.entries).sort();
    renderInfo(names.length > 0 ? names.join("\n") : "No stash entries saved.");
    return;
  }

  if (action === "show") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: /stash show <name>");
    }

    const content = stash.entries[name];
    if (!content) {
      throw new Error(`Stash entry ${name} was not found.`);
    }

    renderInfo(content);
    return;
  }

  throw new Error("Usage: /stash <save|list|show> ...");
}
