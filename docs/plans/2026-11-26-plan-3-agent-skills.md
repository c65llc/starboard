# Starboard Plan 3 — Agent skills and hooks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Starboard's AI agent skills in the binary, installable into any project for Claude Code, Cursor, Copilot, Codex, Gemini and Aider with one command, plus ready-to-use hook snippets, so agents read, propose, implement and check the reference correctly.

**Architecture:**
- The skills are agent-neutral Markdown files in `skills/`, embedded in the binary with `go:embed`, so each release carries the skills that match its rules.
- `starboard skills install` renders them into each agent's native location, following coding-standards' layout and ownership rules (see `scripts/assemble-skills.sh` in `c65llc/coding-standards`).
- `starboard skills hooks <agent>` prints hook configuration.
- A drift test keeps every command and rule ID that a skill mentions real.

**Tech Stack:** Go (Plan 1's module). No new dependencies.

**Spec:** `docs/specs/2026-11-26-starboard-design.md`, section "AI agent skills (ship in v1)".

**Depends on:** Plan 1 merged. Plan 2's `core` isn't needed.

**Delivery:** One PR, released as `v0.2.0`.

## Global Constraints

- Plan 1's Global Constraints still apply.
- **Skill file format:** front matter `name` (kebab-case, matching the filename stem) and `description` (one sentence saying when to use it). The body has sections `When to use`, `Workflow` (numbered) and `Rules`, as coding-standards' skills do.
- **Install locations, the same as coding-standards:**
  - `claude-code`: `.claude/skills/<name>/SKILL.md`, front matter kept
  - `cursor`: `.cursor/commands/<name>.md`, with `description` front matter only
  - `copilot`: `.github/prompts/<name>.prompt.md`, with `description` front matter
  - `codex`: a section in `AGENTS.md`
  - `gemini`: a section in `GEMINI.md`
  - `aider`: a section in `CONVENTIONS.md`
  - Each section sits between `<!-- starboard:skills:start -->` and `<!-- starboard:skills:end -->`. Content outside the markers is never touched.
- **Ownership:**
  - Installed files are recorded with their SHA-256 in `.starboard/skills.lock.json` (`{"version":1,"files":{"<path>":"<sha256>"}}`, sorted).
  - A destination that exists but isn't recorded, or whose hash no longer matches, is **never overwritten**. The new content goes to `.starboard/pending/<path>`, and the command says so.
  - Re-running with nothing changed writes nothing.
- **Skills never tell an agent to:** hand-edit `generated/`, skip `starboard lint`, or mark something `shipped` before code and file paths exist.

## Review Focus

1. **The user edited an installed skill.** The file is staged to `.starboard/pending/`, not overwritten, and the exit status is still 0 with a warning. Covered by `TestInstallStagesEditedFile`.
2. **`AGENTS.md` without markers, or with duplicated or unbalanced markers.** Without markers, a marked section is appended. Duplicated or unbalanced markers produce an error that names the line, and the file isn't modified. Covered by `TestSectionMarkers`.
3. **A skill references a removed command or rule ID** after a refactor. The build fails through `TestSkillsReferenceRealCommandsAndRules`.
4. **Install run outside a Starboard project**, or in a subdirectory. It finds the project root like every other command, and exits 2 if there is none. Covered by testscript `skills_no_project.txtar`.
5. **Windows paths.** Installed paths use `/` in the lock file. A test installs into `t.TempDir()` and compares the lock contents on all three CI operating systems. Covered by `TestLockUsesSlashPaths`.

---

## File Structure

```
skills/starboard.md            # core: read the reference; fmt → lint loop; rule IDs; never edit generated/
skills/starboard-propose.md    # leading loop: describe a change as `proposed` screens/regions/flows
skills/starboard-implement.md  # take a proposed change to shipped on one platform
skills/starboard-adopt.md      # bootstrap a registry for an existing app
skills/embed.go                # //go:embed *.md
internal/skills/install.go     # render + install + lock + staging
internal/skills/hooks.go       # hook snippets per agent
cmd/starboard/main.go          # + `skills install`, `skills list`, `skills hooks`
docs/guides/agents.md          # human guide (published on the site by Plan 4)
```

---

### Task 1: Skill content

**Files:**
- Create: `skills/{starboard,starboard-propose,starboard-implement,starboard-adopt}.md`, `skills/embed.go`
- Test: `skills/skills_test.go`

**Interfaces:**
- Produces: `var FS embed.FS` and `func All() []Skill`, with `Skill{ Name, Description, Body string }` sorted by name.
- **What each skill must say.** Write it as runbook prose, in the coding-standards style.
  - **`starboard`:**
    - Where the reference lives: `starboard.yaml` and the content root.
    - How to read a screen, region and flow.
    - **After every edit to reference files, run `starboard fmt` then `starboard lint --json`, and fix findings by `rule`.**
    - Correctness rules can't be configured away.
    - Never hand-edit `generated/`; use `starboard generate` or `lint --fix`.
    - The map is navigation only, and flows are ordered steps whose first `@screen#region` locates each step.
  - **`starboard-propose`:**
    - Express a change as edits with `status: proposed` on new or changed screens and regions, or per platform.
    - Update or add the flow, with numbered steps that each have a reference.
    - Check with `starboard lint` (which must pass).
    - Summarise the proposal for review.
    - Don't touch platform code.
  - **`starboard-implement`:**
    - For one named platform, find the proposed items.
    - Implement them in that platform's code.
    - Add the file paths under `files.<platform>`.
    - Flip that platform's status to `shipped` in the **same change** as the code.
    - Run `starboard lint` and the platform's own tests.
    - Leave the other platforms `proposed`.
  - **`starboard-adopt`:**
    - Run `starboard init`.
    - Register screens area by area from the platform's screen files, using reverse coverage (`unregistered-screen-file`) as the to-do list.
    - Use `unmapped` with reasons for helpers.
    - Write the layouts from each screen's source.
    - Then write the flows.
    - Commit per area.

- [ ] **Step 1:** Write failing tests:
  - `TestSkillFrontMatter`: every file has a valid `name` equal to its stem and a non-empty `description`.
  - `TestSkillSections`.
  - `TestSkillsReferenceRealCommandsAndRules`: every `starboard <word>` in a skill is a CLI command or subcommand, using the command table exported from `cmd/starboard` as `internal/cli.Commands`. Move it there if needed. Every backticked token that matches a rule-ID shape and appears in a rules context is in `lint.Rules()` or `diag.CorrectnessRules`.
- [ ] **Step 2:** Run `go test ./skills/`. Expected: FAIL.
- [ ] **Step 3:** Write the four skills and `embed.go`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(skills): agent-neutral Starboard skills`.

### Task 2: Installer, hooks and CLI

**Files:**
- Create: `internal/skills/install.go`, `internal/skills/hooks.go`
- Modify: `cmd/starboard/main.go`
- Create: `docs/guides/agents.md`
- Test: `internal/skills/install_test.go`, `internal/skills/hooks_test.go`, `cmd/starboard/testdata/script/{skills_install,skills_rerun,skills_no_project,skills_hooks}.txtar`

**Interfaces:**
- Produces:
  - `type Agent string`, with constants `ClaudeCode = "claude-code"`, `Cursor = "cursor"`, `Copilot = "copilot"`, `Codex = "codex"`, `Gemini = "gemini"`, `Aider = "aider"`
  - `type Result struct{ Written, Unchanged, Staged []string }`
  - `func Install(w project.WriteFS, agents []Agent, skills []skillsfs.Skill, dryRun bool) (Result, error)`
  - `func Hooks(agent Agent) (string, error)`:
    - **claude-code:** a `settings.json` fragment. A `PostToolUse` hook with matcher `Edit|Write|MultiEdit` runs `starboard fmt && starboard lint --json` when the edited path is under the content root, and exits non-zero to surface findings to the agent.
    - **git pre-commit:** shown under the `pre-commit` key; it runs `starboard fmt --check && starboard lint`.
    - **The other agents:** an AGENTS.md paragraph telling the agent to run the same two commands after edits.
- **CLI:**
  - `starboard skills install [--agent a]… [--dry-run]`. The default agents are those detected in the project: `.claude/` gives claude-code, `.cursor/` gives cursor, `.github/` gives copilot, and `AGENTS.md`, `GEMINI.md` or `CONVENTIONS.md` give their agents. If none are detected, it errors with "pass --agent".
  - `starboard skills list`.
  - `starboard skills hooks <agent|pre-commit>`. It prints only and never edits `settings.json`.
- **`docs/guides/agents.md`:** what the skills do, how to install them, the hooks, and an AGENTS.md snippet.

- [ ] **Step 1:** Write failing tests:
  - `TestInstallEachAgent`: goldens for each layout
  - `TestInstallIdempotent`
  - `TestInstallStagesEditedFile`
  - `TestInstallStagesUnrecordedExisting`
  - `TestSectionMarkers`
  - `TestLockUsesSlashPaths`
  - `TestHooksClaudeCodeIsValidJSON`
  - the testscripts
- [ ] **Step 2:** Run `go test ./internal/skills/ ./cmd/...`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `make ci`. Expected: PASS with coverage ≥95%.
- [ ] **Step 5:** Commit `feat(skills): install skills per agent and print hook configuration`, then open the PR. After merge, a human tags `v0.2.0`.
