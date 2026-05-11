import { loadConfig, loadFileConfig, saveConfig } from "../config/config.js";
import { discoverSkills, loadSkill, planSkillEnablement, validateSkillDisable } from "../skills/loader.js";
import { branchSession, loadStash, restoreSessionToMessage, saveSession, saveSessionWithOptions, saveStash } from "../session/store.js";
import type { Session } from "../session/types.js";
import { chooseBranchSelection, type BranchSelection } from "../ui/branch-picker.js";
import { renderInfo } from "../ui/render.js";

export interface SlashCommandOptions {
  chooseBranchSelection?: (session: Session) => Promise<BranchSelection | null>;
}

export async function maybeHandleSlashCommand(
  prompt: string,
  session: Session,
  workspaceRoot: string,
  options?: SlashCommandOptions,
): Promise<boolean> {
  if (!prompt.startsWith("/")) {
    return false;
  }

  const [command, ...rest] = prompt.trim().split(/\s+/);

  if (command === "/stash") {
    await handleStash(rest);
    return true;
  }

  if (command === "/branch") {
    const selection = rest.length === 0 ? await (options?.chooseBranchSelection ?? chooseBranchSelection)(session) : parseBranchSelection(rest);
    if (!selection) {
      return true;
    }

    if (selection.action === "restore") {
      restoreSessionToMessage(session, selection.messageId);
      await saveSessionWithOptions(session, { allowTruncate: true });
      renderInfo(`Restored session ${session.id} to message ${selection.messageId}`);
      return true;
    }

    const branched = branchSession(session, selection.messageId);
    await saveSession(branched);
    renderInfo(`Created branch ${branched.id} from ${session.id} at message ${selection.messageId}`);
    return true;
  }

  if (command === "/skills") {
    await handleSkills(rest, session, workspaceRoot);
    return true;
  }

  throw new Error(`Unknown slash command: ${command}`);
}

function parseBranchSelection(args: string[]): BranchSelection {
  const action = args.length > 1 ? args[0] : "fork";
  const targetMessageId = args.length > 1 ? args[1] : args[0];
  if (!targetMessageId || (action !== "fork" && action !== "restore")) {
    throw new Error("Usage: /branch [fork|restore] <message-id>");
  }

  return {
    action,
    messageId: targetMessageId,
  };
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

async function handleSkills(args: string[], session: Session, workspaceRoot: string): Promise<void> {
  const action = args[0];

  if (action === "list") {
    const config = await loadConfig({});
    const enabled = new Set(config.skills?.enabled ?? []);
    const skills = await discoverSkills(workspaceRoot);
    renderInfo(
      skills.length > 0
        ? skills
            .map((skill) => `${enabled.has(skill.name) ? "*" : "-"} ${skill.name}: ${skill.description}`)
            .join("\n")
        : "No skills discovered.",
    );
    return;
  }

  if (action === "enabled") {
    const enabled = (await loadConfig({})).skills?.enabled ?? [];
    renderInfo(enabled.length > 0 ? enabled.join("\n") : "No skills enabled.");
    return;
  }

  if (action === "current") {
    renderInfo(
      session.loadedSkills.length > 0
        ? session.loadedSkills
            .map((skill) => `${skill.name}: ${skill.description}`)
            .join("\n")
        : "No skills loaded in the current session.",
    );
    return;
  }

  if (action === "show") {
    const name = args[1];
    if (!name) {
      throw new Error("Usage: /skills show <name>");
    }

    const skill = await loadSkill(workspaceRoot, name);
    renderInfo(skill.content);
    return;
  }

  if (action === "enable" || action === "disable") {
    const name = args[1];
    if (!name) {
      throw new Error(`Usage: /skills ${action} <name>`);
    }

    await loadSkill(workspaceRoot, name);
    const fileConfig = await loadFileConfig();
    const current = fileConfig.skills?.enabled ?? [];
    if (action === "enable") {
      const plan = await planSkillEnablement(workspaceRoot, current, name);
      await saveConfig({
        ...fileConfig,
        skills: {
          ...fileConfig.skills,
          enabled: plan.enabledSkills,
        },
      });
      renderInfo(
        plan.addedSkills.length > 1
          ? `Enabled skill ${name} with dependencies: ${plan.addedSkills.filter((skill) => skill !== name).join(", ")}`
          : `Enabled skill ${name}`,
      );
    } else {
      const remaining = await validateSkillDisable(workspaceRoot, current, name);
      await saveConfig({
        ...fileConfig,
        skills: {
          ...fileConfig.skills,
          enabled: remaining,
        },
      });
      renderInfo(`Disabled skill ${name}`);
    }
    return;
  }

  throw new Error("Usage: /skills <list|enabled|current|show|enable|disable> ...");
}
