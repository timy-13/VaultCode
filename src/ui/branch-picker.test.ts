import assert from "node:assert/strict";
import test from "node:test";

import { createAssistantMessage, createToolMessage, createUserMessage } from "../session/messages.js";
import { createSession } from "../session/store.js";
import { chooseBranchSelection, formatBranchMessageList, type BranchPickerIO } from "./branch-picker.js";

test("formatBranchMessageList renders numbered session messages", () => {
  const messages = [
    createUserMessage("hello there"),
    createAssistantMessage("working on it", []),
    createToolMessage({
      callId: "tool-1",
      name: "read",
      ok: true,
      summary: "Read README.md",
      data: null,
    }),
  ];

  const output = formatBranchMessageList(messages);
  assert.match(output, /1\. \[user\] hello there/);
  assert.match(output, /2\. \[assistant\] working on it/);
  assert.match(output, /3\. \[tool\] read: Read README\.md/);
});

test("chooseBranchSelection returns the selected message and restore action", async () => {
  const session = createSession();
  const first = createUserMessage("hello");
  const second = createAssistantMessage("world", []);
  session.messages.push(first, second);

  const writes: string[] = [];
  const prompts: string[] = [];
  const answers = ["2", "restore"];
  let closed = false;
  const io: BranchPickerIO = {
    write(text: string): void {
      writes.push(text);
    },
    async ask(prompt: string): Promise<string> {
      prompts.push(prompt);
      return answers.shift() ?? "";
    },
    close(): void {
      closed = true;
    },
  };

  const selection = await chooseBranchSelection(session, io);
  assert.deepEqual(selection, {
    action: "restore",
    messageId: second.id,
  });
  assert.equal(closed, true);
  assert.match(writes.join(""), /Select a message to branch from:/);
  assert.deepEqual(prompts, ["Message number (or q to cancel): ", "Action: \[f\]ork, \[r\]estore, or q to cancel: "]);
});

test("chooseBranchSelection loops on invalid input and supports cancellation", async () => {
  const session = createSession();
  session.messages.push(createUserMessage("one"));

  const writes: string[] = [];
  const answers = ["9", "1", "q"];
  const io: BranchPickerIO = {
    write(text: string): void {
      writes.push(text);
    },
    async ask(): Promise<string> {
      return answers.shift() ?? "";
    },
    close(): void {},
  };

  const selection = await chooseBranchSelection(session, io);
  assert.equal(selection, null);
  assert.match(writes.join(""), /Select a number between 1 and 1\./);
  assert.match(writes.join(""), /Cancelled branch selection\./);
});
