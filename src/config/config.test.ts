import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "./config.js";

test("loadConfig reads enabled skills from env or config file", async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-config-"));
  const originalConfigDir = process.env.TIMCODE_CONFIG_DIR;
  const originalEnabledSkills = process.env.TIMCODE_ENABLED_SKILLS;

  process.env.TIMCODE_CONFIG_DIR = configDir;

  try {
    await fs.writeFile(
      path.join(configDir, "config.json"),
      JSON.stringify({ provider: "mock", skills: { enabled: ["brainstorming", "code-review"] } }, null, 2),
      "utf8",
    );

    const fileConfig = await loadConfig({});
    assert.deepEqual(fileConfig.skills?.enabled, ["brainstorming", "code-review"]);

    process.env.TIMCODE_ENABLED_SKILLS = "context-vault, mermaid-validation";
    const envConfig = await loadConfig({});
    assert.deepEqual(envConfig.skills?.enabled, ["context-vault", "mermaid-validation"]);
  } finally {
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

    await fs.rm(configDir, { recursive: true, force: true });
  }
});
