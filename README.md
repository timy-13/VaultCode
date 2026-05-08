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

## Tool Contract
Each tool exposes:
- a name and description
- a JSON-schema-like input contract
- a structured result with `summary`, optional `data`, and normalized errors
