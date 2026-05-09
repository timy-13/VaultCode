import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { getAbortMessage, isAbortError, OperationCancelledError } from "../runtime/abort.js";
import type { LspCompletionItem, LspDiagnostic, LspLocation, WorkspaceLspService } from "./types.js";

const DEFAULT_TYPESCRIPT_LSP_COMMAND = process.env.TIMCODE_TYPESCRIPT_LSP_COMMAND ?? "typescript-language-server --stdio";
const DIAGNOSTIC_TIMEOUT_MS = 1000;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export class TypeScriptLspService implements WorkspaceLspService {
  private process?: ChildProcessWithoutNullStreams;
  private initializePromise?: Promise<void>;
  private nextId = 1;
  private readBuffer = "";
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private readonly versions = new Map<string, number>();
  private readonly diagnostics = new Map<string, LspDiagnostic[]>();
  private readonly diagnosticWaiters = new Map<string, Array<(diagnostics: LspDiagnostic[]) => void>>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly command = DEFAULT_TYPESCRIPT_LSP_COMMAND,
  ) {}

  async getDiagnostics(filePath: string, signal: AbortSignal): Promise<LspDiagnostic[]> {
    const document = await this.syncDocument(filePath, signal);
    return this.waitForDiagnostics(document.uri, signal);
  }

  async getDefinition(filePath: string, line: number, character: number, signal: AbortSignal): Promise<LspLocation[]> {
    const document = await this.syncDocument(filePath, signal);
    const result = await this.sendRequest(
      "textDocument/definition",
      {
        textDocument: { uri: document.uri },
        position: { line, character },
      },
      signal,
    );
    return normalizeLocations(result, this.workspaceRoot);
  }

  async getCompletions(filePath: string, line: number, character: number, signal: AbortSignal): Promise<LspCompletionItem[]> {
    const document = await this.syncDocument(filePath, signal);
    const result = await this.sendRequest(
      "textDocument/completion",
      {
        textDocument: { uri: document.uri },
        position: { line, character },
      },
      signal,
    );
    return normalizeCompletions(result);
  }

  async getReferences(
    filePath: string,
    line: number,
    character: number,
    includeDeclaration: boolean,
    signal: AbortSignal,
  ): Promise<LspLocation[]> {
    const document = await this.syncDocument(filePath, signal);
    const result = await this.sendRequest(
      "textDocument/references",
      {
        textDocument: { uri: document.uri },
        position: { line, character },
        context: { includeDeclaration },
      },
      signal,
    );
    return normalizeLocations(result, this.workspaceRoot);
  }

  async dispose(): Promise<void> {
    if (!this.process) {
      return;
    }

    const current = this.process;

    try {
      await this.sendRequest("shutdown", undefined, new AbortController().signal);
    } catch {
      // Ignore shutdown failures during cleanup.
    }

    try {
      current.stdin.write(encodeMessage({ jsonrpc: "2.0", method: "exit" }));
    } catch {
      // Ignore exit write failures during cleanup.
    }

    current.kill();
    this.process = undefined;
    this.initializePromise = undefined;
  }

  private async syncDocument(filePath: string, signal: AbortSignal): Promise<TextDocumentItem> {
    await this.ensureInitialized(signal);

    const resolvedPath = path.resolve(this.workspaceRoot, filePath);
    const languageId = getLanguageId(resolvedPath);
    const text = await fs.readFile(resolvedPath, "utf8");
    const uri = toFileUri(resolvedPath);
    const version = (this.versions.get(uri) ?? 0) + 1;
    this.versions.set(uri, version);
    this.diagnostics.delete(uri);

    const document: TextDocumentItem = {
      uri,
      languageId,
      version,
      text,
    };

    if (version === 1) {
      this.sendNotification("textDocument/didOpen", { textDocument: document });
    } else {
      this.sendNotification("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    }

    return document;
  }

  private async ensureInitialized(signal: AbortSignal): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.start(signal);
    }

    return this.initializePromise;
  }

  private async start(signal: AbortSignal): Promise<void> {
    const child = spawn("/bin/zsh", ["-lc", this.command], {
      cwd: this.workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.readBuffer += chunk;
      this.consumeMessages();
    });

    child.stderr.setEncoding("utf8");

    child.on("error", (error) => {
      this.rejectAllPending(new Error(`Failed to start TypeScript LSP server: ${error.message}`));
    });

    child.on("close", (code) => {
      const stderr = child.stderr.read()?.toString().trim();
      const reason = stderr || `TypeScript LSP server exited with code ${code ?? "unknown"}.`;
      this.process = undefined;
      this.initializePromise = undefined;
      this.rejectAllPending(new Error(reason));
    });

    try {
      await this.sendRequest(
        "initialize",
        {
          processId: process.pid,
          rootUri: toFileUri(this.workspaceRoot),
          capabilities: {},
        },
        signal,
      );
      this.sendNotification("initialized", {});
    } catch (error) {
      await this.dispose();
      if (isAbortError(error)) {
        throw error;
      }

      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `TypeScript LSP is unavailable. Install \`typescript-language-server\` and ensure it is on PATH, or set TIMCODE_TYPESCRIPT_LSP_COMMAND. ${reason}`,
      );
    }
  }

  private consumeMessages(): void {
    while (true) {
      const separatorIndex = this.readBuffer.indexOf("\r\n\r\n");
      if (separatorIndex === -1) {
        return;
      }

      const header = this.readBuffer.slice(0, separatorIndex);
      const lengthMatch = header.match(/Content-Length: (\d+)/i);
      if (!lengthMatch) {
        throw new Error("Malformed LSP response: missing Content-Length header.");
      }

      const length = Number(lengthMatch[1]);
      const messageStart = separatorIndex + 4;
      if (this.readBuffer.length < messageStart + length) {
        return;
      }

      const rawMessage = this.readBuffer.slice(messageStart, messageStart + length);
      this.readBuffer = this.readBuffer.slice(messageStart + length);
      this.handleMessage(JSON.parse(rawMessage) as JsonRpcResponse | JsonRpcNotification);
    }
  }

  private handleMessage(message: JsonRpcResponse | JsonRpcNotification): void {
    if ("id" in message) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
        return;
      }

      pending.resolve(message.result);
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      const params = message.params as { uri?: string; diagnostics?: unknown[] } | undefined;
      if (!params?.uri) {
        return;
      }

      const diagnostics = Array.isArray(params.diagnostics) ? params.diagnostics.map(normalizeDiagnostic) : [];
      this.diagnostics.set(params.uri, diagnostics);
      const waiters = this.diagnosticWaiters.get(params.uri) ?? [];
      this.diagnosticWaiters.delete(params.uri);
      for (const waiter of waiters) {
        waiter(diagnostics);
      }
    }
  }

  private async sendRequest(method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new OperationCancelledError(getAbortMessage(signal.reason));
    }

    if (!this.process) {
      throw new Error("TypeScript LSP server is not running.");
    }

    const id = this.nextId++;
    const payload: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    const requestPromise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process?.stdin.write(encodeMessage(payload), (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });

    return withAbort(requestPromise, signal, () => {
      this.pending.delete(id);
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (!this.process) {
      throw new Error("TypeScript LSP server is not running.");
    }

    const payload: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    this.process.stdin.write(encodeMessage(payload));
  }

  private async waitForDiagnostics(uri: string, signal: AbortSignal): Promise<LspDiagnostic[]> {
    const existing = this.diagnostics.get(uri);
    if (existing) {
      return existing;
    }

    return withAbort(
      new Promise<LspDiagnostic[]>((resolve) => {
        const timeout = setTimeout(() => {
          const remaining = this.diagnosticWaiters.get(uri) ?? [];
          this.diagnosticWaiters.set(
            uri,
            remaining.filter((waiter) => waiter !== onDiagnostics),
          );
          resolve(this.diagnostics.get(uri) ?? []);
        }, DIAGNOSTIC_TIMEOUT_MS);

        const onDiagnostics = (diagnostics: LspDiagnostic[]) => {
          clearTimeout(timeout);
          resolve(diagnostics);
        };

        const waiters = this.diagnosticWaiters.get(uri) ?? [];
        waiters.push(onDiagnostics);
        this.diagnosticWaiters.set(uri, waiters);
      }),
      signal,
    );
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function encodeMessage(payload: JsonRpcRequest | JsonRpcNotification): string {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function toFileUri(filePath: string): string {
  return new URL(`file://${filePath}`).toString();
}

function getLanguageId(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".ts":
    case ".cts":
    case ".mts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".js":
    case ".cjs":
    case ".mjs":
      return "javascript";
    case ".jsx":
      return "javascriptreact";
    default:
      throw new Error(`LSP tool only supports TypeScript and JavaScript files: ${path.basename(filePath)}`);
  }
}

function normalizeDiagnostic(input: unknown): LspDiagnostic {
  const diagnostic = (input ?? {}) as {
    message?: unknown;
    severity?: unknown;
    source?: unknown;
    code?: unknown;
    range?: {
      start?: { line?: unknown; character?: unknown };
      end?: { line?: unknown; character?: unknown };
    };
  };

  return {
    message: typeof diagnostic.message === "string" ? diagnostic.message : "Unknown diagnostic",
    severity: toSeverityLabel(diagnostic.severity),
    source: typeof diagnostic.source === "string" ? diagnostic.source : undefined,
    code: diagnostic.code == null ? undefined : String(diagnostic.code),
    range: {
      start: {
        line: typeof diagnostic.range?.start?.line === "number" ? diagnostic.range.start.line : 0,
        character: typeof diagnostic.range?.start?.character === "number" ? diagnostic.range.start.character : 0,
      },
      end: {
        line: typeof diagnostic.range?.end?.line === "number" ? diagnostic.range.end.line : 0,
        character: typeof diagnostic.range?.end?.character === "number" ? diagnostic.range.end.character : 0,
      },
    },
  };
}

function toSeverityLabel(severity: unknown): string {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "information";
    case 4:
      return "hint";
    default:
      return "unknown";
  }
}

function normalizeLocations(input: unknown, workspaceRoot: string): LspLocation[] {
  const values = Array.isArray(input) ? input : input ? [input] : [];
  return values.flatMap((value) => {
    const location = value as {
      uri?: unknown;
      targetUri?: unknown;
      range?: unknown;
      targetSelectionRange?: unknown;
      targetRange?: unknown;
    };
    const rawUri = typeof location.uri === "string" ? location.uri : typeof location.targetUri === "string" ? location.targetUri : undefined;
    if (!rawUri) {
      return [];
    }

    const rawRange = (location.range ?? location.targetSelectionRange ?? location.targetRange) as {
      start?: { line?: unknown; character?: unknown };
      end?: { line?: unknown; character?: unknown };
    } | undefined;

    const filePath = fileUriToWorkspacePath(rawUri, workspaceRoot);
    return [
      {
        path: filePath,
        range: {
          start: {
            line: typeof rawRange?.start?.line === "number" ? rawRange.start.line : 0,
            character: typeof rawRange?.start?.character === "number" ? rawRange.start.character : 0,
          },
          end: {
            line: typeof rawRange?.end?.line === "number" ? rawRange.end.line : 0,
            character: typeof rawRange?.end?.character === "number" ? rawRange.end.character : 0,
          },
        },
      },
    ];
  });
}

function normalizeCompletions(input: unknown): LspCompletionItem[] {
  const list = (
    input && typeof input === "object" && !Array.isArray(input) && "items" in input
      ? (input as { items?: unknown }).items
      : input
  ) as unknown;
  const values = Array.isArray(list) ? list : [];
  return values.map((value) => {
    const item = value as {
      label?: unknown;
      kind?: unknown;
      detail?: unknown;
      documentation?: unknown;
    };

    return {
      label: typeof item.label === "string" ? item.label : "",
      kind: item.kind == null ? undefined : String(item.kind),
      detail: typeof item.detail === "string" ? item.detail : undefined,
      documentation:
        typeof item.documentation === "string"
          ? item.documentation
          : item.documentation && typeof item.documentation === "object" && "value" in item.documentation && typeof (item.documentation as { value?: unknown }).value === "string"
            ? (item.documentation as { value: string }).value
            : undefined,
    };
  }).filter((item) => item.label.length > 0);
}

function fileUriToWorkspacePath(uri: string, workspaceRoot: string): string {
  const absolutePath = new URL(uri).pathname;
  const decodedPath = decodeURIComponent(absolutePath);
  return path.relative(workspaceRoot, decodedPath) || path.basename(decodedPath);
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal, onAbort?: () => void): Promise<T> {
  if (signal.aborted) {
    onAbort?.();
    return Promise.reject(signal.reason instanceof Error ? signal.reason : new OperationCancelledError(getAbortMessage(signal.reason)));
  }

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort?.();
      reject(signal.reason instanceof Error ? signal.reason : new OperationCancelledError(getAbortMessage(signal.reason)));
    };

    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
