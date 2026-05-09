import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { SubAgentRunner } from "../agent/sub-agent.js";
import { TypeScriptLspService } from "../lsp/typescript-service.js";
import type { LspCompletionItem, LspDiagnostic, LspLocation, WorkspaceLspService } from "../lsp/types.js";
import { getAbortMessage, isAbortError } from "../runtime/abort.js";
import type { JsonValue, ToolAdapter, ToolCall, ToolDefinition, ToolResult } from "./types.js";

const execAsync = promisify(exec);

export class LocalToolAdapter implements ToolAdapter {
  private lspService?: WorkspaceLspService;
  private readonly subAgentRunner?: SubAgentRunner;

  constructor(
    private readonly workspaceRoot: string,
    options?: {
      lspService?: WorkspaceLspService;
      subAgentRunner?: SubAgentRunner;
    },
  ) {
    this.lspService = options?.lspService;
    this.subAgentRunner = options?.subAgentRunner;
  }

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
      {
        name: "lsp_diagnostics",
        description: "Get TypeScript or JavaScript diagnostics for a workspace file",
        inputSchema: objectSchema({ path: stringField("Workspace-relative TS/JS file path") }, ["path"]),
      },
      {
        name: "lsp_definition",
        description: "Find TypeScript or JavaScript definition locations at a zero-based line and character",
        inputSchema: objectSchema(
          {
            path: stringField("Workspace-relative TS/JS file path"),
            line: numberField("Zero-based line number"),
            character: numberField("Zero-based character offset"),
          },
          ["path", "line", "character"],
        ),
      },
      {
        name: "lsp_references",
        description: "Find TypeScript or JavaScript references at a zero-based line and character",
        inputSchema: objectSchema(
          {
            path: stringField("Workspace-relative TS/JS file path"),
            line: numberField("Zero-based line number"),
            character: numberField("Zero-based character offset"),
            includeDeclaration: booleanField("Whether to include declaration sites"),
          },
          ["path", "line", "character"],
        ),
      },
      {
        name: "lsp_completions",
        description: "Get TypeScript or JavaScript completions at a zero-based line and character",
        inputSchema: objectSchema(
          {
            path: stringField("Workspace-relative TS/JS file path"),
            line: numberField("Zero-based line number"),
            character: numberField("Zero-based character offset"),
          },
          ["path", "line", "character"],
        ),
      },
      ...(this.subAgentRunner
        ? [
            {
              name: "list_agent_types",
              description: "List the built-in sub-agent types available for delegation",
              inputSchema: objectSchema({}, []),
            },
            {
              name: "list_agent_sessions",
              description: "List direct child agent sessions spawned from the current parent session",
              inputSchema: objectSchema({}, []),
            },
            {
              name: "team_status",
              description: "Show aggregate lifecycle status for the parent session and its direct child agent sessions",
              inputSchema: objectSchema({}, []),
            },
            {
              name: "list_agent_messages",
              description: "List persisted parent/child messages for a direct child agent session",
              inputSchema: objectSchema({ sessionId: stringField("Direct child session ID") }, ["sessionId"]),
            },
            {
              name: "send_agent_message",
              description: "Send a note from the current parent session to a direct child agent session",
              inputSchema: objectSchema(
                {
                  sessionId: stringField("Direct child session ID"),
                  content: stringField("Message content to send to the child session"),
                },
                ["sessionId", "content"],
              ),
            },
            {
              name: "request_agent_shutdown",
              description: "Mark a direct child agent session as shutdown requested",
              inputSchema: objectSchema({ sessionId: stringField("Direct child session ID") }, ["sessionId"]),
            },
            {
              name: "cleanup_agent_session",
              description: "Mark a direct child agent session as cleaned up",
              inputSchema: objectSchema({ sessionId: stringField("Direct child session ID") }, ["sessionId"]),
            },
            {
              name: "spawn_agent",
              description: "Delegate a focused task to an isolated sub-agent session and return its result",
              inputSchema: objectSchema(
                {
                  task: stringField("Task for the sub-agent to perform"),
                  agentType: stringField("Optional sub-agent type such as worker or explorer"),
                },
                ["task"],
              ),
            },
          ]
        : []),
    ];
  }

  async dispose(): Promise<void> {
    await this.lspService?.dispose();
  }

  async executeTool(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    try {
      const result = await this.dispatch(call, signal);
      return { callId: call.id, name: call.name, ok: true, ...result };
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        return {
          callId: call.id,
          name: call.name,
          ok: false,
          cancelled: true,
          summary: `Tool ${call.name} cancelled`,
          error: {
            message: getAbortMessage(signal.reason ?? error),
          },
        };
      }

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
      case "lsp_diagnostics":
        return this.lspDiagnostics(expectString(call.input.path, "path"), signal);
      case "lsp_definition":
        return this.lspDefinition(
          expectString(call.input.path, "path"),
          expectNumber(call.input.line, "line"),
          expectNumber(call.input.character, "character"),
          signal,
        );
      case "lsp_references":
        return this.lspReferences(
          expectString(call.input.path, "path"),
          expectNumber(call.input.line, "line"),
          expectNumber(call.input.character, "character"),
          expectOptionalBoolean(call.input.includeDeclaration) ?? false,
          signal,
        );
      case "lsp_completions":
        return this.lspCompletions(
          expectString(call.input.path, "path"),
          expectNumber(call.input.line, "line"),
          expectNumber(call.input.character, "character"),
          signal,
        );
      case "spawn_agent":
        return this.spawnAgent(expectString(call.input.task, "task"), expectOptionalString(call.input.agentType), signal);
      case "list_agent_types":
        return this.listAgentTypes();
      case "list_agent_sessions":
        return this.listAgentSessions();
      case "team_status":
        return this.teamStatus();
      case "list_agent_messages":
        return this.listAgentMessages(expectString(call.input.sessionId, "sessionId"));
      case "send_agent_message":
        return this.sendAgentMessage(expectString(call.input.sessionId, "sessionId"), expectString(call.input.content, "content"));
      case "request_agent_shutdown":
        return this.requestAgentShutdown(expectString(call.input.sessionId, "sessionId"));
      case "cleanup_agent_session":
        return this.cleanupAgentSession(expectString(call.input.sessionId, "sessionId"));
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

  private async lspDiagnostics(filePath: string, signal: AbortSignal): Promise<{ summary: string; data: JsonValue }> {
    const diagnostics = await this.getLspService().getDiagnostics(filePath, signal);
    return {
      summary: `Found ${diagnostics.length} diagnostic(s) in ${filePath}`,
      data: { path: filePath, diagnostics: diagnostics.map(toJsonDiagnostic) },
    };
  }

  private async lspDefinition(
    filePath: string,
    line: number,
    character: number,
    signal: AbortSignal,
  ): Promise<{ summary: string; data: JsonValue }> {
    const locations = await this.getLspService().getDefinition(filePath, line, character, signal);
    return {
      summary: `Found ${locations.length} definition location(s) for ${filePath}:${line}:${character}`,
      data: { path: filePath, line, character, locations: locations.map(toJsonLocation) },
    };
  }

  private async lspReferences(
    filePath: string,
    line: number,
    character: number,
    includeDeclaration: boolean,
    signal: AbortSignal,
  ): Promise<{ summary: string; data: JsonValue }> {
    const locations = await this.getLspService().getReferences(filePath, line, character, includeDeclaration, signal);
    return {
      summary: `Found ${locations.length} reference location(s) for ${filePath}:${line}:${character}`,
      data: { path: filePath, line, character, includeDeclaration, locations: locations.map(toJsonLocation) },
    };
  }

  private async lspCompletions(
    filePath: string,
    line: number,
    character: number,
    signal: AbortSignal,
  ): Promise<{ summary: string; data: JsonValue }> {
    const items = await this.getLspService().getCompletions(filePath, line, character, signal);
    return {
      summary: `Found ${items.length} completion item(s) for ${filePath}:${line}:${character}`,
      data: { path: filePath, line, character, items: items.map(toJsonCompletion) },
    };
  }

  private async spawnAgent(task: string, agentType: string | undefined, signal: AbortSignal): Promise<{ summary: string; data: JsonValue }> {
    if (!this.subAgentRunner) {
      throw new Error("Sub-agent runner is not configured for this session.");
    }

    const result = await this.subAgentRunner.run({ task, agentType }, signal);
    return {
      summary: `Sub-agent ${result.agentType} completed in session ${result.sessionId}`,
      data: {
        sessionId: result.sessionId,
        parentSessionId: result.parentSessionId ?? null,
        agentType: result.agentType,
        assistantText: result.assistantText,
        toolRecords: result.toolRecords.map((record) => ({
          callId: record.callId,
          name: record.name,
          status: record.status,
          durationMs: record.durationMs,
          summary: record.summary,
        })),
      },
    };
  }

  private async listAgentTypes(): Promise<{ summary: string; data: JsonValue }> {
    if (!this.subAgentRunner) {
      throw new Error("Sub-agent runner is not configured for this session.");
    }

    const agentTypes = await this.subAgentRunner.listAgentTypes();
    return {
      summary: `Found ${agentTypes.length} built-in agent type(s)`,
      data: {
        agentTypes: agentTypes.map((agentType) => ({
          name: agentType.name,
          description: agentType.description,
        })),
      },
    };
  }

  private async listAgentSessions(): Promise<{ summary: string; data: JsonValue }> {
    if (!this.subAgentRunner) {
      throw new Error("Sub-agent runner is not configured for this session.");
    }

    const sessions = await this.subAgentRunner.listChildSessions();
    return {
      summary: `Found ${sessions.length} child agent session(s)`,
      data: {
        sessions: sessions.map((session) => ({
          id: session.id,
          parentSessionId: session.parentSessionId ?? null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lifecycleState: session.lifecycleState,
          messageCount: session.messageCount,
          lastAssistantText: session.lastAssistantText,
        })),
      },
    };
  }

  private async teamStatus(): Promise<{ summary: string; data: JsonValue }> {
    if (!this.subAgentRunner) {
      throw new Error("Sub-agent runner is not configured for this session.");
    }

    const status = await this.subAgentRunner.getTeamStatus();
    if (!status) {
      return {
        summary: "No team status is available for this session",
        data: { sessions: [] },
      };
    }

    return {
      summary: `Found ${status.totalSessions} session(s) in the direct team`,
      data: {
        parentSessionId: status.parentSessionId,
        totalSessions: status.totalSessions,
        counts: status.counts,
        sessions: status.sessions.map((session) => ({
          id: session.id,
          parentSessionId: session.parentSessionId ?? null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          lifecycleState: session.lifecycleState,
          messageCount: session.messageCount,
          lastAssistantText: session.lastAssistantText,
        })),
      },
    };
  }

  private async listAgentMessages(sessionId: string): Promise<{ summary: string; data: JsonValue }> {
    if (!this.subAgentRunner) {
      throw new Error("Sub-agent runner is not configured for this session.");
    }

    const messages = await this.subAgentRunner.listAgentMessages(sessionId);
    return {
      summary: `Found ${messages.length} agent message(s) for session ${sessionId}`,
      data: {
        sessionId,
        messages: messages.map((message) => ({
          id: message.id,
          fromSessionId: message.fromSessionId,
          toSessionId: message.toSessionId,
          direction: message.direction,
          createdAt: message.createdAt,
          content: message.content,
        })),
      },
    };
  }

  private async sendAgentMessage(sessionId: string, content: string): Promise<{ summary: string; data: JsonValue }> {
    if (!this.subAgentRunner) {
      throw new Error("Sub-agent runner is not configured for this session.");
    }

    const message = await this.subAgentRunner.sendMessage(sessionId, content);
    return {
      summary: `Sent agent message to session ${sessionId}`,
      data: {
        id: message.id,
        fromSessionId: message.fromSessionId,
        toSessionId: message.toSessionId,
        direction: message.direction,
        createdAt: message.createdAt,
        content: message.content,
      },
    };
  }

  private async requestAgentShutdown(sessionId: string): Promise<{ summary: string; data: JsonValue }> {
    if (!this.subAgentRunner) {
      throw new Error("Sub-agent runner is not configured for this session.");
    }

    const session = await this.subAgentRunner.requestShutdown(sessionId);
    return {
      summary: `Requested shutdown for session ${sessionId}`,
      data: {
        id: session.id,
        lifecycleState: session.lifecycleState,
        updatedAt: session.updatedAt,
      },
    };
  }

  private async cleanupAgentSession(sessionId: string): Promise<{ summary: string; data: JsonValue }> {
    if (!this.subAgentRunner) {
      throw new Error("Sub-agent runner is not configured for this session.");
    }

    const session = await this.subAgentRunner.cleanupSession(sessionId);
    return {
      summary: `Cleaned up session ${sessionId}`,
      data: {
        id: session.id,
        lifecycleState: session.lifecycleState,
        updatedAt: session.updatedAt,
      },
    };
  }

  private getLspService(): WorkspaceLspService {
    if (!this.lspService) {
      this.lspService = new TypeScriptLspService(this.workspaceRoot);
    }

    return this.lspService;
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

function expectNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Expected number input: ${name}`);
  }

  return value;
}

function expectOptionalBoolean(value: unknown): boolean | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error("Expected boolean input: includeDeclaration");
  }

  return value;
}

function expectOptionalString(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expected string input: agentType");
  }

  return value;
}

function stringField(description: string) {
  return { type: "string" as const, description };
}

function numberField(description: string) {
  return { type: "number" as const, description };
}

function booleanField(description: string) {
  return { type: "boolean" as const, description };
}

function toJsonDiagnostic(diagnostic: LspDiagnostic): JsonValue {
  return {
    message: diagnostic.message,
    severity: diagnostic.severity,
    source: diagnostic.source ?? null,
    code: diagnostic.code ?? null,
    range: {
      start: {
        line: diagnostic.range.start.line,
        character: diagnostic.range.start.character,
      },
      end: {
        line: diagnostic.range.end.line,
        character: diagnostic.range.end.character,
      },
    },
  };
}

function toJsonLocation(location: LspLocation): JsonValue {
  return {
    path: location.path,
    range: {
      start: {
        line: location.range.start.line,
        character: location.range.start.character,
      },
      end: {
        line: location.range.end.line,
        character: location.range.end.character,
      },
    },
  };
}

function toJsonCompletion(item: LspCompletionItem): JsonValue {
  return {
    label: item.label,
    kind: item.kind ?? null,
    detail: item.detail ?? null,
    documentation: item.documentation ?? null,
  };
}

function objectSchema(properties: ToolDefinition["inputSchema"]["properties"], required: string[]): ToolDefinition["inputSchema"] {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}
