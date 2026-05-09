# TimCode Agentic Harness

Initial implementation of the agentic harness spec.

## Current Scope
- TypeScript/Node.js scaffold
- Provider and tool adapter boundaries
- Local JSON session persistence with schema versioning
- Slash command support for `/stash` and `/branch`
- Built-in local tools: `read`, `write`, `edit`, `bash`, `glob`, `grep`
- Mock provider for local development
- OpenAI provider adapter using the Chat Completions API
- Structured tool schemas and structured tool results
- First-class cancellation handling for model requests and long-running tools
- Structured terminal transcript rendering with provider, model, and workspace context
- Optional TypeScript/JavaScript LSP tools for diagnostics, definitions, references, and completions
- First isolated sub-agent delegation path via `spawn_agent`
- Built-in agent registry and parent-side child-session inspection tools
- Persisted parent/child message primitives for direct child sessions

## Commands
```bash
npm install
npm run build
node dist/index.js "create a hello.py file"
OPENAI_API_KEY=... node dist/index.js --provider openai "create a hello.py file"
OPENCODE_API_KEY=... node dist/index.js --provider opencode --model <model-id> "create a hello.py file"
node dist/index.js /stash save greeting "Always explain test failures first"
node dist/index.js --resume <session-id> /branch <message-id>
```

## Configuration
The harness reads configuration from:
- environment variables
- `TIMCODE_CONFIG_PATH`
- platform config directory, defaulting to `timcode-agentic-harness/config.json`

Default provider is `mock`.

## Provider Notes
- `mock` is the default and supports a small fixed task set for local verification.
- `openai` requires `OPENAI_API_KEY` and defaults to model `gpt-4.1-mini` unless `TIMCODE_MODEL` or `--model` is set.
- `opencode` requires `OPENCODE_API_KEY` and a required model via `--model` or `TIMCODE_MODEL`. It uses the OpenAI-compatible Zen endpoint at `https://opencode.ai/zen/v1` by default.
- `anthropic` is still unimplemented.

## LSP Notes
- The harness exposes `lsp_diagnostics`, `lsp_definition`, `lsp_references`, and `lsp_completions` for TypeScript/JavaScript files.
- These tools use `typescript-language-server` over stdio when available.
- Missing-server cases return a structured actionable tool error instead of crashing the session.
- Override the launch command with `TIMCODE_TYPESCRIPT_LSP_COMMAND` if needed.

## Sub-Agent Notes
- Top-level sessions expose a `spawn_agent` tool for focused delegation.
- Top-level sessions also expose `list_agent_types`, `list_agent_sessions`, `list_agent_messages`, and `send_agent_message`.
- Child agents run in isolated saved sessions with their own message history and tool activity.
- Child-agent results return to the parent only as structured tool output.
- Built-in agent types currently include `worker`, `explorer`, `reviewer`, and `general`.
- Child agents currently use the same configured provider/model as the parent and do not recursively expose parent-only agent tools.
- Parent/child notes are persisted on child sessions, including an automatic child-to-parent completion record after each delegated run.

## Tool Contract
Each tool exposes:
- a name and description
- a JSON-schema-like input contract
- a structured result with `summary`, optional `data`, normalized errors, and a distinct cancelled outcome when execution is aborted
