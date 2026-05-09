# Agentic Harness Specification

## Goal
Build a minimal, extensible CLI agentic harness for software engineering tasks, inspired by opencode/pi/claudecode/codex. Start with a small but usable core agent loop with tool calling, then iteratively add LSP integration, specialized sub-agents, reusable skill modules, rich terminal UI, and session persistence.

## Principles
- Keep the first implementation small: prefer a narrow, reliable core over broad but shallow feature coverage.
- Preserve clear boundaries between model orchestration, tool execution, UI, persistence, and optional integrations.
- Design for local-first usage: all state is stored locally and all network access is explicit and attributable.
- Make advanced features additive: LSP, agents, and skills must layer onto the core without changing the core loop contract.
- Prefer stable internal contracts over framework-specific behavior so runtime or provider swaps remain feasible.

## Constraints
- CLI-first interface with rich terminal UI
- Explicit language/runtime evaluation before core implementation, prioritizing compatibility with LSP libraries, RTK plugin, terminal UI frameworks, and LLM SDKs
- Must support LLM-driven tool use through a dedicated tool adapter layer. If RTK is selected, it should be integrated behind this abstraction rather than coupled directly into the agent loop.
- Extensible architecture to add agents/skills/LSP without rewriting core
- Local-first execution with configurable LLM provider API keys
- Session save/restore for agent state persistence

## Non-Goals For Initial Delivery
- Remote multi-user collaboration
- Hosted control plane or telemetry backend
- IDE/editor plugins
- Autonomous background daemons
- Full parity with existing agent frameworks

## Cross-Cutting Requirements
- Configuration and data directories should follow platform conventions: use XDG locations on Linux and the platform-appropriate user config/data directories on macOS.
- Persisted session formats must include a schema version to allow future migrations.
- All tool executions must capture structured metadata at minimum: tool name, input, status, duration, and error details when applicable.
- Model providers must be swappable through a stable adapter interface without changing prompt orchestration code.
- The harness must degrade gracefully when optional subsystems are unavailable. Example: if no LSP server is installed, the core loop still works and the user receives a clear actionable error.

## Current Implementation Snapshot
- Runtime selected and scaffolded: TypeScript / Node.js.
- Core CLI scaffold exists with a runnable agent loop, local session persistence, and slash command handling.
- The CLI transcript now renders structured banner, prompt, assistant, and tool sections without requiring a full-screen TUI framework.
- Implemented providers:
  - `mock` for fixed local end-to-end verification.
  - `openai` using the Chat Completions API.
  - `opencode` using the OpenAI-compatible Zen endpoint at `https://opencode.ai/zen/v1` by default.
- Current provider auth/config behavior:
  - `openai` uses `OPENAI_API_KEY` and defaults to `gpt-4.1-mini` if no model is set.
  - `opencode` uses `OPENCODE_API_KEY` and requires an explicit model via CLI flag or config.
- Implemented core tools: `read`, `write`, `edit`, `bash`, `glob`, `grep`.
- Implemented LSP tools: `lsp_diagnostics`, `lsp_definition`, `lsp_references`, `lsp_completions` for TypeScript/JavaScript workspaces.
- Tool definitions now expose structured input schemas and structured results (`summary`, optional `data`, normalized error object).
- Cancellation is wired through the CLI, agent loop, and local tool adapter so aborted model requests and long-running tools surface as distinct cancelled outcomes instead of generic failures.
- TypeScript LSP integration is optional and uses `typescript-language-server` over stdio when available; missing-server cases return structured actionable tool errors.
- A first sub-agent delegation path exists through `spawn_agent`, which runs a child agent in an isolated saved session and returns only structured results to the parent.
- Session persistence is JSON-based with schema versioning and stores full assistant tool calls and normalized tool results so resumed sessions preserve provider-relevant context.
- `/stash` and `/branch` are implemented in the initial scaffold.
- Current tests cover config/path resolution, session branching, provider message/tool mapping, and structured local tool behavior.

## Phased Implementation

### Phase 0: Runtime Evaluation (Pre-Core)
Compare top runtimes against project requirements, select optimal runtime before Phase 1 to avoid rework.
1. **Evaluation Criteria**: LSP library maturity, RTK plugin compatibility, terminal UI ecosystem, LLM SDK support, prototyping speed, distribution needs.
2. **Candidate Comparison**:
   - **TypeScript/Node.js (Recommended)**:
     - Pros: Native compatibility if RTK plugin is JS/TS-based, `ink`/`blessed` for rich terminal UI, `vscode-languageserver-node` for LSP integration, widespread LLM SDKs (Anthropic, OpenAI), large CLI ecosystem.
     - Cons: Higher memory overhead than compiled languages, runtime dependency on Node.js.
   - **Python**:
     - Pros: Dominant AI/LLM ecosystem, `pygls` for LSP, rapid prototyping, simple syntax.
     - Cons: Terminal UI libs (`textual`, `rich`) less mature than JS options, RTK compatibility uncertain if JS-based, slower execution for heavy tasks.
   - **Go**:
     - Pros: Fast single-binary distribution, `bubble tea`/`lip gloss` for terminal UI, `gopls`-style LSP patterns, low memory overhead.
     - Cons: Smaller LLM ecosystem, RTK compatibility uncertain, less flexible for rapid iteration.
3. **Deliverable**: Documented evaluation with selected runtime and compatibility verification for tool adapter strategy, LSP, UI libraries, packaging, and local persistence ergonomics.
4. **Decision Rule**: If RTK compatibility is uncertain, favor the runtime with the strongest overall fit and implement the tool adapter so RTK can be integrated later without reworking the core loop.

### Phase 1: Bare-Bones Core (v0.1)
Implement minimal agentic loop with essential features:
1. CLI entry point with rich terminal UI (progress indicators, color-coded output, structured tool call display)
   - Current implementation uses structured line-oriented rendering rather than a full-screen TUI.
2. LLM client with provider adapter pattern (Anthropic Claude, OpenAI GPT, etc.)
3. API key configuration system (env vars, config file, CLI flags)
4. Core tool set exposed through the tool adapter: `read`, `write`, `edit`, `bash`, `glob`, `grep`
5. Agent loop: send prompt + tool definitions -> parse tool calls via the tool adapter -> execute tools -> return results -> repeat until task completion
6. Basic session save/restore (serialize conversation history, agent state, tool call history, and session metadata to local JSON files)
7. Built-in CLI commands: `/stash` (prompt stash), `/branch` (revert chat to a previous message; spawn new chat from a specific conversation point)
8. Cancellation support for in-flight model requests and long-running tool executions

**Implemented So Far In Phase 1**
- TypeScript CLI scaffold with build/test scripts.
- Provider adapter boundary with working `mock`, `openai`, and `opencode` providers.
- Local tool adapter with the six core tools.
- Local tool adapter now also exposes optional TypeScript/JavaScript LSP tools.
- Top-level sessions now expose an initial `spawn_agent` tool for isolated task delegation.
- JSON session storage with schema versioning.
- Slash commands for `/stash` and `/branch`.
- Basic test coverage for the current scaffold.
- Verified cancellation handling for provider aborts and long-running shell tools.
- Verified structured LSP tool behavior with injected service tests and unavailable-server error handling.
- Verified isolated sub-agent session persistence and structured parent-visible delegation results.

**Phase 1 Exclusions**
- No multi-agent team lifecycle management yet
- No skills
- No automatic LSP server management
- No plugin marketplace or third-party extension loading
- No in-memory document sync beyond reading current on-disk file contents before each LSP request

### Phase 2: LSP Integration (v0.2)
Add Language Server Protocol support for code intelligence:
1. LSP client implementation using runtime-selected LSP library
2. Optional automatic LSP server spawning (e.g., `typescript-language-server` for TS/JS, `pyright` for Python)
3. Expose LSP capabilities as agent-callable tools (diagnostics, go-to-definition, completions, references)
4. Workspace-aware document synchronization so LSP results reflect unsaved harness edits
5. Enhance agent's ability to understand and modify code correctly

### Phase 3: Agent System (v0.3)
Add specialized sub-agents with team management:
1. Agent registry for predefined types (explorer, code-reviewer, worker, general)
2. Sub-agent spawn mechanism with isolated context and session persistence
3. Inter-agent communication (message passing, task delegation, result return)
4. Team lifecycle management (spawn, status check, graceful shutdown, force shutdown, cleanup)
5. Full session save/restore for multi-agent teams
6. Explicit parent-child execution model so sub-agents cannot mutate parent context except through returned results or messages

### Phase 4: Skill System (v0.4)
Add reusable, injectable skill modules:
1. Skill definition format: Markdown instruction file + optional scripts/resources in a directory
2. Skill loader to inject skill context into agent prompts at runtime
3. Skill registry for discovery, enabling/disabling, and dependency management
4. Bundled starter skills (brainstorming, mermaid-validation, code-review, context-vault)
5. Support for user-defined custom skills without core code changes

## Core Architecture
1. **UI Layer**: renders transcript, tool activity, progress state, slash-command feedback, and errors.
2. **Session Controller**: owns the active conversation, slash commands, branching, save/restore, and cancellation.
3. **Agent Loop**: orchestrates model requests, tool-choice handling, termination conditions, and retry/error behavior.
4. **Provider Adapter**: normalizes model APIs, streaming events, tool-call payloads, and authentication.
5. **Tool Adapter**: normalizes tool schemas and tool execution results; RTK should plug in here if adopted.
6. **Persistence Layer**: stores config, sessions, branches, and versioned metadata.
7. **Optional Integrations**: LSP, sub-agent runtime, and skill loader remain outside the core loop boundary.

**Implemented Architecture Notes**
- The current provider implementations share OpenAI-compatible message/tool conversion helpers where possible.
- The current `opencode` provider intentionally targets the OpenAI-compatible Zen route only; model-specific protocol switching like Pi's broader provider matrix is not yet implemented.
- The current tool adapter returns structured results instead of raw strings so later providers and persistence can reuse normalized tool state.
- The current LSP implementation is a small stdio JSON-RPC client for `typescript-language-server` and currently reads on-disk file contents for each request instead of maintaining unsaved editor buffers.
- The current sub-agent implementation reuses the configured provider/model, creates a child session with a parent session ID link, and keeps delegation one-way by returning only structured tool output to the parent.

## Session Model
- A session has a stable session ID, creation timestamp, last-updated timestamp, schema version, and optional parent session ID for `/branch`.
- Each message records role, content blocks, tool-call references, and timestamps.
- Each tool call records request payload, normalized result payload, duration, and failure metadata.
- `/stash` stores reusable prompt snippets separately from chat history.
- `/branch` creates a new session that inherits history only up to the chosen message and never mutates the original session.

**Implemented Session Details**
- Assistant messages persist full tool-call objects, not only tool-call IDs.
- Tool messages persist the normalized tool result object.
- Branching preserves only the retained tool-call history reachable from the selected branch point.
- Child sub-agent sessions persist independently and are linked to the parent session through `parentSessionId`.

## Affected Areas
- Runtime evaluation and selection documentation
- CLI entry point and argument parsing
- Rich terminal UI implementation (framework-dependent)
- LLM client with provider adapters and API key management
- Tool adapter and optional RTK integration layer for tool call standardization
- Tool execution engine (file ops, shell, search, LSP)
- LSP client and server lifecycle management
- Session persistence layer (serialization, storage format, restore logic)
- Agent registry, spawn logic, and inter-agent messaging
- Skill loader, registry, and injection system
- Configuration system (API keys, model selection, UI preferences, enabled skills)
- Built-in CLI command handling (`/stash`, `/branch`)
- Chat history manipulation and session branching logic

## Acceptance Criteria

### Phase 0 (Runtime Evaluation)
- [ ] Documented comparison of 2+ runtime candidates against defined criteria
- [ ] Selected runtime with written justification tied to project requirements
- [ ] Verified basic compatibility with the tool adapter strategy, LSP libraries, and terminal UI tools for selected runtime
- [ ] Documented packaging and distribution implications for the chosen runtime

Status:
- Runtime decision document exists and TypeScript/Node.js has been scaffolded as the chosen runtime.

### Phase 1 (Bare-Bones Core)
- [ ] CLI launches with rich terminal UI showing task progress, tool calls, and results
- [ ] API keys configurable via env vars, config file, and CLI flags
- [ ] Agent loop completes simple tasks (e.g., "create a hello.py file") using adapter-managed tool calls
- [ ] Session saves to the platform-appropriate local data directory and restores correctly
- [ ] Graceful error handling for API failures, invalid keys, and tool execution errors
- [ ] User can cancel an in-flight task without corrupting the current session
- [ ] `/stash` stores and retrieves named prompt snippets
- [ ] `/branch` creates a new branched session from a selected previous message without altering the source session

Status:
- A scaffolded implementation exists for all of the above items.
- Verification currently includes local end-to-end runs with the `mock` provider and unit tests around session branching, provider conversion helpers, and structured tool execution.
- Verification currently includes cancellation tests for provider aborts and long-running shell commands.
- Structured transcript rendering is implemented, but not yet as a full-screen interactive TUI.
- Real-provider coverage currently exists for `openai` and `opencode`, but live network verification depends on external credentials.

### Phase 2 (LSP Integration)
- [ ] Successfully connects to or spawns LSP servers for target languages
- [ ] Exposes at least 3 LSP capabilities as agent-callable tools
- [ ] Agent uses LSP tools to validate code changes during task execution
- [ ] LSP results stay consistent with harness-managed in-session file edits

Status:
- Initial TypeScript/JavaScript LSP support is scaffolded via `typescript-language-server` over stdio.
- Four agent-callable LSP tools are implemented: diagnostics, definitions, references, and completions.
- Graceful unavailable-server behavior is implemented.
- Unsaved in-memory document synchronization is not implemented yet; requests currently read the latest on-disk file contents.

### Phase 3 (Agent System)
- [ ] Spawns sub-agents with isolated contexts and independent session persistence
- [ ] Inter-agent messaging works for task delegation and result passing
- [ ] Team shutdown and cleanup functions correctly without orphaned processes
- [ ] Multi-agent team state saves and restores across CLI sessions
- [ ] Sub-agent outputs only affect parent sessions through explicit returned results or messages

Status:
- A first `spawn_agent` delegation path is implemented for top-level sessions.
- Child agents run in isolated saved sessions and return results to the parent only through structured tool output.
- Agent registry, team lifecycle management, and multi-agent restore are not implemented yet.

### Phase 4 (Skill System)
- [ ] Loads skills from `~/.config/opencode/harness/skills/` and project-level `.opencode/skills/`
- [ ] Injects skill context into agent prompts when skills are enabled
- [ ] Bundled starter skills execute correctly when invoked
- [ ] Custom skills can be added by placing files in the skills directory without core changes

## Verification Strategy
- Phase 1: smoke tests for config loading, one end-to-end tool call task, session save/restore, slash commands, and cancellation.
- Phase 2: integration tests against one real LSP server for at least one primary language.
- Phase 2 current coverage: unit tests for LSP tool contracts and unavailable-server behavior; live server integration coverage is still pending.
- Phase 3 current coverage: unit tests for isolated sub-agent session persistence and structured delegation results.
- Phase 3: broader integration tests still needed for spawn, messaging, shutdown, and restore.
- Phase 4: fixture-based tests for skill discovery, loading, enable/disable behavior, and prompt injection.

## Out of Scope / Open Questions
- **RTK Plugin**: Identify the exact RTK package or repository before implementation. Until then, keep the tool adapter independent so this is not a blocker.
- **Session Storage**: Default to local JSON files; evaluate SQLite if session size grows beyond 10MB
- **LSP Scope**: Initial release targets diagnostics, completions, and go-to-definition; full LSP feature set out of scope for v0.2
- **Distribution**: Single-binary vs npm/pip package determined by Phase 0 runtime selection
- **Telemetry**: No telemetry in initial release; opt-in only if added later
- **Multi-user Support**: Out of scope for v1.0; single-user local execution only
- **Security Model**: Confirm whether the harness should support user-confirmation policies for dangerous tools such as shell execution or file writes outside the workspace
