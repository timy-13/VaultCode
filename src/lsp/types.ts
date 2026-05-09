export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  message: string;
  severity: string;
  source?: string;
  code?: string;
  range: LspRange;
}

export interface LspLocation {
  path: string;
  range: LspRange;
}

export interface LspCompletionItem {
  label: string;
  kind?: string;
  detail?: string;
  documentation?: string;
}

export interface WorkspaceLspService {
  getDiagnostics(filePath: string, signal: AbortSignal): Promise<LspDiagnostic[]>;
  getDefinition(filePath: string, line: number, character: number, signal: AbortSignal): Promise<LspLocation[]>;
  getCompletions(filePath: string, line: number, character: number, signal: AbortSignal): Promise<LspCompletionItem[]>;
  getReferences(
    filePath: string,
    line: number,
    character: number,
    includeDeclaration: boolean,
    signal: AbortSignal,
  ): Promise<LspLocation[]>;
  dispose(): Promise<void>;
}
