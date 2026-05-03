# Agentic Harness Specification

## Goal
Build a minimal, extensible CLI agentic harness for software engineering tasks, inspired by opencode/pi/claudecode/codex. Start with a bare-bones core agent loop with tool calling (via RTK plugin), then iteratively add LSP integration, specialized sub-agents, reusable skill modules, rich terminal UI, and session persistence.

## Constraints
- CLI-first interface with rich terminal UI
- Explicit language/runtime evaluation before core implementation, prioritizing compatibility with LSP libraries, RTK plugin, terminal UI frameworks, and LLM SDKs
- Must support LLM-driven tool use with RTK plugin for standardized tool call handling
- Extensible architecture to add agents/skills/LSP without rewriting core
- Local-first execution with configurable LLM provider API keys
- Session save/restore for agent state persistence

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
3. **Deliverable**: Documented evaluation with selected runtime and compatibility verification for RTK, LSP, and UI libraries.

### Phase 1: Bare-Bones Core (v0.1)
Implement minimal agentic loop with essential features:
1. CLI entry point with rich terminal UI (progress indicators, color-coded output, structured tool call display)
2. LLM client with provider adapter pattern (Anthropic Claude, OpenAI GPT, etc.)
3. API key configuration system (env vars, `~/.config/opencode/harness/config.json`, CLI flags)
4. Core tool set via RTK plugin: `read`, `write`, `edit`, `bash`, `glob`, `grep`
5. Agent loop: send prompt + tool defs → parse tool calls via RTK → execute tools → return results → repeat until task completion
6. Basic session save/restore (serialize conversation history, agent state, and tool call history to local JSON files)

### Phase 2: LSP Integration (v0.2)
Add Language Server Protocol support for code intelligence:
1. LSP client implementation using runtime-selected LSP library
2. Optional automatic LSP server spawning (e.g., `typescript-language-server` for TS/JS, `pyright` for Python)
3. Expose LSP capabilities as agent-callable tools (diagnostics, go-to-definition, completions, references)
4. Enhance agent's ability to understand and modify code correctly

### Phase 3: Agent System (v0.3)
Add specialized sub-agents with team management:
1. Agent registry for predefined types (explorer, code-reviewer, worker, general)
2. Sub-agent spawn mechanism with isolated context and session persistence
3. Inter-agent communication (message passing, task delegation, result return)
4. Team lifecycle management (spawn, status check, graceful shutdown, force shutdown, cleanup)
5. Full session save/restore for multi-agent teams

### Phase 4: Skill System (v0.4)
Add reusable, injectable skill modules:
1. Skill definition format: Markdown instruction file + optional scripts/resources in a directory
2. Skill loader to inject skill context into agent prompts at runtime
3. Skill registry for discovery, enabling/disabling, and dependency management
4. Bundled starter skills (brainstorming, mermaid-validation, code-review, context-vault)
5. Support for user-defined custom skills without core code changes

## Affected Areas
- Runtime evaluation and selection documentation
- CLI entry point and argument parsing
- Rich terminal UI implementation (framework-dependent)
- LLM client with provider adapters and API key management
- RTK plugin integration layer for tool call standardization
- Tool execution engine (file ops, shell, search, LSP)
- LSP client and server lifecycle management
- Session persistence layer (serialization, storage format, restore logic)
- Agent registry, spawn logic, and inter-agent messaging
- Skill loader, registry, and injection system
- Configuration system (API keys, model selection, UI preferences, enabled skills)

## Acceptance Criteria

### Phase 0 (Runtime Evaluation)
- [ ] Documented comparison of 2+ runtime candidates against defined criteria
- [ ] Selected runtime with written justification tied to project requirements
- [ ] Verified basic compatibility with RTK plugin, LSP libraries, and terminal UI tools for selected runtime

### Phase 1 (Bare-Bones Core)
- [ ] CLI launches with rich terminal UI showing task progress, tool calls, and results
- [ ] API keys configurable via env vars, config file, and CLI flags
- [ ] Agent loop completes simple tasks (e.g., "create a hello.py file") using RTK-managed tool calls
- [ ] Session saves to `~/.local/share/opencode-harness/sessions/` and restores correctly
- [ ] Graceful error handling for API failures, invalid keys, and tool execution errors

### Phase 2 (LSP Integration)
- [ ] Successfully connects to or spawns LSP servers for target languages
- [ ] Exposes at least 3 LSP capabilities as agent-callable tools
- [ ] Agent uses LSP tools to validate code changes during task execution

### Phase 3 (Agent System)
- [ ] Spawns sub-agents with isolated contexts and independent session persistence
- [ ] Inter-agent messaging works for task delegation and result passing
- [ ] Team shutdown and cleanup functions correctly without orphaned processes
- [ ] Multi-agent team state saves and restores across CLI sessions

### Phase 4 (Skill System)
- [ ] Loads skills from `~/.config/opencode/harness/skills/` and project-level `.opencode/skills/`
- [ ] Injects skill context into agent prompts when skills are enabled
- [ ] Bundled starter skills execute correctly when invoked
- [ ] Custom skills can be added by placing files in the skills directory without core changes

## Out of Scope / Open Questions
- **RTK Plugin**: Awaiting clarification on specific RTK plugin name/link to confirm runtime compatibility and integration steps
- **Session Storage**: Default to local JSON files; evaluate SQLite if session size grows beyond 10MB
- **LSP Scope**: Initial release targets diagnostics, completions, and go-to-definition; full LSP feature set out of scope for v0.2
- **Distribution**: Single-binary vs npm/pip package determined by Phase 0 runtime selection
- **Telemetry**: No telemetry in initial release; opt-in only if added later
- **Multi-user Support**: Out of scope for v1.0; single-user local execution only
