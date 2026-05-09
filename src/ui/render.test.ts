import assert from "node:assert/strict";
import test from "node:test";

import { createSession } from "../session/store.js";
import { formatBanner } from "./render.js";

test("formatBanner includes provider, model, and workspace context", () => {
  const output = formatBanner(createSession(), {
    provider: "openai",
    model: "gpt-4.1-mini",
    workspaceRoot: "/tmp/workspace",
  });

  assert.match(output, /provider/);
  assert.match(output, /openai/);
  assert.match(output, /gpt-4\.1-mini/);
  assert.match(output, /workspace/);
  assert.match(output, /\/tmp\/workspace/);
});
