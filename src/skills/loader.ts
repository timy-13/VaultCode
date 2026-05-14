import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface SkillDefinition {
  name: string;
  description: string;
  dependencies: string[];
  source: "global" | "project";
  directoryPath: string;
  entryFilePath: string;
  resourcePaths: string[];
  metadataWarnings: string[];
  content: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  dependencies: string[];
  source: "global" | "project";
  directoryPath: string;
  entryFilePath: string;
  resourcePaths: string[];
  metadataWarnings: string[];
}

export interface SkillEnablementPlan {
  requestedSkill: string;
  enabledSkills: string[];
  addedSkills: string[];
}

export async function discoverSkills(workspaceRoot: string): Promise<SkillSummary[]> {
  const registry = await loadSkillRegistry(workspaceRoot);
  return [...registry.values()]
    .map(toSkillSummary)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function loadSkill(workspaceRoot: string, name: string): Promise<SkillDefinition> {
  const registry = await loadSkillRegistry(workspaceRoot);
  const skill = registry.get(name);
  if (!skill) {
    throw new Error(`Unknown skill: ${name}`);
  }

  return skill;
}

export async function readSkillResource(
  workspaceRoot: string,
  name: string,
  resourcePath: string,
): Promise<{ skill: SkillSummary; resourcePath: string; content: string }> {
  const skill = await loadSkill(workspaceRoot, name);
  const normalizedPath = normalizeSkillResourcePath(resourcePath);
  if (!skill.resourcePaths.includes(normalizedPath)) {
    throw new Error(`Unknown skill resource for ${name}: ${resourcePath}`);
  }

  return {
    skill: toSkillSummary(skill),
    resourcePath: normalizedPath,
    content: await fs.readFile(path.join(skill.directoryPath, normalizedPath), "utf8"),
  };
}

export async function resolveSkills(workspaceRoot: string, enabledSkills: string[]): Promise<SkillDefinition[]> {
  const registry = await loadSkillRegistry(workspaceRoot);
  return resolveSkillsFromRegistry(registry, enabledSkills);
}

export async function planSkillEnablement(workspaceRoot: string, currentEnabledSkills: string[], requestedSkill: string): Promise<SkillEnablementPlan> {
  const registry = await loadSkillRegistry(workspaceRoot);
  resolveSkillsFromRegistry(registry, [requestedSkill]);

  const before = new Set(currentEnabledSkills);
  const resolved = resolveSkillsFromRegistry(registry, [...before, requestedSkill]).map((skill) => skill.name);
  const after = [...new Set(resolved)].sort();
  return {
    requestedSkill,
    enabledSkills: after,
    addedSkills: after.filter((skill) => !before.has(skill)),
  };
}

export async function validateSkillDisable(workspaceRoot: string, currentEnabledSkills: string[], requestedSkill: string): Promise<string[]> {
  const registry = await loadSkillRegistry(workspaceRoot);
  if (!registry.has(requestedSkill)) {
    throw new Error(`Unknown skill: ${requestedSkill}`);
  }

  const enabled = new Set(currentEnabledSkills);
  const dependents = [...enabled]
    .filter((skillName) => skillName !== requestedSkill)
    .filter((skillName) => resolveSkillsFromRegistry(registry, [skillName]).some((skill) => skill.name === requestedSkill));

  if (dependents.length > 0) {
    throw new Error(`Cannot disable skill ${requestedSkill}; still required by: ${dependents.sort().join(", ")}`);
  }

  enabled.delete(requestedSkill);
  return [...enabled].sort();
}

function resolveSkillsFromRegistry(registry: Map<string, SkillDefinition>, enabledSkills: string[]): SkillDefinition[] {
  const resolved: SkillDefinition[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  for (const skillName of enabledSkills) {
    visit(skillName);
  }

  return resolved;

  function visit(skillName: string): void {
    if (visited.has(skillName)) {
      return;
    }

    if (visiting.has(skillName)) {
      throw new Error(`Skill dependency cycle detected at ${skillName}.`);
    }

    const skill = registry.get(skillName);
    if (!skill) {
      throw new Error(`Unknown skill: ${skillName}`);
    }

    visiting.add(skillName);
    for (const dependency of skill.dependencies) {
      visit(dependency);
    }
    visiting.delete(skillName);
    visited.add(skillName);
    resolved.push(skill);
  }
}

export function renderSkillContext(skills: SkillDefinition[]): string {
  if (skills.length === 0) {
    return "";
  }

  return [
    "Loaded skills:",
    ...skills.map((skill) => `## Skill: ${skill.name}\nSource: ${skill.source}\nDirectory: ${skill.directoryPath}\n\n${skill.content.trim()}`),
  ].join("\n\n");
}

async function loadSkillRegistry(workspaceRoot: string): Promise<Map<string, SkillDefinition>> {
  const registry = new Map<string, SkillDefinition>();
  for (const location of getSkillRoots(workspaceRoot)) {
    const skills = await readSkillDirectory(location.directoryPath, location.source);
    for (const skill of skills) {
      registry.set(skill.name, skill);
    }
  }

  return registry;
}

function getSkillRoots(workspaceRoot: string): Array<{ source: "global" | "project"; directoryPath: string }> {
  return [
    {
      source: "global",
      directoryPath: process.env.TIMCODE_GLOBAL_SKILLS_DIR ?? path.join(os.homedir(), ".config", "opencode", "harness", "skills"),
    },
    {
      source: "project",
      directoryPath: path.join(workspaceRoot, ".opencode", "skills"),
    },
  ];
}

async function readSkillDirectory(
  directoryPath: string,
  source: "global" | "project",
): Promise<SkillDefinition[]> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }

  const skills: SkillDefinition[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skill = await readSkillDefinition(path.join(directoryPath, entry.name), source);
    if (skill) {
      skills.push(skill);
    }
  }

  return skills;
}

async function readSkillDefinition(directoryPath: string, source: "global" | "project"): Promise<SkillDefinition | null> {
  const entryFilePath = path.join(directoryPath, "SKILL.md");
  let raw: string;
  try {
    raw = await fs.readFile(entryFilePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }

  const parsed = parseSkillMarkdown(raw, path.basename(directoryPath));
  const resourcePaths = await listSkillResourcePaths(directoryPath);
  return {
    name: parsed.name,
    description: parsed.description,
    dependencies: parsed.dependencies,
    source,
    directoryPath,
    entryFilePath,
    resourcePaths,
    metadataWarnings: parsed.metadataWarnings,
    content: parsed.content,
  };
}

function parseSkillMarkdown(raw: string, defaultName: string): {
  name: string;
  description: string;
  dependencies: string[];
  metadataWarnings: string[];
  content: string;
} {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("---\n")) {
    return {
      name: defaultName,
      description: firstHeadingOrLine(trimmed, defaultName),
      dependencies: [],
      metadataWarnings: ["Missing frontmatter; using directory name and first content line defaults."],
      content: raw,
    };
  }

  const closingIndex = trimmed.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return {
      name: defaultName,
      description: firstHeadingOrLine(trimmed, defaultName),
      dependencies: [],
      metadataWarnings: ["Malformed frontmatter; missing closing delimiter."],
      content: raw,
    };
  }

  const header = trimmed.slice(4, closingIndex);
  const content = trimmed.slice(closingIndex + 5).trim();
  const metadata = parseFrontmatter(header);
  const metadataWarnings: string[] = [...metadata.warnings];
  const resolvedName = metadata.name ?? defaultName;
  if (!metadata.hasNameField) {
    metadataWarnings.push("Missing frontmatter name; using directory name.");
  }
  if (!metadata.hasDescriptionField) {
    metadataWarnings.push("Missing frontmatter description; using first content line.");
  }
  if (metadata.dependencies.includes(resolvedName)) {
    metadataWarnings.push(`Skill ${resolvedName} declares itself as a dependency.`);
  }
  return {
    name: resolvedName,
    description: metadata.description ?? firstHeadingOrLine(content, defaultName),
    dependencies: metadata.dependencies,
    metadataWarnings,
    content,
  };
}

async function listSkillResourcePaths(directoryPath: string): Promise<string[]> {
  const resourcePaths: string[] = [];
  await walkSkillResources(directoryPath, directoryPath, resourcePaths);
  return resourcePaths.sort((left, right) => left.localeCompare(right));
}

async function walkSkillResources(root: string, currentPath: string, resourcePaths: string[]): Promise<void> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = path.relative(root, absolutePath);
    if (entry.isDirectory()) {
      await walkSkillResources(root, absolutePath, resourcePaths);
      continue;
    }

    if (!entry.isFile() || relativePath === "SKILL.md") {
      continue;
    }

  resourcePaths.push(relativePath);
  }
}

function parseFrontmatter(header: string): {
  name?: string;
  description?: string;
  dependencies: string[];
  warnings: string[];
  hasNameField: boolean;
  hasDescriptionField: boolean;
} {
  const result: {
    name?: string;
    description?: string;
    dependencies: string[];
    warnings: string[];
    hasNameField: boolean;
    hasDescriptionField: boolean;
  } = { dependencies: [], warnings: [], hasNameField: false, hasDescriptionField: false };
  let readingDependencies = false;
  let sawDependenciesField = false;
  const knownFields = new Set(["name", "description", "dependencies"]);

  for (const line of header.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

     const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+):/);
     if (keyMatch && !knownFields.has(keyMatch[1] ?? "")) {
       result.warnings.push(`Unknown frontmatter field: ${keyMatch[1]}`);
     }

    if (trimmed.startsWith("dependencies:")) {
      readingDependencies = true;
      sawDependenciesField = true;
      const inline = trimmed.slice("dependencies:".length).trim();
      if (inline.length === 0) {
        continue;
      }

      if (inline.startsWith("[") && inline.endsWith("]")) {
        result.dependencies = inline
          .slice(1, -1)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        readingDependencies = false;
      } else {
        result.warnings.push("Malformed dependencies frontmatter; expected a YAML-style list or inline array.");
        readingDependencies = false;
      }
      continue;
    }

    if (readingDependencies && trimmed.startsWith("- ")) {
      const dependency = trimmed.slice(2).trim();
      if (!dependency) {
        result.warnings.push("Ignored empty dependency entry in frontmatter.");
        continue;
      }

      result.dependencies.push(dependency);
      continue;
    }

    if (readingDependencies && !trimmed.startsWith("- ")) {
      result.warnings.push("Malformed dependencies frontmatter; expected list items prefixed with '- '.");
    }

    readingDependencies = false;
    if (trimmed.startsWith("name:")) {
      result.hasNameField = true;
      const name = trimmed.slice(5).trim();
      if (name) {
        result.name = name;
      } else {
        result.warnings.push("Empty frontmatter name; using directory name.");
      }
      continue;
    }

    if (trimmed.startsWith("description:")) {
      result.hasDescriptionField = true;
      const description = trimmed.slice(12).trim();
      if (description) {
        result.description = description;
      } else {
        result.warnings.push("Empty frontmatter description; using first content line.");
      }
    }
  }

  if (sawDependenciesField) {
    result.dependencies = [...new Set(result.dependencies)].filter(Boolean);
  }

  return result;
}

function firstHeadingOrLine(content: string, fallback: string): string {
  const firstLine = content.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!firstLine) {
    return fallback;
  }

  return firstLine.replace(/^#+\s*/, "");
}

function normalizeSkillResourcePath(resourcePath: string): string {
  const normalized = resourcePath.replaceAll("\\", "/").trim().replace(/^\.\//, "");
  if (!normalized || normalized === "SKILL.md" || normalized.includes("..") || path.isAbsolute(normalized)) {
    throw new Error(`Invalid skill resource path: ${resourcePath}`);
  }

  return normalized;
}

function toSkillSummary(skill: SkillDefinition): SkillSummary {
  return {
    name: skill.name,
    description: skill.description,
    dependencies: skill.dependencies,
    source: skill.source,
    directoryPath: skill.directoryPath,
    entryFilePath: skill.entryFilePath,
    resourcePaths: skill.resourcePaths,
    metadataWarnings: skill.metadataWarnings,
  };
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
