import assert from "node:assert/strict";
import test from "node:test";

import { resolveHarnessPaths } from "./paths.js";

test("resolveHarnessPaths returns stable session storage locations", () => {
  const paths = resolveHarnessPaths();

  assert.ok(paths.configDir.length > 0);
  assert.ok(paths.dataDir.length > 0);
  assert.ok(paths.sessionsDir.endsWith("sessions"));
  assert.ok(paths.configFile.endsWith("config.json"));
});
