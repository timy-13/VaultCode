import os from "node:os";
import path from "node:path";

export interface HarnessPaths {
  configDir: string;
  dataDir: string;
  sessionsDir: string;
  stashFile: string;
  configFile: string;
}

export function resolveHarnessPaths(): HarnessPaths {
  const home = os.homedir();
  const platform = process.platform;

  const configDir =
    process.env.TIMCODE_CONFIG_DIR ??
    (platform === "darwin"
      ? path.join(home, "Library", "Application Support", "timcode-agentic-harness")
      : path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "timcode-agentic-harness"));

  const dataDir =
    process.env.TIMCODE_DATA_DIR ??
    (platform === "darwin"
      ? path.join(home, "Library", "Application Support", "timcode-agentic-harness")
      : path.join(process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "timcode-agentic-harness"));

  return {
    configDir,
    dataDir,
    sessionsDir: path.join(dataDir, "sessions"),
    stashFile: path.join(dataDir, "stash.json"),
    configFile: process.env.TIMCODE_CONFIG_PATH ?? path.join(configDir, "config.json"),
  };
}
