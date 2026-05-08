import process from "node:process";

import { runPrompt } from "./runtime/run-prompt.js";
import { parseCliArgs } from "./ui/cli.js";
import { renderError } from "./ui/render.js";

export async function runCli(argv: string[]): Promise<void> {
  try {
    const args = parseCliArgs(argv);
    await runPrompt(args, process.cwd());
  } catch (error) {
    renderError(error);
    process.exitCode = 1;
  }
}
