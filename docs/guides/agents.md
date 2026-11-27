---
title: Working with coding agents
description: Install Starboard's agent skills, run fmt and lint after every agent edit with hooks, and keep your own changes to the skills.
---

Starboard ships **agent skills**: short runbooks that teach a coding agent
(Claude Code, Cursor, Copilot, Codex, Gemini or Aider) how to read and edit
your Starboard reference without breaking it. Each release of the
`starboard` binary carries the skills that match its own commands and lint
rules, and `starboard skills install` writes them where each agent looks.

This guide covers what the skills do, how to install them, the hooks that
run `starboard fmt` and `starboard lint` after an agent's edits, how
Starboard avoids overwriting your own changes, and how to update after an
upgrade.

## The skills

| Skill | The agent uses it when |
| --- | --- |
| `starboard` | it reads or edits `starboard.yaml`, the screen registry or a flow file. It keeps every edit formatted, lint-clean and in step with the generated pages. |
| `starboard-propose` | you plan a new or changed screen, region or flow. The change goes into the reference as `proposed` items for review before any platform code is written. |
| `starboard-implement` | you ask it to build proposed items on one platform. It writes the code and marks the items `shipped`, with their file paths, in the same change. |
| `starboard-adopt` | you add Starboard to an existing app. It builds the registry and flows from the code one area at a time, keeping lint passing at every commit. |

`starboard skills list` prints the same list from the binary you have.

## Installing

Run from anywhere inside the project; like every command, it finds the
project root (the directory holding `starboard.yaml`) and writes there.

<!-- verified: examples/travel-app mkdir .claude -->
```bash
starboard skills install                     # every agent the project already uses
starboard skills install --agent claude-code --agent codex
starboard skills install --dry-run           # list what would change; write nothing
```

Without `--agent`, Starboard detects the agents from what is at the project
root, and says which it found:

| Found | Agent | Installed to |
| --- | --- | --- |
| `.claude/` | `claude-code` | `.claude/skills/<name>/SKILL.md`, one per skill |
| `.cursor/` | `cursor` | `.cursor/commands/<name>.md`, one per skill |
| `.github/copilot-instructions.md` or `.github/prompts/` | `copilot` | `.github/prompts/<name>.prompt.md`, one per skill |
| `AGENTS.md` | `codex` | a section of `AGENTS.md` |
| `GEMINI.md` | `gemini` | a section of `GEMINI.md` |
| `CONVENTIONS.md` | `aider` | a section of `CONVENTIONS.md` |

A bare `.github/` does not count for Copilot, since nearly every GitHub
repository has one. If none of these exists, the install stops and asks you
to pass `--agent`.

The skill text is installed as written. Only the front matter changes per
agent: Claude Code keeps `name` and `description`, and Cursor and Copilot
keep `description`, because their file name is the skill's name.

Codex, Gemini and Aider each read one instructions file, so they get one
section holding all four skills. Each skill is a `###` subsection with its
description, and its own headings move three levels down (to at most `######`)
so they nest under it; code blocks are left as they are. The section sits
between these two lines:

```markdown
<!-- starboard:skills:start -->
<!-- starboard:skills:end -->
```

Everything outside those lines is yours and is never touched. A file
without the lines gets the section appended; a missing file is created with
just the section. If the lines are duplicated or unbalanced, the install
stops with an error naming the line, and changes nothing.

Commit the installed files and `.starboard/skills.lock.json` with the rest
of the project, so every clone has the same skills.

### In a monorepo

Detection and installation happen at the Starboard project root, the
directory holding `starboard.yaml`, which may be a subdirectory of the
repository (`app/`, say). Run from the repository root, point at the
project with `--dir`, and name the agents, since the agents' own files are
usually at the repository root rather than in `app/`:

<!-- verified: examples/travel-app in app -->
```bash
starboard --dir app skills install --agent claude-code
```

The skills are then written under `app/` (`app/.claude/skills/…`,
`app/AGENTS.md`). Check that your agent reads instructions from a
subdirectory; most read nested `AGENTS.md` files, but not all. A git hook
runs at the repository's top level, so give it `--dir` too:

<!-- verified: examples/travel-app in app -->
```bash
starboard --dir app fmt --check && starboard --dir app lint
```

The Claude Code hook needs no `--dir`: it finds the project from the edited
file.

## Hooks

The skills tell an agent to run `starboard fmt` then `starboard lint --json`
after each edit. A hook makes that automatic. `starboard skills hooks`
prints the configuration for each; it never edits a file, so you stay in
charge of your settings.

### Claude Code

<!-- verified: examples/travel-app -->
```bash
starboard skills hooks claude-code
```

prints a fragment to merge into `.claude/settings.json` (or
`.claude/settings.local.json`):

<!-- output -->
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "starboard hook claude-code"
          }
        ]
      }
    ]
  }
}
```

After every Edit, Write or MultiEdit, Claude Code runs
`starboard hook claude-code`, which reads the edited path from the hook's
input. The project is the one holding the edited file (else the one
holding the hook's working directory, against which a relative path is
resolved). When the file is part of the reference (`starboard.yaml`, the
registry, a flow file, a vocabulary file, or a page under `generated/`, so
that a hand-edit is caught as `generated-stale`), it runs `starboard fmt` and
then `starboard lint --json`. If either fails, it writes what they reported
to stderr and exits 2, which Claude Code hands back to the agent to fix.
Any other file, a clean result, or a file outside a Starboard project exits
0 silently. Input it cannot decode exits 0 too, with a one-line note on
stderr.

### Git pre-commit

<!-- verified: examples/travel-app -->
```bash
starboard skills hooks pre-commit
```

prints a hook script that refuses a commit whose reference is unformatted
or has lint errors:

<!-- output -->
```text
#!/bin/sh
# Starboard: refuse a commit whose reference is not formatted or not
# lint-clean. "starboard lint --fix" formats the sources and regenerates
# generated/; commit what it changes.
starboard fmt --check && starboard lint
```

Save it as `.git/hooks/pre-commit` and make it executable, or run its last
line from your hook manager (pre-commit, lefthook, husky).

### Other agents

Cursor, Copilot, Codex, Gemini and Aider have no edit hook, so
`starboard skills hooks codex` (or `cursor`, `copilot`, `gemini`, `aider`)
prints a paragraph for the agent's instructions file instead, and says which
file:

```markdown
## Starboard checks

After editing `starboard.yaml`, the screen registry (`screens.yaml`), a
flow file or a vocabulary file, run `starboard fmt` then `starboard lint --json`,
and fix every finding before you finish. Never hand-edit `generated/`;
`starboard lint --fix` rewrites it.
```

Put it outside the `starboard:skills` section, so it survives reinstalls as
your own text.

## Ownership and pending files

Starboard records the SHA-256 of every file it installs in
`.starboard/skills.lock.json`, with `/` paths on every OS:

```json
{
  "version": 1,
  "files": {
    ".claude/skills/starboard/SKILL.md": "3f1c…",
    "AGENTS.md": "9ab0…"
  }
}
```

For a section file the hash covers only the section between the markers,
so editing the rest of `AGENTS.md` never counts as editing the skills.
Hashes ignore CRLF line endings, so a Windows checkout is not an edit.

On each install, every destination is one of:

- **missing, or still exactly what Starboard installed:** written with the
  new text;
- **already identical to the new text:** left alone (and recorded);
- **edited since Starboard installed it, or never installed by Starboard:**
  kept as it is. The new version goes to `.starboard/pending/<path>`
  instead, the command prints `staged <path> as .starboard/pending/<path>`
  and a warning, and it still exits 0.

To resolve a staged file, compare the two and merge:

```bash
diff .claude/skills/starboard/SKILL.md .starboard/pending/.claude/skills/starboard/SKILL.md
```

To take Starboard's version, copy the pending file over yours; the next
install sees the match and owns the file again. To keep yours, leave it;
each install restages the new version without rewriting an identical
pending file. Either way, delete `.starboard/pending/` when you are done.
You may want it in `.gitignore`.

Running the install again with nothing changed writes nothing at all, not
even the lock.

## After upgrading Starboard

A new release can change the skills to match new commands or rules. After
upgrading the binary:

<!-- verified: examples/travel-app mkdir .claude -->
```bash
starboard skills install --dry-run   # see what would change
starboard skills install
```

Files you have not edited are updated in place; files you have edited are
staged under `.starboard/pending/` for you to merge, as above.

A release can also drop or rename a skill. For each agent you install, an
installed file of a skill the release no longer ships is:

- **removed**, when you have not edited it: the install prints
  `removed <path> (no longer shipped)` and drops it from the lock;
- **kept**, when you have: the install prints
  `no longer shipped: <path> (edited; delete it yourself)` on every run until
  you delete the file, after which the lock forgets it.

An emptied directory, such as `.claude/skills/<old-name>/`, is left behind
for you to delete. In `AGENTS.md`, `GEMINI.md` and `CONVENTIONS.md` the
dropped skill simply disappears from the regenerated section. A dry run
reports all of this without doing it.

Commit the updated skills and the lock together.
