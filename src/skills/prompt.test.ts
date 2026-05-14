import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSession } from "../session/store.js";
import { injectEnabledSkills } from "./prompt.js";

test("injectEnabledSkills appends resolved skill context to the session", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-skills-workspace-"));

  try {
    const skillDir = path.join(workspace, ".opencode", "skills", "custom-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Custom Skill\nFollow this skill.", "utf8");

     const session = createSession();
     await injectEnabledSkills(session, workspace, ["custom-skill"]);

      assert.equal(session.messages.length, 1);
      assert.equal(session.messages[0]?.role, "system");
      assert.match(session.messages[0]?.content ?? "", /Loaded skills:/);
      assert.match(session.messages[0]?.content ?? "", /Custom Skill/);
      assert.deepEqual(session.loadedSkills.map((skill) => skill.name), ["custom-skill"]);

      await injectEnabledSkills(session, workspace, ["custom-skill"]);
      assert.equal(session.messages.length, 1);

      await injectEnabledSkills(session, workspace, []);
      assert.equal(session.messages.length, 0);
      assert.deepEqual(session.loadedSkills, []);
   } finally {
     await fs.rm(workspace, { recursive: true, force: true });
   }
});
