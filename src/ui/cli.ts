export interface CliArgs {
  prompt: string;
  resumeSessionId?: string;
  provider?: string;
  model?: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args = [...argv];
  let resumeSessionId: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  const promptParts: string[] = [];

  while (args.length > 0) {
    const current = args.shift();
    if (!current) {
      break;
    }

    if (current === "--resume") {
      resumeSessionId = expectValue(args, current);
      continue;
    }

    if (current === "--provider") {
      provider = expectValue(args, current);
      continue;
    }

    if (current === "--model") {
      model = expectValue(args, current);
      continue;
    }

    promptParts.push(current, ...args);
    break;
  }

  const prompt = promptParts.join(" ").trim();
  if (!prompt) {
    throw new Error("A prompt or slash command is required.");
  }

  return { prompt, resumeSessionId, provider, model };
}

function expectValue(args: string[], flag: string): string {
  const value = args.shift();
  if (!value) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}
