import assert from "node:assert/strict";
import test from "node:test";

import { createAssistantMessage, createUserMessage } from "./messages.js";
import { branchSession, createSession } from "./store.js";

test("branchSession keeps history through the selected message", () => {
  const session = createSession();
  const first = createUserMessage("one");
  const second = createAssistantMessage("two", [{ id: "tool-1", name: "write", input: { path: "a.txt" } }]);
  const third = createUserMessage("three");
  session.messages.push(first, second, third);
  session.toolHistory.push("tool-1", "tool-2");

  const branch = branchSession(session, second.id);

  assert.equal(branch.parentSessionId, session.id);
  assert.deepEqual(
    branch.messages.map((message) => message.id),
    [first.id, second.id],
  );
  assert.deepEqual(branch.toolHistory, ["tool-1"]);
});
