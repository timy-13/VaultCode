import assert from "node:assert/strict";
import test from "node:test";

import { getAbortMessage, isAbortError, OperationCancelledError, toAbortError } from "./abort.js";

test("abort helpers classify cancellation errors", () => {
  const error = new OperationCancelledError("Cancelled by user.");

  assert.equal(isAbortError(error), true);
  assert.equal(getAbortMessage(error), "Cancelled by user.");
  assert.equal(toAbortError(new AbortController().signal) instanceof OperationCancelledError, true);
});
