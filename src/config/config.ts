import fs from "node:fs/promises";

import { resolveHarnessPaths } from "./paths.js";

export interface HarnessConfig {
  provider: string;
  model?: string;
  apiKeys: Partial<Record<"openai" | "anthropic" | "opencode", string>>;
}

const defaultConfig: HarnessConfig = {
  provider: "mock",
  apiKeys: {},
};

export async function loadConfig(overrides: {
  provider?: string;
  model?: string;
}): Promise<HarnessConfig> {
  const paths = resolveHarnessPaths();
  let fileConfig: Partial<HarnessConfig> = {};

  try {
    const raw = await fs.readFile(paths.configFile, "utf8");
    fileConfig = JSON.parse(raw) as Partial<HarnessConfig>;
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw new Error(`Failed to read config: ${String(error)}`);
    }
  }

  return {
    provider: overrides.provider ?? process.env.TIMCODE_PROVIDER ?? fileConfig.provider ?? defaultConfig.provider,
    model: overrides.model ?? process.env.TIMCODE_MODEL ?? fileConfig.model,
    apiKeys: {
      openai: process.env.OPENAI_API_KEY ?? fileConfig.apiKeys?.openai,
      anthropic: process.env.ANTHROPIC_API_KEY ?? fileConfig.apiKeys?.anthropic,
      opencode: process.env.OPENCODE_API_KEY ?? fileConfig.apiKeys?.opencode,
    },
  };
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
