# TimCode Agentic Harness

Initial implementation of the agentic harness spec.

## Current Scope
- TypeScript/Node.js scaffold
- Provider and tool adapter boundaries
- Local JSON session persistence with schema versioning
- Slash command support for `/stash`, interactive `/branch`, `/branch fork`, and `/branch restore`
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
- Recursive agent-tree restore/status traversal, tree-wide messaging, and live shutdown execution for active child runs
- Filesystem-backed skill discovery, loading, and prompt injection with bundled starter skills

## Commands
```bash
npm install
npm run build
node dist/index.js "create a hello.py file"
OPENAI_API_KEY=... node dist/index.js --provider openai "create a hello.py file"
OPENCODE_API_KEY=... node dist/index.js --provider opencode --model <model-id> "create a hello.py file"
node dist/index.js /stash save greeting "Always explain test failures first"
node dist/index.js --resume <session-id> /branch fork <message-id>
node dist/index.js --resume <session-id> /branch restore <message-id>
node dist/index.js --resume <session-id> /branch
node dist/index.js /skills list
node dist/index.js /skills enable brainstorming
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
- Top-level sessions also expose `list_agent_types`, `list_agent_sessions`, `list_active_agent_runs`, `team_status`, `list_agent_messages`, `send_agent_message`, `broadcast_agent_message`, `request_agent_shutdown`, `cleanup_agent_session`, `list_skills`, and `load_skill`.
- Child agents run in isolated saved sessions with their own message history and tool activity.
- Child-agent results return to the parent only as structured tool output.
- Built-in agent types currently include `worker`, `explorer`, `reviewer`, and `general`.
- Child agents now use the same configured provider/model as the parent and can recursively spawn additional child agents.
- Parent/child notes are persisted on child sessions, including an automatic child-to-parent completion record after each delegated run.
- Sessions persist lifecycle state (`running`, `shutdown_requested`, `completed`, `cleaned_up`) so both direct-team and restored tree status can be aggregated.
- `list_agent_sessions` and `team_status` accept optional recursive traversal so a resumed descendant session can reconstruct the full tree rooted above it.
- `send_agent_message` can target any related session in the same tree, and `request_agent_shutdown` now aborts active runs instead of only writing lifecycle markers.
- `list_active_agent_runs` exposes the live in-memory run registry for a session or subtree, and `broadcast_agent_message` can fan a note out across a subtree in one call.
- `cleanup_agent_session` now also accepts recursive cleanup for full descendant subtrees.

## Skill Notes
- Skills are discovered from `~/.config/opencode/harness/skills/` and project-level `.opencode/skills/`.
- Each skill lives in its own directory with a `SKILL.md` entry file and optional sibling resources.
- Enabled skills are injected into parent and child agent system prompts at runtime.
- The tool adapter exposes `list_skills` and `load_skill` so agents can discover and load reusable skill instructions explicitly.
- Bundled starter skills currently include `brainstorming`, `mermaid-validation`, `code-review`, and `context-vault`.
- Persistent skill management is available through `/skills list`, `/skills enabled`, `/skills show <name>`, `/skills enable <name>`, and `/skills disable <name>`.
- Enabling a skill now persists any required dependencies automatically, and disabling a skill is blocked while another enabled skill still depends on it.
- Skill discovery now exposes each skill's `entryFilePath`, sibling `resourcePaths`, and `metadataWarnings` so malformed or partial skill definitions are visible instead of silently normalized.

## Tool Contract
Each tool exposes:
- a name and description
- a JSON-schema-like input contract
- a structured result with `summary`, optional `data`, normalized errors, and a distinct cancelled outcome when execution is aborted
