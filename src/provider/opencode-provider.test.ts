import assert from "node:assert/strict";
import test from "node:test";

import { OpenCodeProvider } from "./opencode-provider.js";

test("OpenCodeProvider requires OPENCODE_API_KEY", () => {
  assert.throws(
    () => new OpenCodeProvider({ provider: "opencode", model: "qwen3.5-plus", apiKeys: {} }),
    /OPENCODE_API_KEY is required/,
  );
});

test("OpenCodeProvider requires an explicit model", () => {
  assert.throws(
    () => new OpenCodeProvider({ provider: "opencode", apiKeys: { opencode: "test-key" } }),
    /A model is required when provider=opencode/,
  );
});
