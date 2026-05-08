import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { JsonValue, ToolAdapter, ToolCall, ToolDefinition, ToolResult } from "./types.js";

const execAsync = promisify(exec);

export class LocalToolAdapter implements ToolAdapter {
  constructor(private readonly workspaceRoot: string) {}

  listTools(): ToolDefinition[] {
    return [
      {
        name: "read",
        description: "Read a UTF-8 file inside the workspace",
        inputSchema: objectSchema({ path: stringField("Workspace-relative file path") }, ["path"]),
      },
      {
        name: "write",
        description: "Write a UTF-8 file inside the workspace",
        inputSchema: objectSchema(
          {
            path: stringField("Workspace-relative file path"),
            content: stringField("Complete file contents to write"),
          },
          ["path", "content"],
        ),
      },
      {
        name: "edit",
        description: "Replace one text fragment in a workspace file",
        inputSchema: objectSchema(
          {
            path: stringField("Workspace-relative file path"),
            oldText: stringField("Exact text to replace"),
            newText: stringField("Replacement text"),
          },
          ["path", "oldText", "newText"],
        ),
      },
      {
        name: "bash",
        description: "Run a shell command in the workspace",
        inputSchema: objectSchema({ command: stringField("Shell command to run") }, ["command"]),
      },
      {
        name: "glob",
        description: "List workspace files matching a glob pattern",
        inputSchema: objectSchema({ pattern: stringField("Glob pattern such as src/**/*.ts") }, ["pattern"]),
      },
      {
        name: "grep",
        description: "Search workspace files with a regular expression",
        inputSchema: objectSchema({ pattern: stringField("Regular expression pattern") }, ["pattern"]),
      },
    ];
  }

  async executeTool(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    try {
      const result = await this.dispatch(call, signal);
      return { callId: call.id, name: call.name, ok: true, ...result };
    } catch (error) {
      return {
        callId: call.id,
        name: call.name,
        ok: false,
        summary: `Tool ${call.name} failed`,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async dispatch(call: ToolCall, signal: AbortSignal): Promise<{ summary: string; data?: JsonValue }> {
    switch (call.name) {
      case "read":
        return this.readFile(expectString(call.input.path, "path"));
      case "write":
        return this.writeFile(expectString(call.input.path, "path"), expectString(call.input.content, "content"));
      case "edit":
        return this.editFile(
          expectString(call.input.path, "path"),
          expectString(call.input.oldText, "oldText"),
          expectString(call.input.newText, "newText"),
        );
      case "bash":
        return this.runBash(expectString(call.input.command, "command"), signal);
      case "glob":
        return this.glob(expectString(call.input.pattern, "pattern"));
      case "grep":
        return this.grep(expectString(call.input.pattern, "pattern"));
      default:
        throw new Error(`Unknown tool: ${call.name}`);
    }
  }

  private resolveWorkspacePath(relativePath: string): string {
    const resolved = path.resolve(this.workspaceRoot, relativePath);
    const relative = path.relative(this.workspaceRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`Path escapes workspace: ${relativePath}`);
    }

    return resolved;
  }

  private async readFile(filePath: string): Promise<{ summary: string; data: JsonValue }> {
    const content = await fs.readFile(this.resolveWorkspacePath(filePath), "utf8");
    return {
      summary: `Read ${filePath}`,
      data: { path: filePath, content },
    };
  }

  private async writeFile(filePath: string, content: string): Promise<{ summary: string; data: JsonValue }> {
    const resolved = this.resolveWorkspacePath(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf8");
    return {
      summary: `Wrote ${filePath}`,
      data: { path: filePath, bytesWritten: Buffer.byteLength(content, "utf8") },
    };
  }

  private async editFile(filePath: string, oldText: string, newText: string): Promise<{ summary: string; data: JsonValue }> {
    const resolved = this.resolveWorkspacePath(filePath);
    const current = await fs.readFile(resolved, "utf8");
    if (!current.includes(oldText)) {
      throw new Error(`Text to replace was not found in ${filePath}`);
    }

    await fs.writeFile(resolved, current.replace(oldText, newText), "utf8");
    return {
      summary: `Edited ${filePath}`,
      data: { path: filePath, replaced: oldText },
    };
  }

  private async runBash(command: string, signal: AbortSignal): Promise<{ summary: string; data: JsonValue }> {
    const result = await execAsync(command, {
      cwd: this.workspaceRoot,
      signal,
      shell: "/bin/zsh",
      maxBuffer: 1024 * 1024,
    });

    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "Command completed with no output";
    return {
      summary: `Ran shell command: ${command}`,
      data: { command, output },
    };
  }

  private async glob(pattern: string): Promise<{ summary: string; data: JsonValue }> {
    const files = await walk(this.workspaceRoot);
    const regex = globToRegExp(pattern);
    const matches = files
      .map((file) => path.relative(this.workspaceRoot, file))
      .filter((file) => regex.test(file));
    return {
      summary: `Matched ${matches.length} file(s) for ${pattern}`,
      data: { pattern, matches },
    };
  }

  private async grep(pattern: string): Promise<{ summary: string; data: JsonValue }> {
    const regex = new RegExp(pattern, "m");
    const files = await walk(this.workspaceRoot);
    const matches: string[] = [];

    for (const file of files) {
      const relativePath = path.relative(this.workspaceRoot, file);
      if (relativePath.startsWith(".git/")) {
        continue;
      }

      const content = await fs.readFile(file, "utf8").catch(() => "");
      if (regex.test(content)) {
        matches.push(relativePath);
      }
    }

    return {
      summary: `Found ${matches.length} file match(es) for ${pattern}`,
      data: { pattern, matches },
    };
  }
}

async function walk(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }

    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(target)));
    } else if (entry.isFile()) {
      files.push(target);
    }
  }

  return files;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::double-star::")
    .replace(/\*/g, "[^/]*")
    .replace(/::double-star::/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected string input: ${name}`);
  }

  return value;
}

function stringField(description: string) {
  return { type: "string" as const, description };
}

function objectSchema(properties: ToolDefinition["inputSchema"]["properties"], required: string[]): ToolDefinition["inputSchema"] {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}
