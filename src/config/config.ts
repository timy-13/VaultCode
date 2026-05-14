import fs from "node:fs/promises";
import path from "node:path";

import { resolveHarnessPaths } from "./paths.js";

export interface HarnessConfig {
  provider: string;
  model?: string;
  apiKeys: Partial<Record<"openai" | "anthropic" | "opencode", string>>;
  skills?: {
    enabled?: string[];
  };
}

const defaultConfig: HarnessConfig = {
  provider: "mock",
  apiKeys: {},
};

export async function loadConfig(overrides: {
  provider?: string;
  model?: string;
}): Promise<HarnessConfig> {
  const fileConfig = await loadFileConfig();

  return {
    provider: overrides.provider ?? process.env.TIMCODE_PROVIDER ?? fileConfig.provider ?? defaultConfig.provider,
    model: overrides.model ?? process.env.TIMCODE_MODEL ?? fileConfig.model,
    apiKeys: {
      openai: process.env.OPENAI_API_KEY ?? fileConfig.apiKeys?.openai,
      anthropic: process.env.ANTHROPIC_API_KEY ?? fileConfig.apiKeys?.anthropic,
      opencode: process.env.OPENCODE_API_KEY ?? fileConfig.apiKeys?.opencode,
    },
    skills: {
      enabled: readEnabledSkills(process.env.TIMCODE_ENABLED_SKILLS) ?? fileConfig.skills?.enabled,
    },
  };
}

export async function loadFileConfig(): Promise<Partial<HarnessConfig>> {
  const paths = resolveHarnessPaths();

  try {
    const raw = await fs.readFile(paths.configFile, "utf8");
    return JSON.parse(raw) as Partial<HarnessConfig>;
  } catch (error) {
    if (isMissingFileError(error)) {
      return {};
    }

    throw new Error(`Failed to read config: ${String(error)}`);
  }
}

export async function saveConfig(config: Partial<HarnessConfig>): Promise<void> {
  const paths = resolveHarnessPaths();
  await fs.mkdir(path.dirname(paths.configFile), { recursive: true });
  await fs.writeFile(paths.configFile, JSON.stringify(config, null, 2), "utf8");
}

function readEnabledSkills(raw: string | undefined): string[] | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
