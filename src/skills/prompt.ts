import { createSystemMessage } from "../session/messages.js";
import type { Session } from "../session/types.js";
import { renderSkillContext, resolveSkills } from "./loader.js";

const SKILL_CONTEXT_PREFIX = "Loaded skills:";

export async function injectEnabledSkills(session: Session, workspaceRoot: string, enabledSkills: string[]): Promise<void> {
  session.messages = session.messages.filter((message) => message.role !== "system" || !message.content.startsWith(SKILL_CONTEXT_PREFIX));

  if (enabledSkills.length === 0) {
    session.loadedSkills = [];
    return;
  }

  const skills = await resolveSkills(workspaceRoot, enabledSkills);
  session.loadedSkills = skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    dependencies: [...skill.dependencies],
    source: skill.source,
    directoryPath: skill.directoryPath,
    entryFilePath: skill.entryFilePath,
    resourcePaths: [...skill.resourcePaths],
    metadataWarnings: [...skill.metadataWarnings],
  }));

  const context = renderSkillContext(skills);
  if (!context) {
    return;
  }

  session.messages.push(createSystemMessage(context));
}
