import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAssistantMessage, createUserMessage } from "../session/messages.js";
import { createSession, loadSession, saveSession } from "../session/store.js";
import { maybeHandleSlashCommand } from "./slash-commands.js";

test("/skills commands persist enabled skills and render discovery output", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-skills-workspace-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-config-"));
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;
  const originalEnabledSkills = process.env.TIMCODE_ENABLED_SKILLS;
  const stdout = captureStdout();

  process.env.TIMCODE_CONFIG_DIR = configDir;
  delete process.env.TIMCODE_ENABLED_SKILLS;

  try {
    const skillDir = path.join(workspace, ".opencode", "skills", "custom-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Custom Skill\nFollow this skill.", "utf8");

    const session = createSession();
    assert.equal(await maybeHandleSlashCommand("/skills list", session, workspace), true);
    assert.match(stdout.output(), /- custom-skill: Custom Skill/);

    stdout.clear();
    assert.equal(await maybeHandleSlashCommand("/skills enable custom-skill", session, workspace), true);
    assert.match(stdout.output(), /Enabled skill custom-skill/);

    const savedConfig = JSON.parse(await fs.readFile(path.join(configDir, "config.json"), "utf8")) as {
      skills?: { enabled?: string[] };
    };
    assert.deepEqual(savedConfig.skills?.enabled, ["custom-skill"]);

    stdout.clear();
    assert.equal(await maybeHandleSlashCommand("/skills enabled", session, workspace), true);
    assert.match(stdout.output(), /custom-skill/);

     stdout.clear();
     session.loadedSkills = [
       {
         name: "custom-skill",
         description: "Custom Skill",
         dependencies: [],
         source: "project",
         directoryPath: skillDir,
         entryFilePath: path.join(skillDir, "SKILL.md"),
         resourcePaths: [],
         metadataWarnings: [],
       },
     ];
     assert.equal(await maybeHandleSlashCommand("/skills current", session, workspace), true);
     assert.match(stdout.output(), /custom-skill: Custom Skill/);

    stdout.clear();
    assert.equal(await maybeHandleSlashCommand("/skills show custom-skill", session, workspace), true);
    assert.match(stdout.output(), /Follow this skill/);

    stdout.clear();
    assert.equal(await maybeHandleSlashCommand("/skills disable custom-skill", session, workspace), true);
    assert.match(stdout.output(), /Disabled skill custom-skill/);

    const disabledConfig = JSON.parse(await fs.readFile(path.join(configDir, "config.json"), "utf8")) as {
      skills?: { enabled?: string[] };
    };
    assert.deepEqual(disabledConfig.skills?.enabled, []);
  } finally {
    stdout.restore();

    if (originalConfigDir === undefined) {
      delete process.env.TIMCODE_CONFIG_DIR;
    } else {
      process.env.TIMCODE_CONFIG_DIR = originalConfigDir;
    }

    if (originalEnabledSkills === undefined) {
      delete process.env.TIMCODE_ENABLED_SKILLS;
    } else {
      process.env.TIMCODE_ENABLED_SKILLS = originalEnabledSkills;
    }

    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
  }
});

test("/skills enable adds dependencies and /skills disable blocks required dependencies", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-skills-workspace-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-config-"));
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;
  const stdout = captureStdout();

  process.env.TIMCODE_CONFIG_DIR = configDir;

  try {
    const skillRoot = path.join(workspace, ".opencode", "skills");
    await fs.mkdir(path.join(skillRoot, "dependency"), { recursive: true });
    await fs.writeFile(path.join(skillRoot, "dependency", "SKILL.md"), "# Dependency\nBase skill.", "utf8");
    await fs.mkdir(path.join(skillRoot, "parent"), { recursive: true });
    await fs.writeFile(
      path.join(skillRoot, "parent", "SKILL.md"),
      "---\nname: parent\ndependencies:\n- dependency\n---\n# Parent\nNeeds dependency.",
      "utf8",
    );

    const session = createSession();
    assert.equal(await maybeHandleSlashCommand("/skills enable parent", session, workspace), true);
    assert.match(stdout.output(), /Enabled skill parent with dependencies: dependency/);

    const savedConfig = JSON.parse(await fs.readFile(path.join(configDir, "config.json"), "utf8")) as {
      skills?: { enabled?: string[] };
    };
    assert.deepEqual(savedConfig.skills?.enabled, ["dependency", "parent"]);

    await assert.rejects(
      () => maybeHandleSlashCommand("/skills disable dependency", session, workspace),
      /Cannot disable skill dependency; still required by: parent/,
    );
  } finally {
    stdout.restore();

    if (originalConfigDir === undefined) {
      delete process.env.TIMCODE_CONFIG_DIR;
    } else {
      process.env.TIMCODE_CONFIG_DIR = originalConfigDir;
    }

    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
  }
});

test("/branch still works with the workspace-aware slash command signature", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-data-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-config-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;
  const session = createSession();
  const message = createUserMessage("hello");
  session.messages.push(message);
  const stdout = captureStdout();

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = configDir;

  try {
    assert.equal(await maybeHandleSlashCommand(`/branch ${message.id}`, session, process.cwd()), true);
    assert.match(stdout.output(), /Created branch .* at message/);
  } finally {
    stdout.restore();

    if (originalDataDir === undefined) {
      delete process.env.TIMCODE_DATA_DIR;
    } else {
      process.env.TIMCODE_DATA_DIR = originalDataDir;
    }

    if (originalConfigDir === undefined) {
      delete process.env.TIMCODE_CONFIG_DIR;
    } else {
      process.env.TIMCODE_CONFIG_DIR = originalConfigDir;
    }

    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
  }
});

test("/branch restore rewinds the current persisted session to the selected message", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-data-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-config-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;
  const session = createSession();
  const first = createUserMessage("hello");
  const second = createAssistantMessage("world", [{ id: "tool-1", name: "write", input: { path: "a.txt" } }]);
  const third = createUserMessage("later");
  session.messages.push(first, second, third);
  session.toolHistory.push("tool-1", "tool-2");
  const stdout = captureStdout();

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = configDir;

  try {
    await saveSession(session);

    assert.equal(await maybeHandleSlashCommand(`/branch restore ${second.id}`, session, process.cwd()), true);
    assert.match(stdout.output(), new RegExp(`Restored session ${session.id} to message ${second.id}`));
    assert.deepEqual(
      session.messages.map((message) => message.id),
      [first.id, second.id],
    );
    assert.deepEqual(session.toolHistory, ["tool-1"]);

    const persisted = await loadSession(session.id);
    assert.deepEqual(
      persisted.messages.map((message) => message.id),
      [first.id, second.id],
    );
    assert.deepEqual(persisted.toolHistory, ["tool-1"]);
  } finally {
    stdout.restore();

    if (originalDataDir === undefined) {
      delete process.env.TIMCODE_DATA_DIR;
    } else {
      process.env.TIMCODE_DATA_DIR = originalDataDir;
    }

    if (originalConfigDir === undefined) {
      delete process.env.TIMCODE_CONFIG_DIR;
    } else {
      process.env.TIMCODE_CONFIG_DIR = originalConfigDir;
    }

    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
  }
});

test("/branch without args uses the interactive picker selection", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-data-"));
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-config-"));
  const originalDataDir = process.env.TIMCODE_DATA_DIR;
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;
  const session = createSession();
  const first = createUserMessage("hello");
  const second = createAssistantMessage("world", []);
  session.messages.push(first, second);
  const stdout = captureStdout();

  process.env.TIMCODE_DATA_DIR = dataDir;
  process.env.TIMCODE_CONFIG_DIR = configDir;

  try {
    const seenSessions: string[] = [];
    assert.equal(
      await maybeHandleSlashCommand("/branch", session, process.cwd(), {
        async chooseBranchSelection(candidate) {
          seenSessions.push(candidate.id);
          return { action: "fork", messageId: second.id };
        },
      }),
      true,
    );
    assert.deepEqual(seenSessions, [session.id]);
    assert.match(stdout.output(), /Created branch .* at message/);
  } finally {
    stdout.restore();

    if (originalDataDir === undefined) {
      delete process.env.TIMCODE_DATA_DIR;
    } else {
      process.env.TIMCODE_DATA_DIR = originalDataDir;
    }

    if (originalConfigDir === undefined) {
      delete process.env.TIMCODE_CONFIG_DIR;
    } else {
      process.env.TIMCODE_CONFIG_DIR = originalConfigDir;
    }

    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(configDir, { recursive: true, force: true });
  }
});

test("/branch without args exits cleanly when the interactive picker cancels", async () => {
  const session = createSession();
  session.messages.push(createUserMessage("hello"));

  assert.equal(
    await maybeHandleSlashCommand("/branch", session, process.cwd(), {
      async chooseBranchSelection() {
        return null;
      },
    }),
    true,
  );
});

function captureStdout(): { output: () => string; clear: () => void; restore: () => void } {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let buffer = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;

  return {
    output: () => buffer,
    clear: () => {
      buffer = "";
    },
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}
