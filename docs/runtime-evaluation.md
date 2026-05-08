# Runtime Evaluation

## Decision
Selected runtime: TypeScript / Node.js.

## Why
- Strongest fit for an interactive CLI with incremental provider integration.
- Mature LSP client ecosystem through `vscode-languageserver-node`.
- Clean path to tool-calling model providers over standard HTTP APIs.
- Fastest route from empty repo to a working local harness.

## Compatibility Summary
- Tool adapter strategy: native fit. The core loop can treat RTK as an optional adapter implementation later.
- Terminal UI: adequate baseline with ANSI output now, with room to adopt `ink` or `blessed` later.
- LSP: strong ecosystem and straightforward child-process management.
- Packaging: simple developer workflow through npm; standalone packaging can be evaluated later.

## Deferred Risks
- Node runtime dependency increases installation surface area.
- Real provider adapter work remains ahead; current implementation uses a mock provider to validate core boundaries.
