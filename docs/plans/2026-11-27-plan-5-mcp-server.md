# Starboard Plan 5 — MCP server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `starboard mcp` serves the project to coding agents over MCP on stdio: read tools for screens, flows, references, lint, rules and wireframes, and write tools that format on the way in and lint on the way out.

**Architecture:**
- `internal/mcp`: the JSON-RPC 2.0 stdio loop and the tool table, over a `project.WriteFS`, so tests run on `project.MemFS` and the CLI passes an `osfs.Dir`.
- Reads use `core` (`Model`, `RenderHighlighted`) over the loaded sources; lint and generate run exactly as the CLI runs them; writes go through `core.Edit`.
- `internal/cli`: the `mcp` command and `skills mcp <agent>`.

**Tech Stack:** Go. No new dependencies: the MCP SDK was rejected (see the spec).

**Spec:** `docs/specs/2026-11-27-mcp-server-design.md`.

**Delivery:** One PR closing #18.

## Global Constraints

- Plan 1's Global Constraints still apply: nothing under `internal/` but `osfs` imports `os`, and `core` stays pure.
- Tool results are the CLI's JSON: `starboard_lint` and `starboard_rules` byte for byte, the rest with `"version": 1` and deterministic order.
- A write is byte-identical to `starboard fmt`'s output.
- Every package stays at or above 95% statement coverage (`make cover`).

## Review Focus

1. **A write lands formatted.** After `starboard_screen_set` or `starboard_flow_set`, `starboard fmt --check` changes nothing. Covered by `TestScreenSetMatchesFmt` and `mcp.txtar`.
2. **A write with lint errors still lands** and returns the findings. Covered by `TestScreenSetWritesDespiteLintErrors`.
3. **`--read-only`** hides the write tools from `tools/list` and refuses them in `tools/call`. Covered by `TestReadOnly` and `mcp.txtar`.
4. **Protocol errors** never kill the server: bad JSON, a non-request, an unknown method or tool, each gets its error and the next line is still served. Covered by `TestProtocolErrors`.
5. **Lint equality with the CLI.** Covered by `TestMCPLintMatchesCLI`.

---

## File Structure

```
internal/mcp/protocol.go      # JSON-RPC types, the read-serve loop, initialize and version negotiation
internal/mcp/tools.go         # the tool table: names, schemas, annotations and handlers
internal/mcp/*_test.go
internal/lint/report.go       # WriteRulesJSON, moved from internal/cli so mcp shares it
internal/skills/mcp.go        # MCPConfig(agent, readOnly) and its note
internal/cli/cli.go           # + mcp, + skills mcp
cmd/starboard/testdata/script/mcp.txtar, skills_mcp.txtar
docs/reference/mcp.md, docs/reference/cli.md, docs/guides/agents.md
skills/starboard.md, starboard-propose.md, starboard-implement.md
```

### Task 1: Rules report shared

- [ ] Move `ruleEntry` and the `rules --json` encoder to `lint.WriteRulesJSON(w)`; `runRules` calls it. `TestRules` still passes unchanged.

### Task 2: Protocol

- [ ] Failing tests: `initialize` echoes a supported version and falls back to the newest; `ping`; notifications get no reply; `-32700`, `-32600`, `-32601`, `-32602`; the loop ends cleanly at EOF and reports a read error.
- [ ] Implement `Serve(r io.Reader, w, log io.Writer, fsys project.WriteFS, opts Options) error`.

### Task 3: Read tools

- [ ] Failing tests for each read tool on a `MemFS` project: success, unknown ID, bad arguments (unknown field), a project whose `starboard.yaml` does not parse.
- [ ] Implement `starboard_screen_get`, `starboard_flow_get`, `starboard_query`, `starboard_refs`, `starboard_lint`, `starboard_render`, `starboard_rules`.

### Task 4: Write tools

- [ ] Failing tests: create and update a screen and a flow; dotted keys and `null`; `delete`; the bytes equal `format`'s; lint errors still write; an invalid edit writes nothing; `starboard_generate` with and without `check`, and refusing a broken project; `--read-only`.
- [ ] Implement `starboard_screen_set`, `starboard_flow_set`, `starboard_generate`.

### Task 5: CLI, config snippets and the round trip

- [ ] `mcp [--read-only]` and `skills mcp [--read-only] <agent>` in `cli.Commands`; `internal/skills.MCPConfig`.
- [ ] `mcp.txtar`: every tool against a copy of `examples/travel-app`; `fmt --check` and `lint` after the writes. `skills_mcp.txtar`.
- [ ] `TestMCPLintMatchesCLI`, `TestMCPRulesMatchesCLI`.

### Task 6: Docs and skills

- [ ] `docs/reference/mcp.md`; `cli.md` sections for `mcp` and `skills mcp`; an MCP section in `docs/guides/agents.md`.
- [ ] The skills mention the tools for when the server is configured.
- [ ] `make ci` green; commit `feat(mcp): serve the reference to agents over MCP`; open the PR.
