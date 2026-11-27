---
title: MCP server
description: The tools starboard mcp serves to coding agents over the Model Context Protocol, their arguments and results, and how to configure each agent.
---

`starboard mcp` serves your project to a coding agent over the
[Model Context Protocol](https://modelcontextprotocol.io) (MCP). Instead of
grepping `screens.yaml` and every flow file, the agent calls typed tools: it
asks which flows reach a screen, reads a wireframe, and makes an edit that
is formatted on the way in and linted on the way out.

The server is the same binary as the CLI, with no other dependency. It
speaks MCP's stdio transport: the agent's MCP client starts it and sends
JSON-RPC messages, one per line, on stdin; the answers come back on stdout.

## Configure your agent

`starboard skills mcp` prints the configuration for each agent, and edits
nothing:

<!-- verified: empty -->
```bash
starboard skills mcp claude-code
```

<!-- output -->
```json
{
  "mcpServers": {
    "starboard": {
      "type": "stdio",
      "command": "starboard",
      "args": [
        "mcp"
      ]
    }
  }
}
```

| Agent | Put the output in |
| --- | --- |
| `claude-code` | `.mcp.json` at the project root, shared with everyone who clones it |
| `cursor` | `.cursor/mcp.json` |
| `copilot` | `.vscode/mcp.json`, which VS Code's agent mode reads |
| `gemini` | `.gemini/settings.json` |
| `codex` | `~/.codex/config.toml` (TOML, not JSON) |

Merge the `starboard` entry into the file if it already configures other
servers. Aider has no MCP client; use the skills and hooks instead (see
[Working with coding agents](../../guides/agents/)).

The server works on the project that holds its working directory, as every
command does. Claude Code, Gemini and Codex start it in the folder you
opened. VS Code and Cursor do not promise that, so their configuration
passes `--dir ${workspaceFolder}`. In a monorepo whose project is in a
subdirectory, add `--dir` with that path to the arguments.

To let the agent read but never write, configure the server with
`--read-only`:

<!-- verified: empty -->
```bash
starboard skills mcp --read-only codex
```

<!-- output -->
```text
[mcp_servers.starboard]
command = "starboard"
args = ["mcp", "--read-only"]
```

## How it runs

```text
starboard [--dir D] mcp [--read-only]
```

- **Fresh reads.** Every tool call reads the project from disk, so edits
  made by hand or by other tools while the server runs are always seen.
- **Confined to the project.** The project root is opened once, and no read
  or write can leave it, through a symbolic link or otherwise.
- **One call at a time,** answered in order.
- **Stderr is a log.** One line names the project, then one line per tool
  call: `starboard mcp: starboard_lint: ok`, or the error the agent was
  given. Stdout carries only the protocol.
- **Exit status** 0 when stdin closes; 2 when there is no project or stdout
  fails.

The server implements the methods `initialize`, `ping`, `tools/list` and
`tools/call`, for protocol versions `2025-11-25`, `2025-06-18`,
`2025-03-26` and `2024-11-05`. It offers tools only: no resources, prompts
or network transport.

## Results

Every tool except `starboard_render` returns one JSON document, as text
content and, from protocol version `2025-06-18`, as `structuredContent`
too. The text is encoded as the CLI encodes its `--json` reports: two-space
indent, a trailing newline, keys in a fixed order. Each document carries
`"version": 1`; a change that breaks a reader will bump it. Running a tool
twice on the same files gives the same bytes.

`starboard_lint` and `starboard_rules` return exactly what
`starboard lint --json` and `starboard rules --json` print (see
[JSON output and rules](../json-output/)). Screens and flows have the shapes
the web app reads.

A tool that cannot do what it was asked (an unknown screen, a misspelt
argument, a project whose `starboard.yaml` does not parse) returns a result
marked `isError`, whose text says what to fix. An unknown tool name is a
protocol error, `-32602`.

## Read tools

### `starboard_screen_get`

| Argument | |
| --- | --- |
| `id` | The screen ID, such as `trip.timeline`. Required. |

Returns `screen`, the registered screen, and `flows`, each flow that names
it (`id`, `file`, `title`). The screen has `id`, `title`, `area`,
`purpose`, `presentation`, `status` and `files` per platform, `platforms`
and `formFactors` it is on, `layout` (the region tree, each region with its
`path` in `screens.yaml`, such as `layout[1].item`), `layouts` (the
per-form-factor overrides), `edges` (its navigation) and `line`.

### `starboard_flow_get`

| Argument | |
| --- | --- |
| `id` | The flow ID: its file's name without `.md`, such as `add-activity`. Required. |

Returns `flow`, with its front matter (`title`, `status`, `entry`,
`actors`, `platforms`), `steps` (each with `number`, `text`, the `screen`
and `region` of its first reference, `branches` and `line`) and `screens`
(every screen it names); and `screens`, each named screen with its
`title`, `area` and whether it is `registered`.

### `starboard_query`

| Argument | |
| --- | --- |
| `kind` | `screens` or `flows`. Default: both. |
| `area` | A configured area. A flow matches when it names a screen in it. |
| `platform` | A configured platform. A flow with no `platforms` applies to all of them. |
| `status` | `shipped` or `proposed`. For a screen, its status on `platform` when one is given, else on any platform. |
| `presentation` | A screen presentation, such as `sheet`. Flows have none, so this leaves only screens. |

Returns `screens` (each with `id`, `title`, `area`, `presentation`,
`platforms` and `status`) and `flows` (each with `id`, `file`, `title`,
`status`, `entry` and `platforms`) that match every filter given, in
registry and file order. With no filters it lists everything.

### `starboard_refs`

| Argument | |
| --- | --- |
| `target` | A screen, `trip.info` or `@trip.info`, or a region, `@trip.info#people`. Required. |

Returns `screen`, `region`, whether the screen is `registered`, and
`references`, sorted by file and line. Each reference has a `kind`:

- `entry`: a flow whose `entry` is the screen;
- `flow`: an `@` reference in a flow's text, with its `line` and `region`;
- `diagram`: one inside the flow's Mermaid diagram;
- `navigation`: a region's or nav item's `to` in `screens.yaml` that leads
  to the screen, with the `screen` holding it, the `region` and its `path`.
  Every layout override is searched. Navigation targets a screen, so a
  region target has none.

```json
{
  "version": 1,
  "screen": "trip.info",
  "region": "",
  "registered": true,
  "references": [
    {
      "kind": "entry",
      "file": "docs/flows/flows/invite-a-traveller.md",
      "flow": "invite-a-traveller"
    },
    {
      "kind": "navigation",
      "file": "docs/flows/screens.yaml",
      "line": 227,
      "screen": "trip.timeline",
      "region": "info",
      "path": "layout[0].children[1]"
    }
  ]
}
```

### `starboard_lint`

| Argument | |
| --- | --- |
| `files` | Only report findings in these project-relative files, such as `docs/flows/screens.yaml`. Default: all. |

Returns `starboard lint --json`'s report:
`{"version":1,"errors":[…],"warnings":[…]}`. Act on each finding's `rule`,
not its wording.

### `starboard_render`

| Argument | |
| --- | --- |
| `screen` | The screen ID. Required. |
| `formFactor` | The form factor to draw, such as `phone` or `web-wide`. Default: the screen's first. |
| `region` | A region to outline, as the web app outlines the selected one. |
| `format` | `text` (default) or `image`. |

Returns the screen's wireframe SVG, the bytes `starboard render` prints.
By default it is text content, which a model reads as SVG markup. With
`format: image` it is image content of type `image/svg+xml`, for clients
that display SVG; many pass images only as PNG, JPEG, GIF or WebP, and
refuse SVG. Starboard has no PNG renderer.

### `starboard_rules`

No arguments. Returns `starboard rules --json`'s report: every rule's ID,
kind, default severity, summary and documentation page.

## Write tools

`--read-only` leaves these out. Each set tool changes one file, writes it
in the canonical form `starboard fmt` gives it (so `starboard fmt --check`
is clean afterwards), and returns:

```json
{
  "version": 1,
  "written": ["docs/flows/screens.yaml"],
  "lint": {"version": 1, "errors": [], "warnings": []}
}
```

`written` lists the files changed (none, when the values were already
there). `lint` is the whole project's `starboard lint --json` report after
the write, not just the edited file's: deleting or renaming a screen breaks
references in other files, and those findings matter. A write that
introduces lint errors still lands, as with the CLI; fix the findings with
further edits. Expect `generated-stale` after a change, until you run
`starboard_generate`.

An edit that cannot be applied (an unknown screen to delete, a key that
runs through a value that is not a mapping, a new flow without a title)
writes nothing and returns an error result.

Comments in `screens.yaml` and in a flow's front matter stay, even on a
value that is replaced; a removed key's comments go with it.

### `starboard_screen_set`

| Argument | |
| --- | --- |
| `id` | The screen ID. A new ID creates the screen. Required. |
| `fields` | The fields to set, as JSON. Not `id`. |
| `delete` | `true` to delete the screen instead. |

Each key of `fields` is set to its value, in key order:

- A key may be dotted, to reach inside a mapping: `status.web`,
  `files.ios`, `layouts.web-wide`. Mappings on the way are created.
- `null` removes the key.
- A value replaces the key's whole value. A `layout` is given as a whole
  tree of regions, written as in `screens.yaml`:

```json
{
  "id": "trip.notes",
  "fields": {
    "title": "Notes",
    "area": "trip",
    "purpose": "Notes the travellers share.",
    "presentation": "push",
    "status": "proposed",
    "layout": [
      {"region": "notes", "kind": "text", "label": "The notes"},
      {"region": "add", "kind": "primary-action", "label": "Add a note"}
    ]
  }
}
```

Keys you do not name keep their values and comments. `delete` cannot be
combined with `fields`; references to the deleted screen are left for lint
to report.

### `starboard_flow_set`

| Argument | |
| --- | --- |
| `id` | The flow ID, the file name without `.md`: lowercase letters, digits and hyphens. A new ID creates `<content>/flows/<id>.md`. Required. |
| `frontMatter` | Front matter keys to set: `title`, `status`, `actors`, `entry`, `platforms`. `null` removes one. Not `id`, which is the file's name. |
| `body` | Everything after the front matter: the goal, the Mermaid diagram and the `## Steps` list. Replaces the whole body. |

A new flow needs a `title`; without a `body` it gets an empty `## Steps`
section. See [Flow files](../flow-files/) for what a flow holds.

### `starboard_generate`

| Argument | |
| --- | --- |
| `check` | `true` to change nothing and list what would change. |

Writes `<content>/generated` as `starboard generate` does, and removes the
pages it no longer generates. Returns `check`, `written` and `removed`, the
project-relative paths. Like the command, it refuses a project that has
load errors, since generating from a partly read project would remove
pages.
