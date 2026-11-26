# Starboard Plan 1 — Core and CLI to v0.1.0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `starboard` v0.1.0: a single Go binary that formats, lints, renders and generates a project's screen registry and flows, installable from GitHub Releases and through a GitHub Action.

**Architecture:**
- Pure Go packages under `internal/` do all the work against an `fs.FS` (read) and a small `WriteFS` (write). They never call `os` directly, so Plan 2 can compile the same code to WebAssembly.
- `cmd/starboard` is the only package that touches the disk, through `internal/osfs`.
- Findings are `diag.Diagnostic` values with stable rule IDs. Text and JSON reporters render them.

**Tech Stack:**
- Go 1.27.4
- `go.yaml.in/yaml/v3` v3.0.6, for its node API with comments
- `github.com/bmatcuk/doublestar/v4` v4.10.7
- Tests only: `github.com/stretchr/testify` v1.12.1, `github.com/rogpeppe/go-internal/testscript` v1.16.0, `github.com/santhosh-tekuri/jsonschema/v6` v6.0.3
- golangci-lint v2.15.0 and GoReleaser v2.20.3

**Spec:** `docs/specs/2026-11-26-starboard-design.md`. Read it first. This plan implements its Concepts, Project files, `starboard.yaml`, registry, Format rules, Flows, Formatter, Linter, Checks, CLI, Wireframe renderer, Generated pages, GitHub Action and Releases sections. The WebAssembly build, PWA, agent skills, examples and website are Plans 2–4.

**Delivery:** Three PRs into `main`, each green in CI before the next starts:

- **PR 1:** Tasks 0–8
- **PR 2:** Tasks 9–11
- **PR 3:** Task 12, then tag `v0.1.0`

## Global Constraints

- **Module and license:** module path `github.com/c65llc/starboard`. License `AGPL-3.0-only`. Every `.go` file starts with `// SPDX-License-Identifier: AGPL-3.0-only` then `// Copyright 2026 C65 LLC`.
- **Go:** `go 1.27` and `toolchain go1.27.4` in `go.mod`.
- **Dependency age:** a new or upgraded dependency must be at least 3 days old. Check with `curl -s https://proxy.golang.org/<module>/@v/<version>.info`.
- **Runtime dependencies** are exactly the YAML library and doublestar. Everything else is test-only.
- **coding-standards Go standard (lang-12):**
  - `gofmt`/`goimports` and `go vet`
  - `golangci-lint` v2, with zero issues
  - `go test -race ./...`
  - **95% coverage minimum for every package**
  - Conventional Commits
- **Output:**
  - Generated and formatted output uses LF line endings with a final newline.
  - Paths are always written and compared with `/`.
  - Output is byte-stable: no timestamps and no map-order iteration. Sort everything that is emitted.
- **No `os` calls in `internal/`** except `internal/osfs`. A test (`TestNoOSImports` in `internal/archtest`) enforces it.
- **Layout and file names:** content root defaults to `docs/flows`. File names are `starboard.yaml`, `screens.yaml`, `flows/<id>.md` and `generated/`.
- **Exit codes:**
  - `0`: clean
  - `1`: findings at error severity, or warnings under `--strict`, or `fmt --check` / `generate --check` would change files
  - `2`: usage error, or no project found

## Review Focus

These five failure modes aren't covered by the spec's happy paths. Each has an owning test:

1. **CRLF files.** A `screens.yaml` or flow saved by a Windows editor parses with the same diagnostics as its LF twin, and `fmt` rewrites it to LF. Covered by `TestParseCRLF` (Task 2) and `TestFormatCRLF` (Task 7).
2. **YAML anchors, aliases and merge keys.** These are rejected with rule `yaml-alias-not-allowed`, never expanded, so an alias bomb can't hang the CLI or the PWA. Covered by `TestRejectAliases` (Task 2).
3. **Paths that escape the project.** A `files`, `screenshots`, `roots` or vocabulary `file` value that is absolute, contains `..`, or uses `\` produces rule `path-invalid` and is never opened. `osfs.WriteFile` refuses any name outside its root. Covered by `TestPathInvalid` (Task 6) and `TestWriteFileRefusesEscape` (Task 4).
4. **Comments and odd formatting survive `fmt`.** Head, line and foot comments, unicode labels, and an already-formatted file are all preserved. Formatting twice equals formatting once. Covered by `TestFormatPreservesComments`, `TestFormatUnicodeWidth` and `FuzzFormatIdempotent` (Task 7).
5. **Missing or empty project.** If there's no `starboard.yaml` in the directory or its parents, exit 2 with "no starboard.yaml found; run `starboard init`". An empty `screens.yaml`, or no `flows/` directory, lints cleanly except for config-driven rules. Covered by `testdata/script/no_project.txtar` and `empty_project.txtar` (Task 8).

---

## File Structure

```
go.mod, go.sum, Makefile, .golangci.yml, .gitattributes
.github/workflows/ci.yml            # matrix test (ubuntu, macos, windows) + lint job (ubuntu)
.github/workflows/release.yml       # Task 12
.goreleaser.yaml, action.yml        # Task 12
scripts/check-spdx.sh
cmd/starboard/main.go               # flag parsing, subcommand dispatch, exit codes
cmd/starboard/main_test.go          # testscript runner
cmd/starboard/testdata/script/*.txtar
internal/archtest/archtest_test.go  # TestNoOSImports
internal/diag/diag.go               # Diagnostic, Severity, sorting, text + JSON reporters
internal/config/config.go           # starboard.yaml model, defaults, Load
internal/registry/registry.go       # screens.yaml model
internal/registry/parse.go          # yaml.Node → model with line numbers + schema diagnostics
internal/registry/walk.go           # Walk, Edges, LayoutFor
internal/flows/flows.go             # Flow, Ref, Step; Parse
internal/project/project.go         # Project; Load(fs.FS, root)
internal/osfs/osfs.go               # Dir: fs.FS + WriteFS with root confinement; FindRoot
internal/selector/selector.go       # ".a[].b" selector for vocabularies
internal/lint/lint.go               # Rule registry, Run, Options, Result
internal/lint/rules_*.go            # one file per rule group
internal/format/yaml.go             # FormatConfig, FormatScreens
internal/format/flow.go             # FormatFlow
internal/render/render.go           # Wireframe SVG
internal/generate/generate.go       # All → map[path][]byte
internal/scaffold/scaffold.go       # Init
internal/schema/schema.go           # embedded JSON Schemas
internal/schema/config.schema.json, screens.schema.json
internal/testdata/projects/<name>/  # fixture projects shared by package tests
```

## Rule IDs

Every rule ID is fixed here. Tests and docs use these exact strings.

**Correctness rules** are always `error` and cannot be configured:

`config-invalid`, `yaml-syntax`, `yaml-alias-not-allowed`, `schema-invalid`, `id-invalid`, `duplicate-screen`, `duplicate-region`, `unknown-kind`, `unknown-presentation`, `unknown-platform`, `unknown-form-factor`, `unknown-area`, `platform-note-missing`, `edge-unresolved`, `edge-platform-mismatch`, `path-invalid`, `file-missing`, `screenshot-missing`, `unregistered-screen-file`, `unmapped-and-claimed`, `ref-unresolved`, `flow-frontmatter-invalid`, `flow-id-mismatch`, `status-conflict`, `shipped-flow-proposed-ref`, `vocabulary-source-invalid`, `vocabulary-unknown`, `not-formatted`, `generated-stale`.

**Quality rules** have configurable severity. The defaults:

| Rule | Default |
|---|---|
| `unreachable-screen` | warn |
| `orphan-screen` | warn |
| `missing-purpose` | warn |
| `label-too-long` | warn, limit 40 |
| `flow-ref-not-in-diagram` | warn |
| `duplicate-edge` | warn |
| `deep-nesting` | warn, limit 5 |
| `edge-parity` | warn |
| `step-without-ref` | warn |

---

### Task 0: Repository tooling

**Prerequisite:** the coding-standards PR that adds `standards/agents/go/.golangci.yml` (golangci-lint v2 format) has merged. If it hasn't, stop and report. Don't hand-write a substitute config.

**Files:**
- Create:
  - `go.mod`, `Makefile`, `.gitattributes`, `.golangci.yml`
  - `.github/workflows/ci.yml`, `scripts/check-spdx.sh`
  - `internal/archtest/archtest_test.go`
  - `internal/version/version.go`, with `var Version = "dev"`, set by ldflags in Task 12

- [ ] **Step 1:** Install Go 1.27.4, golangci-lint v2.15.0 and GoReleaser v2.20.3 locally. Verify with `go version`, then `golangci-lint version`, then `goreleaser --version`.
- [ ] **Step 2:** Run coding-standards' installer in the repo, as its README describes (`install.sh`), choosing Go. Keep what it writes: CI-gate, definition-of-done and release-drafter templates, and agent config files. Copy `standards/agents/go/.golangci.yml` to `.golangci.yml`.
- [ ] **Step 3:** Run `go mod init github.com/c65llc/starboard`, then set `go 1.27` and `toolchain go1.27.4`.
- [ ] **Step 4:** Write `.gitattributes` with `* text=auto eol=lf` and `*.svg -text`.
- [ ] **Step 5:** Write `scripts/check-spdx.sh`. It exits 1 and lists every `*.go` file whose first two lines aren't the SPDX and copyright lines.
- [ ] **Step 6:** Write the failing test `TestNoOSImports`. It parses every non-test `.go` file under `internal/` except `internal/osfs` with `go/parser` (imports only) and fails if any imports `os` or `os/exec`. Add a deliberate offending file, run `go test ./internal/archtest/`, and expect FAIL. Delete the file and expect PASS.
- [ ] **Step 7:** Write the `Makefile`. Targets:
  - `test`: `go test -race -coverprofile=coverage.out ./...`
  - `cover`: fails if any package is under 95%, by parsing `go tool cover -func` per package
  - `lint`: `golangci-lint run`
  - `fmt-check`: `gofmt -l` is empty
  - `spdx`
  - `ci`: all of the above
  - `build`: `go build -o bin/starboard ./cmd/starboard`
- [ ] **Step 8:** Write `.github/workflows/ci.yml`:
  - job `test`: matrix `ubuntu-latest`, `macos-latest`, `windows-latest`, running `go test -race ./...`
  - job `lint` on `ubuntu-latest`: `make lint fmt-check spdx cover` and `go mod tidy && git diff --exit-code`
  - every action pinned by full commit SHA with a version comment, as coding-standards' workflows do
- [ ] **Step 9:** Run `make ci`. Expected: PASS.
- [ ] **Step 10:** Commit: `chore: add Go module, lint, CI and SPDX tooling`.

### Task 1: Diagnostics and config

**Files:**
- Create: `internal/diag/diag.go`, `internal/config/config.go`
- Test: `internal/diag/diag_test.go`, `internal/config/config_test.go`

**Interfaces:**

- Produces from `diag`:
  - `type Severity string` with constants `Error = "error"`, `Warn = "warn"`, `Off = "off"`
  - `type Fix struct{ Description string \`json:"description"\` }`
  - `type Diagnostic struct{ Rule string; Severity Severity; File string; Path string; Line int; Message string; Fix *Fix }`, with JSON tags `rule`, `severity`, `file`, `path`, `line,omitempty`, `message`, `fix,omitempty`
  - `func Sort(ds []Diagnostic)`: sorts by File, Line, Rule, Path, Message
  - `func WriteText(w io.Writer, ds []Diagnostic)`: one line each, `file:line: severity rule: message (path)`
  - `func WriteJSON(w io.Writer, ds []Diagnostic) error`: writes `{"version":1,"errors":[…],"warnings":[…]}`, two-space indent, with errors and warnings split by severity
- Produces from `config`:
  - `type FormFactor struct{ Width, Height int }`
  - `type Platform struct{ FormFactors, Roots, ScreenFiles []string }`
  - `type Vocabulary struct{ File, Select string }`
  - `type Config struct{ Version int; Content string; Platforms map[string]Platform; PlatformOrder []string; FormFactors map[string]FormFactor; Vocabularies map[string]Vocabulary; Areas []string; Rules map[string]diag.Severity; Limits map[string]int }`
  - `var DefaultFormFactors = map[string]FormFactor{"phone":{390,844},"tablet":{820,1180},"desktop":{1280,800},"web-narrow":{390,844},"web-wide":{1440,900}}`
  - `func Parse(data []byte) (*Config, []diag.Diagnostic)`. It sets `Content` to `"docs/flows"` when absent and merges project form factors over the defaults. `PlatformOrder` is the key order as written. `Rules` and `Limits` come from `lint: { rules: {id: severity}, limits: {label-too-long: 40, deep-nesting: 5} }`.

- [ ] **Step 1:** Write failing tests:
  - `TestParseMinimal`: `version: 1` plus one platform gives `Content == "docs/flows"`, and `FormFactors["phone"] == {390,844}`.
  - `TestParseOverridesFormFactor`.
  - `TestParseUnknownVersion`: `version: 2` gives one `config-invalid`.
  - `TestParseUnknownFormFactorOnPlatform`: gives `unknown-form-factor`, with `Path == "platforms.ios.formFactors[0]"`.
  - `TestRulesSeverity`: `lint.rules.orphan-screen: off` gives `Rules["orphan-screen"] == diag.Off`.
  - `TestRulesRejectCorrectness`: setting `file-missing: off` gives `config-invalid` with the message "file-missing is a correctness rule and cannot be configured".
  - `TestWriteJSONShape`: golden JSON.
  - `TestSortStable`.
- [ ] **Step 2:** Run `go test ./internal/diag/ ./internal/config/`. Expected: FAIL, undefined.
- [ ] **Step 3:** Implement both packages. `config` decodes into a `yaml.Node` first so diagnostics carry line numbers. The list of correctness rule IDs lives in `diag` as `var CorrectnessRules = map[string]bool{…}`, holding the exact set from "Rule IDs".
- [ ] **Step 4:** Run the tests. Expected: PASS with coverage ≥95%.
- [ ] **Step 5:** Commit: `feat(config): parse starboard.yaml with defaults and diagnostics`.

### Task 2: Registry parsing

**Files:**
- Create: `internal/registry/registry.go`, `parse.go`, `walk.go`
- Test: `internal/registry/parse_test.go`, `walk_test.go`, `testdata/*.yaml`

**Interfaces:**
- Consumes: `diag.Diagnostic`.
- Produces:
  - `type Status struct{ All string; Per map[string]string }` and `func (s Status) For(platform string) string`. `For` returns `Per[platform]`, else `All`, else `"shipped"`.
  - `type NavItem struct{ Label, To, Requires, Status string; Line int }`
  - `type Empty struct{ Label string }`
  - `type Width struct{ Px, Num, Den int }`. It is the zero value when unset. `"1/3"` gives Num 1, Den 3.
  - `type Region struct{ Name, Kind, Label, To, Requires, Status, PlatformNote string; Width Width; Children []*Region; Item *Region; Empty *Empty; Items []NavItem; Line int }`
  - `type Screen struct{ ID, Title, Area, Purpose, Presentation, PlatformNote string; Status Status; Platforms []string; States []string; Files map[string][]string; Screenshots map[string]string; Layout []*Region; Layouts map[string][]*Region; Line int }`
  - `type Unmapped struct{ Path, Reason string; Line int }`
  - `type Registry struct{ Screens map[string]*Screen; Order []string; Unmapped []Unmapped }`. `Order` is the IDs in file order.
  - `func Parse(data []byte) (*Registry, []diag.Diagnostic)`
  - `func (s *Screen) LayoutFor(formFactor string) []*Region`. It returns `Layouts[formFactor]` if present, else `Layout`.
  - `func Walk(regions []*Region, fn func(r *Region, path string))`. It is depth-first and visits `Children`, then `Item`. `path` looks like `layout[2].children[0]`.
  - `type Edge struct{ From, To, Region, Path string; Line int }`
  - `func Edges(s *Screen, formFactor string) []Edge`. It covers every `to` in the layout for `formFactor`, including `Item` and `Items`, sorted by To, then Path.
  - `var Kinds`, `var Containers`, `var Presentations`: the exact sets from the spec's Format rules. Containers are `column`, `row`, `section` and `bar`. Nav kinds are `tabs`, `nav` and `menu`.
  - `var IDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`)`
  - `var RegionPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)`

Parse emits these schema rules: `yaml-syntax`, `yaml-alias-not-allowed`, `schema-invalid` (an unknown key, a wrong type, `children` on a non-container, `item` or `empty` on a non-list, `items` on a non-nav kind, a bad `width`), `id-invalid`, `duplicate-screen`, `duplicate-region` (unique per layout tree, including `Item` subtrees), `unknown-kind` and `unknown-presentation`. Every diagnostic has `File: "screens.yaml"`. Project load rewrites it to the content-relative path.

- [ ] **Step 1:** Write failing tests:
  - `TestParseTimeline`: the spec's `trip.timeline` example, with the `items` placeholder filled in, parses. It has 5 top-level regions. `Edges(s,"phone")` gives targets `[activity.detail activity.editor trip.checklist trip.info trip.timeline]`.
  - `TestStatusPerPlatform`: `status: {ios: shipped, android: proposed}` gives `For("android") == "proposed"` and `For("web") == "shipped"`.
  - `TestWidthForms`: `240` gives `Px` 240. `"1/3"` gives 1/3. `"abc"` gives `schema-invalid`.
  - `TestChildrenOnNonContainer`: gives `schema-invalid` with the region's line.
  - `TestDuplicateRegionInItem`.
  - `TestIDInvalid`: covers `Trip.Timeline`, `timeline` (a single segment), and `trip..x`.
  - `TestRejectAliases`: a document using `&a`/`*a`, or `<<:`, gives `yaml-alias-not-allowed` and no screens.
  - `TestParseCRLF`: the timeline fixture with CRLF line endings gives deep-equal output.
  - `TestLayoutForOverride`.
  - `TestWalkOrder`.
- [ ] **Step 2:** Run `go test ./internal/registry/`. Expected: FAIL.
- [ ] **Step 3:** Implement. Decode with `yaml.v3` into a `yaml.Node`, walk it by hand, and record `Line`. Reject alias nodes, anchors and `<<` keys before interpreting anything.
- [ ] **Step 4:** Run the tests. Expected: PASS with coverage ≥95%.
- [ ] **Step 5:** Commit: `feat(registry): parse screens.yaml into a validated model`.

### Task 3: Flow parsing

**Files:**
- Create: `internal/flows/flows.go`
- Test: `internal/flows/flows_test.go`, `testdata/*.md`

**Interfaces:**
- Produces:
  - `type Ref struct{ Screen, Region string; Line int; InDiagram bool }`
  - `type Step struct{ Number int; Text string; Ref *Ref; Branches []string; Line int }`. `Ref` is the step's first reference. `Branches` is the step's nested bullet items, as raw text.
  - `type Flow struct{ ID, Title, Status, Entry string; Actors, Platforms []string; Refs []Ref; Steps []Step; HasDiagram bool; FrontMatterLines [2]int }`
  - `func Parse(data []byte) (*Flow, []diag.Diagnostic)`
  - `var RefPattern = regexp.MustCompile(`(^|[^\w@.])@([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)(?:#([a-z][a-z0-9-]*))?`)`. The leading group stops e-mail addresses from matching.
- Front matter is the YAML between a first line `---` and the next `---`. Required keys are `id`, `title`, `status` (`shipped` or `proposed`) and `entry`. Optional keys are `actors` and `platforms`. Anything else is `flow-frontmatter-invalid`.
- `InDiagram` is true for references inside a fenced ```` ```mermaid ```` block.
- Steps are the items of the first ordered list under a heading whose text is `Steps`. List items with their nested bullets are parsed line by line. No Markdown library is added.

- [ ] **Step 1:** Write failing tests:
  - `TestParseFlow`: the spec's flow example gives `Refs` of length 5, with 3 marked `InDiagram`.
  - `TestRefIgnoresEmail`: `dev@trip.timeline.com` yields no references.
  - `TestRefWithRegion`.
  - `TestSteps`: three numbered steps, where step 2 has two sub-bullets, gives `Steps[1].Branches` of length 2 and `Steps[0].Ref.Screen == "trip.timeline"`.
  - `TestStepWithoutRef`: gives `Ref == nil`.
  - `TestFrontMatterMissing` and `TestFrontMatterUnknownKey`: both give `flow-frontmatter-invalid`.
  - `TestFlowCRLF`.
- [ ] **Step 2:** Run `go test ./internal/flows/`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS with coverage ≥95%.
- [ ] **Step 5:** Commit: `feat(flows): parse flow front matter, references and steps`.

### Task 4: Project loading and the OS filesystem

**Files:**
- Create: `internal/project/project.go`, `internal/osfs/osfs.go`
- Test: `internal/project/project_test.go`, `internal/osfs/osfs_test.go`, `internal/testdata/projects/{valid,empty,broken}/…`

**Interfaces:**
- Produces:
  - `type WriteFS interface{ fs.FS; WriteFile(name string, data []byte) error; Remove(name string) error }`, in `project`. `Remove` of a missing file is not an error.
  - `type Project struct{ FS fs.FS; Config *config.Config; Registry *registry.Registry; Flows map[string]*flows.Flow; FlowFiles []string; Sources map[string][]byte }`. `Sources` holds the raw bytes of `starboard.yaml`, `<content>/screens.yaml` and every flow file, keyed by slash path.
  - `func Load(fsys fs.FS) (*Project, []diag.Diagnostic, error)`. A missing `starboard.yaml` returns `ErrNoProject`. A missing `screens.yaml` or `flows/` gives an empty registry or flow set. Diagnostic `File` fields are rewritten to project-relative paths.
  - `var ErrNoProject = errors.New("no starboard.yaml found; run `starboard init`")`
  - `type Dir struct{ Root string }`, in `osfs`. It implements `fs.FS` through `os.DirFS(Root)` and provides `WriteFile`.
  - `func (d Dir) WriteFile(name string, data []byte) error`. It requires `fs.ValidPath(name)`, never accepts a `..` segment, writes only after resolving that the result is inside `Root`, creates parent directories, and writes atomically via a temp file and rename.
  - `func (d Dir) Remove(name string) error`. It has the same path confinement as `WriteFile`, and removes files only, never directories.
  - `func FindRoot(start string) (string, error)`. It walks up from `start` to the first directory containing `starboard.yaml`, and returns `ErrNoProject` otherwise.

- [ ] **Step 1:** Write failing tests:
  - `TestLoadValid`
  - `TestLoadNoProject`: uses an `fstest.MapFS` with no `starboard.yaml`.
  - `TestLoadEmpty`: an empty registry with zero diagnostics.
  - `TestDiagnosticPathsRelative`
  - `TestWriteFileRefusesEscape`: `../x`, `/abs`, and `a/../../x` each return an error, and nothing is written. Uses `t.TempDir()`.
  - `TestRemoveRefusesEscape`: the same three names each return an error from `Remove`, and a sentinel file outside the root still exists.
  - `TestWriteFileAtomic`
  - `TestFindRoot`
- [ ] **Step 2:** Run `go test ./internal/project/ ./internal/osfs/`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS with coverage ≥95%.
- [ ] **Step 5:** Commit: `feat(project): load a project from any fs.FS; confined OS writes`.

### Task 5: Lint engine and model-level correctness rules

**Files:**
- Create:
  - `internal/lint/lint.go`
  - `internal/lint/rules_model.go`
  - `internal/selector/selector.go`
- Test: `internal/lint/rules_model_test.go`, `internal/selector/selector_test.go`

**Interfaces:**
- Consumes: `project.Project`, `registry.Edges`, `registry.Walk`, `Status.For`.
- Produces:
  - `type Rule struct{ ID string; Default diag.Severity; Run func(p *project.Project, c *Context) []diag.Diagnostic }`
  - `type Context struct{ Limits map[string]int }`
  - `func Rules() []Rule`: every registered rule, sorted by ID.
  - `type Options struct{ Strict bool; Generated map[string][]byte }`. `Generated` is used by `generated-stale` in Task 10. When it is nil, that rule is skipped.
  - `type Result struct{ Diagnostics []diag.Diagnostic; Errors, Warnings int }`
  - `func Run(p *project.Project, loadDiags []diag.Diagnostic, opts Options) Result`. It merges load diagnostics, applies `Config.Rules` severities to quality rules and drops `off`, and sorts.
  - `func Compile(expr string) (Selector, error)` and `func (s Selector) Strings(v any) ([]string, error)`, in `selector`. The grammar is `('.' ident ('[]')?)+`. `v` is a JSON-decoded value.

This task implements these rules:

- **`unknown-platform`, `unknown-area`:** the screen's `platforms`, `files` keys, `screenshots` keys and `area` must be configured.
- **`platform-note-missing`:** `platforms` is a strict subset of the configured platforms, and there is no `platformNote`.
- **`edge-unresolved`.**
- **`edge-platform-mismatch`:** the target screen shares no platform with the source, and the source node has no `platformNote`.
- **`status-conflict`:** a region says `status: shipped` under a screen that is `proposed` on any platform.
- **`ref-unresolved`:** a flow references an unknown screen, or a region that doesn't exist in any layout of that screen.
- **`flow-id-mismatch`:** the front matter `id` doesn't equal the filename stem.
- **`shipped-flow-proposed-ref`:** a flow whose status is shipped references a screen or region whose effective status is `proposed` on any of the flow's platforms. A flow without `platforms` uses every configured platform.
- **`vocabulary-source-invalid`:** the vocabulary file is missing or isn't JSON or YAML, or the selector doesn't compile or yields non-strings.
- **`vocabulary-unknown`:** a field named by a vocabulary key (only `requires` in v1) holds a value not in the list.

- [ ] **Step 1:** Write failing tests. Each is table-driven over small in-memory projects built with a helper `mkProject(t, files map[string]string) *project.Project`. There is one test per rule above, named `TestRule_<id>` with hyphens replaced by underscores. Each asserts the exact rule ID, `File`, `Line` and `Path`, and asserts that the valid fixture produces none. Selector tests:
  - `TestSelectorCapabilities`: `.capabilities[].name` over `{"capabilities":[{"name":"a"},{"name":"b"}]}` gives `[a b]`.
  - `TestSelectorRejects`: `.a | .b`, `a`, `.a[0]` are all rejected.
- [ ] **Step 2:** Run `go test ./internal/lint/ ./internal/selector/`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS with coverage ≥95%.
- [ ] **Step 5:** Commit: `feat(lint): rule engine and model correctness rules`.

### Task 6: File-system correctness rules

**Files:**
- Create: `internal/lint/rules_files.go`
- Test: `internal/lint/rules_files_test.go`

**Interfaces:**
- Consumes: `Project.FS`, `config.Platform.Roots`/`ScreenFiles`, `Screen.Files`, `Registry.Unmapped`.
- Produces these rules:
  - **`path-invalid`:** any path value that isn't `fs.ValidPath`, or contains `\`. The file is never opened.
  - **`file-missing`:** skipped when `Status.For(platform) == "proposed"`.
  - **`screenshot-missing`.**
  - **`unregistered-screen-file`:** reverse coverage. Glob each `ScreenFiles` pattern with `doublestar.Glob(fsys, root+"/"+pattern)`, and flag a match claimed by no screen's `Files` and absent from `Unmapped`.
  - **`unmapped-and-claimed`.**
  - A platform with no `ScreenFiles` gets no reverse coverage.

- [ ] **Step 1:** Write failing tests over `fstest.MapFS` fixtures:
  - `TestRule_file_missing`, plus a proposed-platform exemption case
  - `TestRule_screenshot_missing`
  - `TestRule_unregistered_screen_file`: `**/*View.swift` matches nested files, and `*Screen.kt` doesn't match `sub/XScreen.kt`
  - `TestRule_unmapped_and_claimed`
  - `TestFileClaimedTwiceIsFine`
  - `TestPathInvalid`: covers `../etc/passwd`, `/abs`, `a\b`, and a vocabulary `file: ../x.json`. Assert the test filesystem was never asked to open them, using a wrapping `fs.FS` that records `Open` calls.
- [ ] **Step 2:** Run `go test ./internal/lint/`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS with coverage ≥95%.
- [ ] **Step 5:** Commit: `feat(lint): file, screenshot and reverse-coverage rules`.

### Task 7: Formatter

**Files:**
- Create: `internal/format/yaml.go`, `internal/format/flow.go`, `internal/lint/rules_format.go`
- Test: `internal/format/yaml_test.go`, `internal/format/flow_test.go`, `internal/format/testdata/{in,out}/*`, `internal/lint/rules_format_test.go`

**Interfaces:**
- Produces:
  - `func Config(src []byte) ([]byte, error)`
  - `func Screens(src []byte, areaOrder []string) ([]byte, error)`
  - `func Flow(src []byte) ([]byte, error)`
  - `func Project(p *project.Project) map[string][]byte`. It returns only the files whose formatted bytes differ from `Sources`.
  - Rule `not-formatted`, one per such file, with `Fix{Description: "run starboard fmt"}`.

**Key order:**
- **Config:** `version, content, platforms, formFactors, vocabularies, areas, lint`.
- **Platform:** `formFactors, roots, screenFiles`.
- **Screen:** `title, area, purpose, presentation, status, platforms, platformNote, states, files, screenshots, layout, layouts`.
- **Region:** `region, kind, label, to, requires, status, platformNote, width, children, item, empty, items`.
- **Top level of `screens.yaml`:** `screens, unmapped`.
- Unknown keys keep their relative order, after the known ones.

**Layout rules:**
- 2-space indent.
- Screens are ordered by `areaOrder` index, with unknown areas last, then by ID.
- A region node with no `children`, `item` or `items` goes in flow style when its flow-style rendering, at its indent, is at most 100 runes. Otherwise it goes in block style.
- Comments stay attached to their nodes.
- **Flow files:** front matter key order `id, title, status, actors, entry, platforms`. Trailing whitespace is trimmed on every line, there are no more than one blank line in a row outside fenced blocks, and the body is otherwise unchanged.
- CRLF is converted to LF, with a final newline.

- [ ] **Step 1:** Write failing tests:
  - `TestFormatGolden`: each `testdata/in/*` gives `testdata/out/*`, updated with `-update`.
  - `TestFormatIdempotent`: formatting `out` returns it unchanged.
  - `TestFormatPreservesComments`: covers head, line and foot comments on a screen, a region and the document.
  - `TestFormatUnicodeWidth`: a 98-rune label with multi-byte characters stays in flow style.
  - `TestFormatCRLF`.
  - `TestFormatFlowLeavesMermaid`.
  - `FuzzFormatIdempotent`: seeded with every `testdata/in` file. For input that parses, `Screens(Screens(x)) == Screens(x)`, and a parse of the output gives the same `registry.Registry` as a parse of the input (`reflect.DeepEqual` with lines zeroed).
  - `TestRule_not_formatted`.
- [ ] **Step 2:** Run `go test ./internal/format/ ./internal/lint/`. Expected: FAIL.
- [ ] **Step 3:** Implement on `yaml.Node`: reorder `Content` pairs, set `Style` to `yaml.FlowStyle` or zero per node, then encode with `yaml.NewEncoder`, `SetIndent(2)`. Normalise line endings before decoding.
- [ ] **Step 4:** Run `go test ./internal/format/ ./internal/lint/`, then `go test -fuzz=FuzzFormatIdempotent -fuzztime=60s ./internal/format/`. Expected: PASS, with no new corpus failures.
- [ ] **Step 5:** Commit: `feat(format): canonical formatting for config, registry and flows`.

### Task 8: JSON Schemas, init, and CLI (PR 1 ends here)

**Files:**
- Create:
  - `internal/schema/schema.go`, `config.schema.json`, `screens.schema.json`
  - `internal/scaffold/scaffold.go`
  - `cmd/starboard/main.go`
- Test:
  - `internal/schema/schema_test.go`, `internal/scaffold/scaffold_test.go`
  - `cmd/starboard/main_test.go`
  - `cmd/starboard/testdata/script/{init,fmt,lint_json,lint_strict,no_project,empty_project,schema,version}.txtar`

**Interfaces:**
- Produces:
  - `func schema.Get(name string) ([]byte, bool)`, where `name` is `config` or `screens`. The schemas are JSON Schema draft 2020-12, with `$id` set to `https://starboard.c65llc.com/schema/v1/<name>.json`.
  - `func scaffold.Init(w project.WriteFS, opts scaffold.Options) ([]string, error)`, with `Options{ Platforms []string }`. It writes:
    - `starboard.yaml`, with a platform entry per name. Suggested `screenFiles` per known platform: `ios` → `**/*View.swift`, `android` → `**/*Screen.kt`, `web` → `**/*.{tsx,svelte,vue}`. Unknown platforms are left empty.
    - `docs/flows/README.md`
    - `docs/flows/screens.yaml`, holding one example screen
    - `docs/flows/flows/example.md`
    - the `.gitattributes` line `docs/flows/generated/** -text`, appended, or created if absent
  - `Init` refuses to overwrite an existing `starboard.yaml` (`ErrExists`). It returns the written paths, sorted.
- **CLI:**
  - `starboard [--dir D] <command>`, where commands are `init [--platform p]…`, `fmt [--check]`, `lint [--json] [--strict]`, `schema <config|screens>` and `version`.
  - `--dir` defaults to the working directory. Only the commands that read project files (`fmt`, `lint`, and later `generate`, `render` and `skills install`) use `osfs.FindRoot`. `init` writes into `--dir` as it is. `version` and `schema` never look for a project, and work anywhere.
  - `fmt` writes `format.Project` results and prints each path. `--check` prints them and exits 1.
  - `lint` runs `project.Load` and `lint.Run`, and prints text or JSON.
  - `version` prints `starboard <version.Version>`.

- [ ] **Step 1:** Write failing tests:
  - `TestSchemasValidateFixtures`: every `internal/testdata/projects/valid` file validates against its schema using `santhosh-tekuri/jsonschema/v6`, and every spec example validates too.
  - `TestSchemasRejectBadKind`.
  - `TestInitWritesFiles`, `TestInitRefusesOverwrite`.
  - `TestInitOutputLintsClean`: run `Init` into a `fstest.MapFS`-backed WriteFS, then `Load` and `Run` give zero diagnostics.
  - The testscript files. Each asserts exit codes, and stdout or stderr with `cmp` or `stdout` regexps. For example, `no_project.txtar` runs `exec starboard version` and `exec starboard schema config`, both succeeding with no `starboard.yaml` anywhere, then `! exec starboard lint` and expects stderr `no starboard.yaml found`, exit 2. `lint_json.txtar` runs `cmp stdout want.json`.
- [ ] **Step 2:** Run `go test ./internal/schema/ ./internal/scaffold/ ./cmd/...`. Expected: FAIL.
- [ ] **Step 3:** Implement. `main_test.go` uses `testscript.Main` with `"starboard": run`.
- [ ] **Step 4:** Run `make ci`. Expected: PASS on all packages with coverage ≥95%.
- [ ] **Step 5:** Commit `feat(cli): init, fmt, lint, schema and version commands`, then push the branch and open PR 1 with `gh pr create`.

### Task 9: Wireframe renderer

**Files:**
- Create: `internal/render/render.go`
- Test: `internal/render/render_test.go`, `internal/render/testdata/*.svg`

**Interfaces:**
- Produces: `func Wireframe(s *registry.Screen, ffName string, ff config.FormFactor) []byte`.

**Geometry**, which is fixed here so goldens are reproducible:

- **Frame:** a 24 px outer margin. A phone frame has 28 px corner radius, `tablet` 20, and `desktop` and `web-*` 8. `presentation: window` adds a 28 px title bar with three 10 px circles. `sheet` and `dialog` draw a 40% grey scrim over a generic parent, then a panel: a sheet takes the bottom 85%, and a dialog is centred at 80% width and auto height.
- **Kind heights:**

  | Kind | Height (px) |
  |---|---|
  | `bar` | 48 |
  | `tabs` | 56 |
  | `header` | 40 |
  | `text` | 24 |
  | `field` | 44 |
  | `action` | 40 |
  | `primary-action` | 48 |
  | `banner` | 56 |
  | `media` | 160 |
  | `map` | 200 |
  | `card` | 72 |
  | `menu` | 40 |

  `list`, `form`, `section` and `column` fill the remaining height, shared equally. `row` children divide the width by `Width`, with the remainder split equally. `nav` in a row is a full-height column of its items, each 36 px. Gaps are 8 px.
- **Pinning:** a `bar` first in the layout pins to the top, and `tabs` last pins to the bottom.
- **Lists:** a `list` repeats its `item` three times.
- **Overflow** past the frame is clipped, with a `…` marker centred at the bottom edge.
- **Style:**
  - fills `#ECECE6` (`primary-action` `#C9C9C1`), strokes `#9A9A92` 1 px, frame stroke 2 px
  - a `proposed` region strokes `stroke-dasharray="6 4"`
  - a region with `requires` shows a 10 px lock glyph and its capability name
  - labels: 12 px, `font-family="system-ui, -apple-system, Segoe UI, sans-serif"`
  - region names: 9 px, `ui-monospace, Menlo, Consolas, monospace`, fill `#5B5F66`
  - an opaque `#FFFFFF` rectangle sits behind the frame
- **Numbers** are formatted with `strconv.FormatFloat(v,'f',-1,64)` after rounding to 0.5 px.

- [ ] **Step 1:** Write failing tests:
  - `TestWireframeGolden`: one fixture screen per presentation (`root`, `push`, `tab`, `sheet`, `dialog`, `window`, `route`) and one row/nav web-wide layout, compared with `testdata/*.svg` and updated with `-update`.
  - `TestWireframeDeterministic`: rendering 50 times gives identical bytes.
  - `TestWireframeOverflowMarker`.
  - `TestWireframeEscapesText`: a label `<script>&"` is XML-escaped.
- [ ] **Step 2:** Run `go test ./internal/render/`. Expected: FAIL.
- [ ] **Step 3:** Implement. Write the SVG with `strings.Builder` and `encoding/xml.EscapeText` for text.
- [ ] **Step 4:** Run the tests and review the goldens by eye in a browser once. Expected: PASS with coverage ≥95%.
- [ ] **Step 5:** Commit: `feat(render): deterministic grey-box SVG wireframes`.

### Task 10: Generation and freshness

**Files:**
- Create: `internal/generate/generate.go`, `internal/lint/rules_generated.go`
- Modify: `cmd/starboard/main.go`, adding `generate [--check]` and `render <screen-id> [--form-factor f] [-o file]`
- Test: `internal/generate/generate_test.go`, `testdata/golden/**`, `internal/lint/rules_generated_test.go`, `cmd/starboard/testdata/script/{generate,render}.txtar`

**Interfaces:**
- Produces:
  - `func generate.All(p *project.Project) map[string][]byte`. Keys are content-relative paths:
    - `generated/app-map.md`
    - `generated/screens.md`
    - `generated/wireframes/<screen-id>.<form-factor>.svg`, for each form factor in the union of the screen's platforms' `formFactors`
  - Rule `generated-stale`: a file in `generated/` differs from, is missing from, or isn't in `All`. Each finding has `Fix{"run starboard generate"}`.

**`app-map.md`:**
- A header line: `<!-- Generated by starboard. Do not edit. -->`.
- `# App map`.
- A ` ```mermaid ` block holding `flowchart LR`, then one `subgraph <area>` per area in config order, with nodes `<mermaidID>["<id>"]`.
- Then edges `A --> B` from the default layouts, deduplicated and sorted.
- The Mermaid ID is the screen ID with `.` and `-` replaced by `_`.
- When there are more than 60 screens, a per-area section follows, each with its own flowchart of that area's screens plus their direct targets.

**`screens.md`:**
- The same header line.
- `# Screens`.
- Per area, an `## <area>` heading. Per screen, `### <title> (\`<id>\`)`, then:
  - purpose, presentation and status lines
  - one wireframe image per form factor: `![<id> on <ff>](wireframes/<id>.<ff>.svg)`
  - a file list per platform
  - screenshots
  - `Navigates to:` and `Reached from:` lists, sorted
  - `Used in flows:`, linking `../flows/<flow>.md`

- [ ] **Step 1:** Write failing tests:
  - `TestGenerateGolden`: the valid fixture project gives `testdata/golden/**`, updated with `-update`.
  - `TestGenerateDeterministic`.
  - `TestMermaidIDs`.
  - `TestRule_generated_stale`: covers changed, missing and extra files.
  - `generate.txtar`: `generate` then `lint` is clean, and editing a generated file makes `lint` exit 1.
  - `render.txtar`.
- [ ] **Step 2:** Run `go test ./internal/generate/ ./internal/lint/ ./cmd/...`. Expected: FAIL.
- [ ] **Step 3:** Implement. `lint` now passes `Options.Generated = generate.All(p)`.
- [ ] **Step 4:** Run `make ci`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(generate): app map, screen catalog and wireframe files with freshness rule`.

### Task 11: Quality rules and `--fix` (PR 2 ends here)

**Files:**
- Create: `internal/lint/rules_quality.go`, `internal/lint/fix.go`
- Modify: `cmd/starboard/main.go` (`lint --fix`)
- Test: `internal/lint/rules_quality_test.go`, `internal/lint/fix_test.go`, `cmd/starboard/testdata/script/lint_fix.txtar`

**Interfaces:**
- Produces the quality rules from the "Rule IDs" table:
  - **`unreachable-screen`:** no inbound edge from any other screen in any layout, `presentation` isn't `root`, and the screen isn't any flow's `entry`.
  - **`orphan-screen`:** no flow references it.
  - **`missing-purpose`.**
  - **`label-too-long`:** rune count over `Limits["label-too-long"]`, default 40. Applies to `label` on regions and `items`.
  - **`flow-ref-not-in-diagram`:** a screen referenced outside the diagram but not inside it, only when the flow has a diagram.
  - **`duplicate-edge`:** the same `(region path's parent, To)` twice in one layout.
  - **`deep-nesting`:** depth over `Limits["deep-nesting"]`, default 5.
  - **`edge-parity`:** an override's edge set is missing an edge of the default layout.
  - **`step-without-ref`.**
- Produces `type Changes struct{ Write map[string][]byte; Remove []string }` and `func Fix(p *project.Project) Changes`.
  - `Write` is the union of `format.Project(p)` and the `generate.All(p)` files that differ from disk.
  - `Remove` lists the files under `<content>/generated/` that `generate.All(p)` no longer produces, such as the wireframe of a removed screen or of a dropped form factor. It is sorted, and it never names a path outside `<content>/generated/`.
  - `lint --fix` applies the writes, then the removals, then reloads, re-runs lint, and prints each path as `wrote` or `removed`.

- [ ] **Step 1:** Write failing tests:
  - one `TestRule_<id>` per quality rule
  - `TestSeverityOverride`: `off` drops the rule and `error` makes it count as an error
  - `TestStrictCountsWarnings`
  - `lint_fix.txtar`: an unformatted, stale project gives `lint --fix` exit 0 and the files rewritten, and a second `lint` is clean
  - `TestFixRemovesObsoleteWireframe`: a project whose `generated/wireframes/` holds `old.screen.phone.svg` for a screen no longer in the registry gives `Fix(p).Remove == ["docs/flows/generated/wireframes/old.screen.phone.svg"]`, and after applying it `generated-stale` is gone
  - `TestFixNeverRemovesOutsideGenerated`: a stray file elsewhere in the content root is not listed
- [ ] **Step 2:** Run `go test ./internal/lint/ ./cmd/...`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `make ci`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(lint): quality rules, configurable severities and --fix`, then push and open PR 2.

### Task 12: Releases and the GitHub Action (PR 3)

**Files:**
- Create: `.goreleaser.yaml`, `.github/workflows/release.yml`, `action.yml`, `.github/workflows/action-test.yml`
- Modify: `README.md` (Install section)

**Interfaces:**
- **GoReleaser:**
  - builds `cmd/starboard` for `darwin`, `linux` and `windows` on `amd64` and `arm64`, with `CGO_ENABLED=0`
  - `ldflags: -s -w -X github.com/c65llc/starboard/internal/version.Version={{.Version}}`
  - archives named `starboard_{{ .Version }}_{{ .Os }}_{{ .Arch }}`, `tar.gz`, with `zip` for windows
  - checksums in `checksums.txt` (sha256)
  - changelog from release-drafter, so GoReleaser's own changelog is disabled
- **`release.yml`:**
  - runs on a `v*` tag push, on `ubuntu-latest`, with permissions `contents: write`
  - runs `make ci`, then `goreleaser release --clean`
  - then moves the floating tags `v<major>` and `v<major>.<minor>` to the tag's commit (`git tag -f`, then `git push -f origin <tag>`), but only when the tag is not a pre-release (no `-` in the version)
- **`action.yml`:**
  - a composite action with inputs `version` (required, an exact `vX.Y.Z`), `args` (default `lint`) and `working-directory` (default `.`)
  - steps:
    1. map `runner.os`/`runner.arch` to the archive name
    2. download the archive and `checksums.txt` from `https://github.com/c65llc/starboard/releases/download/<version>/`
    3. verify with `sha256sum -c --ignore-missing` (on macOS `shasum -a 256`, on Windows a PowerShell `Get-FileHash` comparison)
    4. extract to `$RUNNER_TEMP`
    5. run `starboard $args` in `working-directory`
  - a failed checksum fails the step before any execution
- **`action-test.yml`:** on PRs touching `action.yml`, run the action at `version: v0.1.0` (once released) against `internal/testdata/projects/valid` on all three operating systems.

- [ ] **Step 1:** Run `goreleaser check` and `goreleaser release --snapshot --clean`. Expected: 6 archives plus `checksums.txt` in `dist/`. `dist/starboard_*_linux_amd64/starboard version` prints `starboard 0.0.0-SNAPSHOT-…`.
- [ ] **Step 2:** Write `action.yml`. Verify locally with `act`, if available, or by running its shell steps by hand against the snapshot archive with a tampered checksum. Expected: the checksum failure stops execution.
- [ ] **Step 3:** Write `release.yml` and `action-test.yml`. Workflow files may need a human to `git add` them if the agent environment refuses; if so, say so in the PR.
- [ ] **Step 4:** Update the README's Install section with the binary download, `uses: c65llc/starboard@v0` with `version: v0.1.0`. The floating tag is the major version, so it is `v0` throughout 0.x and becomes `v1` at 1.0.0, and `go install github.com/c65llc/starboard/cmd/starboard@v0.1.0`.
- [ ] **Step 5:** Commit `ci(release): GoReleaser builds, checksummed archives and the GitHub Action`, then push and open PR 3.
- [ ] **Step 6:** After merge, a human pushes tag `v0.1.0`. Verify that the release has 6 archives and `checksums.txt`, that `v0` and `v0.1` point at the release commit, and that `action-test.yml` passes on all three operating systems.
