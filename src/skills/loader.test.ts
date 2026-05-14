import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { discoverSkills, loadSkill, planSkillEnablement, readSkillResource, renderSkillContext, resolveSkills, validateSkillDisable } from "./loader.js";

test("skill loader discovers global and project skills with project override and dependencies", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-skills-workspace-"));
  const globalSkills = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-skills-global-"));
  const originalGlobalSkills = process.env.TIMCODE_GLOBAL_SKILLS_DIR;

  process.env.TIMCODE_GLOBAL_SKILLS_DIR = globalSkills;

  try {
    await writeSkill(globalSkills, "shared", "---\nname: shared\ndescription: global shared\n---\n# Shared\nGlobal shared skill");
    await writeSkill(globalSkills, "dependency", "---\nname: dependency\ndescription: dependency skill\n---\n# Dependency\nDependency instructions");
    await writeSkill(
      path.join(workspace, ".opencode", "skills"),
      "shared",
      "---\nname: shared\ndescription: project shared\ndependencies:\n- dependency\n---\n# Shared\nProject shared skill",
    );
    await writeSkill(path.join(workspace, ".opencode", "skills"), "custom", "# Custom\nProject custom skill");
    await fs.mkdir(path.join(workspace, ".opencode", "skills", "custom", "resources"), { recursive: true });
    await fs.writeFile(path.join(workspace, ".opencode", "skills", "custom", "resources", "notes.txt"), "notes", "utf8");

    const discovered = await discoverSkills(workspace);
    assert.deepEqual(
      discovered.map((skill) => [skill.name, skill.description, skill.source]),
      [
        ["custom", "Custom", "project"],
        ["dependency", "dependency skill", "global"],
        ["shared", "project shared", "project"],
      ],
    );

    const shared = await loadSkill(workspace, "shared");
    assert.equal(shared.source, "project");
    assert.deepEqual(shared.dependencies, ["dependency"]);
    assert.deepEqual(shared.resourcePaths, []);
    assert.deepEqual(shared.metadataWarnings, []);

    const custom = await loadSkill(workspace, "custom");
    assert.deepEqual(custom.resourcePaths, ["resources/notes.txt"]);
    assert.match(custom.metadataWarnings[0] ?? "", /Missing frontmatter/);

    const resolved = await resolveSkills(workspace, ["shared"]);
    assert.deepEqual(resolved.map((skill) => skill.name), ["dependency", "shared"]);
    assert.match(renderSkillContext(resolved), /Loaded skills:/);
    assert.match(renderSkillContext(resolved), /## Skill: shared/);

    const enablement = await planSkillEnablement(workspace, [], "shared");
    assert.deepEqual(enablement.enabledSkills, ["dependency", "shared"]);
    assert.deepEqual(enablement.addedSkills, ["dependency", "shared"]);

    await assert.rejects(() => validateSkillDisable(workspace, ["dependency", "shared"], "dependency"), /still required by: shared/);
    assert.deepEqual(await validateSkillDisable(workspace, ["dependency", "shared"], "shared"), ["dependency"]);
  } finally {
    if (originalGlobalSkills === undefined) {
      delete process.env.TIMCODE_GLOBAL_SKILLS_DIR;
    } else {
      process.env.TIMCODE_GLOBAL_SKILLS_DIR = originalGlobalSkills;
    }

    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(globalSkills, { recursive: true, force: true });
  }
});

test("skill loader surfaces non-fatal metadata warnings for malformed frontmatter", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-skills-workspace-"));

  try {
    await writeSkill(
      path.join(workspace, ".opencode", "skills"),
      "warny",
      [
        "---",
        "name:",
        "description:",
        "extra: value",
        "dependencies: oops",
        "dependencies:",
        "- warny",
        "- shared",
        "- shared",
        "---",
        "# Warny",
        "Skill body",
      ].join("\n"),
    );

    const skill = await loadSkill(workspace, "warny");
    assert.equal(skill.name, "warny");
    assert.equal(skill.description, "Warny");
    assert.deepEqual(skill.dependencies, ["warny", "shared"]);
    assert.deepEqual(skill.metadataWarnings, [
      "Empty frontmatter name; using directory name.",
      "Empty frontmatter description; using first content line.",
      "Unknown frontmatter field: extra",
      "Malformed dependencies frontmatter; expected a YAML-style list or inline array.",
      "Skill warny declares itself as a dependency.",
    ]);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test("skill loader reads declared skill resources by skill-relative path", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-skills-workspace-"));

  try {
    const root = path.join(workspace, ".opencode", "skills");
    await writeSkill(root, "resourceful", "---\nname: resourceful\ndescription: has resources\n---\n# Resourceful\nBody");
    const resourceDir = path.join(root, "resourceful", "docs");
    await fs.mkdir(resourceDir, { recursive: true });
    await fs.writeFile(path.join(resourceDir, "usage.md"), "usage details", "utf8");

    const resource = await readSkillResource(workspace, "resourceful", "docs/usage.md");
    assert.equal(resource.resourcePath, "docs/usage.md");
    assert.equal(resource.content, "usage details");
    assert.equal(resource.skill.name, "resourceful");

    await assert.rejects(() => readSkillResource(workspace, "resourceful", "../secrets.txt"), /Invalid skill resource path/);
    await assert.rejects(() => readSkillResource(workspace, "resourceful", "docs\/missing.md"), /Unknown skill resource/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

async function writeSkill(root: string, name: string, content: string): Promise<void> {
  const directory = path.join(root, name);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "SKILL.md"), content, "utf8");
}
