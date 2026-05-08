import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LocalToolAdapter } from "./local-tools.js";

test("local tool definitions expose structured schemas", () => {
  const adapter = new LocalToolAdapter(process.cwd());
  const write = adapter.listTools().find((tool) => tool.name === "write");

  assert.ok(write);
  assert.deepEqual(write?.inputSchema.required, ["path", "content"]);
  assert.equal(write?.inputSchema.additionalProperties, false);
});

test("write tool returns structured result payload", async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "timcode-tools-"));

  try {
    const adapter = new LocalToolAdapter(workspace);
    const result = await adapter.executeTool(
      {
        id: "call-1",
        name: "write",
        input: { path: "nested/hello.txt", content: "hello\n" },
      },
      new AbortController().signal,
    );

    assert.equal(result.ok, true);
    assert.equal(result.summary, "Wrote nested/hello.txt");
    assert.deepEqual(result.data, { path: "nested/hello.txt", bytesWritten: 6 });
    const written = await fs.readFile(path.join(workspace, "nested/hello.txt"), "utf8");
    assert.equal(written, "hello\n");
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
