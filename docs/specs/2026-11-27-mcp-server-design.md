# Starboard MCP server — design

Date: 2026-11-27
Status: approved for implementation
Issue: [#18](https://github.com/c65llc/starboard/issues/18)

## Intent

Skills tell a coding agent *when* to use Starboard. Today the agent then
greps `screens.yaml` and every flow file, and edits them as text. An MCP
server gives it typed operations over the same core the CLI and the PWA use:
query screens and flows, follow references, read a wireframe, and make an
edit that is formatted on the way in and linted on the way out.

## Shape

`starboard [--dir D] mcp [--read-only]` runs an MCP server on stdin and
stdout in the same binary. It finds the project root from `--dir` as every
command does, opens it once (an `os.Root`, so no read or write can leave
it), and re-reads the files on every tool call, so edits made outside the
server are always seen. Each call is logged as one line on stderr (tool,
outcome), the only output that is not protocol. It exits 0 when stdin
closes and 2 when there is no project or the streams fail.

The issue's `--root <dir>` is the global `--dir`: one way to name the
project, the same for every command.

## Decisions

### Protocol: hand-rolled JSON-RPC 2.0, no SDK

The official Go SDK (`github.com/modelcontextprotocol/go-sdk`, v1.8.0
published 2026-09-04, old enough for the 3-day rule) was checked. It would
add `golang-jwt/jwt`, `golang.org/x/oauth2`, `segmentio/encoding`,
`google/jsonschema-go`, `yosida95/uritemplate` and `x/time`, and raise
`x/tools` and `x/sys`: HTTP auth and transports this server does not have.
The issue asks for no new runtime dependency, and the subset needed is
small, so `internal/mcp` implements it on `encoding/json`:

- **Transport:** stdio, one JSON-RPC message per line (the MCP stdio
  transport). Requests are answered in order, one at a time.
- **Methods:** `initialize`, `ping`, `tools/list`, `tools/call`.
  Notifications (`notifications/initialized`, `notifications/cancelled`) are
  read and ignored. Anything else is `-32601`.
- **Versions:** `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`.
  A client asking for one of them gets it; any other gets the newest.
  `structuredContent` is sent from `2025-06-18` on.
- **Errors:** malformed JSON `-32700`, a message that is not a request
  `-32600`, an unknown tool or bad `tools/call` params `-32602`. A tool that
  runs and fails (bad arguments, unknown screen, project that does not load)
  returns a result with `isError: true` and a message saying what to fix, as
  MCP asks, so the model sees it.
- **Capabilities:** `tools` only. No resources, prompts or network
  transports (out of scope in the issue).

### Results are the CLI's JSON

Every tool but `starboard_render` returns one JSON document as text content, encoded as the CLI
encodes its `--json` reports (two-space indent, no HTML escaping, trailing
newline), and the same object as `structuredContent`. Every document
carries `"version": 1`. Map keys are sorted and lists ordered, so a result
is deterministic.

- `starboard_lint` is byte for byte `starboard lint --json`: it loads the
  project from disk and runs lint exactly as the command does. `files`
  narrows the findings to those files; the shape stays the same.
- `starboard_rules` is byte for byte `starboard rules --json`; the encoder
  moves from `internal/cli` to `internal/lint` so both use it.
- Screens and flows use core's `Screen` and `Flow`, the shapes the WASM
  bundle and the web app already read.

### Tools

Read tools (annotated `readOnlyHint`):

| Tool | Arguments | Result |
| --- | --- | --- |
| `starboard_screen_get` | `id` | `screen` (core `Screen`: layout, overrides, status and files per platform, edges) and `flows` (`id`, `file`, `title` of each flow naming it) |
| `starboard_flow_get` | `id` (file stem) | `flow` (core `Flow`: front matter, steps) and `screens`, each screen it names with `title`, `area` and `registered` |
| `starboard_query` | `kind` (`screens`, `flows`, default both), `area`, `platform`, `status`, `presentation` | matching `screens` and `flows`, as summaries |
| `starboard_refs` | `target`: `screen.id`, `@screen.id` or `@screen.id#region` | `references`: every flow reference (`file`, `line`, `flow`, `inDiagram`) and, for a screen, every navigation `to` (`file`, `line`, `screen`, `path`) |
| `starboard_lint` | `files` (optional) | `starboard lint --json` |
| `starboard_render` | `screen`, `formFactor`, `region`, `format` | the wireframe SVG |
| `starboard_rules` | none | `starboard rules --json` |

Write tools, absent with `--read-only` (annotated `destructiveHint`):

| Tool | Arguments |
| --- | --- |
| `starboard_screen_set` | `id`, `fields` (object), `delete` (bool) |
| `starboard_flow_set` | `id`, `frontMatter` (object), `body` (string) |
| `starboard_generate` | `check` (bool) |

### Edits reuse core.Edit, so a write is fmt's output

The set tools translate their arguments into `core.EditOp`s and run
`core.Edit` over the project's sources (`project.Project.Sources`:
`starboard.yaml`, `screens.yaml` and the flow files):

- `starboard_screen_set` on a missing screen is `addScreen` with `fields`;
  on an existing one, one `set` per key of `fields`, in sorted key order. A
  key may be dotted (`status.web`, `layouts.web-wide`); a `null` value
  removes the key. A top-level value replaces that key's whole value, so
  `layout` is written as a whole tree. `delete: true` is `removeScreen`.
  Untouched keys keep their comments, as in the web editor.
- `starboard_flow_set` on a missing flow is `addFlow` with `frontMatter`
  (needs a `title`), then `writeFlowBody` when `body` is given; on an
  existing flow, one `setFlowMeta` per key and `writeFlowBody`.

`core.Edit` encodes the touched file and runs it through
`format.Screens` or `format.Flow`, the functions `starboard fmt` runs, so
the bytes written are what `fmt` would produce: `fmt --check` is clean
afterwards (a test holds this). Then the file is written atomically, the
project is reloaded from disk, and the result is `written` (the paths) and
`lint`, the whole project's `lint --json` report. Whole, not just the
touched records: removing or renaming a screen breaks references in other
files, and the agent should see those. A write that introduces lint errors
still lands, as with the CLI; an edit that cannot be applied (unknown
screen, bad key, malformed value) writes nothing and is an error result.

`starboard_generate` is `starboard generate`: it refuses a project with
load errors, and returns `written` and `removed`; `check: true` changes
nothing and lists what it would do.

### Render returns SVG as text

`render.Wireframe` produces SVG, and no rasteriser is added. The default
result is the SVG as text content: models read SVG markup well, and the
main clients pass image content to models that accept only PNG, JPEG, GIF
and WebP, where an `image/svg+xml` image would be refused. `format:
"image"` returns it as image content (`image/svg+xml`, base64) for clients
that display SVG.

### Client configuration: `starboard skills mcp <agent>`

`mcp` must run bare, and a command group only runs through a subcommand,
so `starboard mcp config` would need nested groups. `skills hooks` takes
one argument. So the snippet is a sibling of `hooks`:
`starboard skills mcp [--read-only] <agent>` prints the configuration and
writes, on stderr, one line saying where it goes; it never edits a file.

| Agent | Output | File |
| --- | --- | --- |
| `claude-code` | `mcpServers` JSON, `type: stdio` | `.mcp.json` |
| `cursor` | `mcpServers` JSON, `--dir ${workspaceFolder}` | `.cursor/mcp.json` |
| `copilot` | VS Code `servers` JSON, `--dir ${workspaceFolder}` | `.vscode/mcp.json` |
| `gemini` | `mcpServers` JSON | `.gemini/settings.json` |
| `codex` | `[mcp_servers.starboard]` TOML | `~/.codex/config.toml` |
| `aider` | none: a usage error, as Aider has no MCP client | |

## Skills

The `starboard` skill gains a workflow step: when the `starboard_*` MCP
tools are available, prefer them to reading and editing files by hand
(they format on write and return lint); otherwise use the CLI as before.
`starboard-propose` and `starboard-implement` mention `starboard_screen_set`
and `starboard_flow_set` where they edit, and `starboard_generate` and
`starboard_lint` where they check.

## Testing

- `internal/mcp` unit tests over `project.MemFS`: the protocol (every
  error code, version negotiation, notifications), each tool's success and
  error paths, `--read-only`, and byte identity of writes with `fmt`.
- `cmd/starboard/testdata/script/mcp.txtar`: a protocol round trip that
  calls every tool against a copy of `examples/travel-app`.
- `internal/cli` tests: `starboard_lint` and `starboard_rules` text equals
  `lint --json` and `rules --json`; `skills mcp` per agent.
- `docs/reference/mcp.md` and `cli.md` are held by the existing docs and
  reference tests.

## Not done

- Resources, prompts, HTTP or SSE transports (out of scope in the issue).
- PNG output (would need a rasteriser dependency).
- A dry run for the set tools: the client approves each call, and a write
  is one file that git can revert.
