// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

//! The roots the user opened this session: the root_id registry every
//! command names a project by. A root is the folder's canonical path and
//! its name for the header. The content root, the one folder besides
//! starboard.yaml a write may touch, is not kept here: read_content reads it
//! from starboard.yaml on disk for each write, and the page never names it.

use std::path::{Path, PathBuf};

use crate::confine::canonical_root;
use crate::Refusal;

/// The project file, which a folder must hold to be opened.
pub const CONFIG_FILE: &str = "starboard.yaml";

/// The content root starboard.yaml gives when it gives none: core's config.DefaultContent.
pub const DEFAULT_CONTENT: &str = "docs/flows";

/// One opened root.
#[derive(Debug, Clone)]
pub struct Root {
    /// The folder, every link resolved.
    pub path: PathBuf,
    /// The folder's own name.
    pub name: String,
}

/// The roots the user opened this session; a root_id is an index. The
/// same folder opened again keeps its id.
#[derive(Debug, Default)]
pub struct Roots(Vec<Root>);

impl Roots {
    /// add keeps root, and gives its id; the same folder opened again
    /// keeps its id.
    pub fn add(&mut self, root: Root) -> u32 {
        if let Some(i) = self.0.iter().position(|r| r.path == root.path) {
            self.0[i] = root;
            return i as u32;
        }
        self.0.push(root);
        (self.0.len() - 1) as u32
    }

    /// get is the root id names, or UnknownRootError.
    pub fn get(&self, id: u32) -> Result<&Root, Refusal> {
        self.0.get(id as usize).ok_or_else(|| {
            Refusal::new(
                "UnknownRootError",
                format!("No folder is open as {id}; open the project again."),
            )
        })
    }
}

/// open_project reads the folder as a root: it must be a folder holding
/// starboard.yaml (else NoProjectError, web/app's words). A content line
/// that cannot be read for certain still opens the project, to be read;
/// every write is then refused with why (read_content).
pub fn open_project(folder: &Path) -> Result<Root, Refusal> {
    let path = canonical_root(folder)?;
    let name = path.file_name().map_or_else(
        || path.display().to_string(),
        |n| n.to_string_lossy().into_owned(),
    );
    config_file(&path, &name)?;
    Ok(Root { path, name })
}

/// config_file is root's starboard.yaml, which must be a regular file
/// itself (ruling D5): not missing or a folder (NoProjectError), and not a
/// symbolic link or junction, wherever it points (ConfigLinkError). A
/// linked starboard.yaml would let a write to its target, under another
/// name, move the content root every other write is bounded by.
fn config_file(root: &Path, name: &str) -> Result<PathBuf, Refusal> {
    let path = root.join(CONFIG_FILE);
    let no_project = || {
        Refusal::new(
            "NoProjectError",
            format!(
                "{name} has no starboard.yaml, so it is not a Starboard project. \
                 Choose the folder that holds starboard.yaml, or run `starboard init` in it first."
            ),
        )
    };
    match std::fs::symlink_metadata(&path) {
        Ok(m) if m.file_type().is_symlink() || is_reparse_point(&m) => Err(Refusal::new(
            "ConfigLinkError",
            format!(
                "{name}'s starboard.yaml is a link, which the desktop app does not open or \
                 write through. Replace the link with the file itself."
            ),
        )),
        Ok(m) if m.is_file() => Ok(path),
        Ok(_) => Err(no_project()),
        Err(e) if crate::confine::is_absent(&e) => Err(no_project()),
        Err(e) => Err(Refusal::io(CONFIG_FILE, &e)),
    }
}

/// is_reparse_point reports a Windows reparse point (a junction, or any
/// other link std does not call a symlink); never on other systems.
#[cfg(windows)]
fn is_reparse_point(m: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_: &std::fs::Metadata) -> bool {
    false
}

/// read_content is the content root of the project at root (canonical),
/// as starboard.yaml on disk says now: scanned with scan_content and
/// allowed by fsops::check_content, or the refusal every write meets.
/// Desktop::write reads it afresh for each write, so an editor's change to
/// `content:` bounds the next write with no reopen; the page cannot make
/// that change itself (fsops::write refuses a starboard.yaml that moves it).
pub fn read_content(root: &Path) -> Result<String, Refusal> {
    let name = root.file_name().map_or_else(
        || root.display().to_string(),
        |n| n.to_string_lossy().into_owned(),
    );
    let config = config_file(root, &name)?;
    let text = std::fs::read_to_string(&config).map_err(|e| Refusal::io(CONFIG_FILE, &e))?;
    let content = scan_content(&text).map_err(|why| unread_content(&why))?;
    crate::fsops::check_content(&content)?;
    Ok(content)
}

/// scan_content is starboard.yaml's top-level `content:` scalar, read by a
/// line scan rather than a YAML parser (none is among the allowed crates).
/// It accepts only a document whose every unindented, non-comment line is
/// a `%` directive before the document, a `---` marker (with at most a
/// comment after it), or a plain key (letters, digits, `_`, `-`, `.`)
/// followed by `:` and a space, a tab or the line's end, whose value
/// before any ` #` comment holds no quote and as many `{`/`[` as `}`/`]`.
/// No quoted scalar or flow collection, opened on any line, may still be
/// open when an unindented line starts. It reads `content` only in the
/// plain form `content: <path>`, with an optional ` # comment`, once at the
/// top level; without one, or with an empty, `~` or `null` value, it is
/// DEFAULT_CONTENT, as core's config defaults it. It refuses, saying why:
/// any line it cannot classify so; a content value that is quoted, has a
/// backslash, a tag, an anchor or alias, a block or flow indicator, a
/// reserved first character, `- `, or `: `, or goes on onto an indented
/// line; a line break other than \n or \r\n; a document indented as a
/// whole; a `...` marker; a second top-level `content`; a merge key; or
/// more than one document. The caller then refuses every write.
/// internal/config's golden test (scan_content_golden_test.go) writes
/// testdata/scan-content.json, and proves that each form accepted there is
/// read by core's config.Parse as exactly the value this gives; the tests
/// below hold this scan to that file. Forms not in the golden are covered
/// only by the rules above.
pub fn scan_content(yaml: &str) -> Result<String, String> {
    let yaml = yaml.strip_prefix('\u{feff}').unwrap_or(yaml);
    // YAML breaks a line at \r, U+0085, U+2028 and U+2029 as well as at
    // \n; `lines()` splits on \n and \r\n only, so a line this scan sees
    // whole may be several to the CLI's parser. Refuse them, anywhere.
    let mut chars = yaml.chars().peekable();
    while let Some(c) = chars.next() {
        let lone_cr = c == '\r' && chars.peek() != Some(&'\n');
        if lone_cr || matches!(c, '\u{85}' | '\u{2028}' | '\u{2029}') {
            return Err("it has a line break other than \\n or \\r\\n".into());
        }
    }
    let lines: Vec<&str> = yaml.lines().collect();
    nothing_runs_onto_a_top_level_line(&lines)?;
    let meaningful = |l: &str| {
        let t = l.trim();
        !t.is_empty() && !t.starts_with('#')
    };
    let indented = |l: &str| l.starts_with([' ', '\t']);
    let mut found: Option<(usize, &str)> = None;
    let mut seen_body = false;
    let mut seen_first = false;
    for (i, line) in lines.iter().enumerate() {
        if !meaningful(line) {
            continue;
        }
        let is_marker = |m: &str| {
            line.strip_prefix(m)
                .is_some_and(|r| r.is_empty() || r.starts_with([' ', '\t']))
        };
        for m in ["---", "..."] {
            // A marker carries nothing after it but a comment.
            if is_marker(m) {
                let after = line[3..].trim();
                if !after.is_empty() && !after.starts_with('#') {
                    return Err(format!("its {m} line has content after the marker"));
                }
            }
        }
        if is_marker("---") {
            if seen_body {
                return Err("it holds more than one YAML document".into());
            }
            seen_body = true;
            continue;
        }
        if is_marker("...") {
            return Err("it marks the end of a YAML document (...)".into());
        }
        if line.starts_with('%') && !seen_body {
            continue; // a directive, before the document
        }
        if !seen_first {
            seen_first = true;
            if indented(line) {
                return Err("the whole document is indented".into());
            }
        }
        seen_body = true;
        if line.starts_with(['{', '[']) {
            return Err("it is written in flow style ({ } or [ ])".into());
        }
        if line.starts_with("<<") {
            return Err("it merges in a mapping (<<)".into());
        }
        if line.starts_with(['"', '\'']) && line[1..].starts_with("content") {
            return Err("its content key is quoted".into());
        }
        if line.starts_with('?') {
            return Err("it has a complex key (?)".into());
        }
        if let Some(rest) = line.strip_prefix("content") {
            if rest.trim_start().starts_with(':') && !rest.starts_with(':') {
                return Err("its content key has a space before the colon".into());
            }
        }
        if indented(line) {
            continue; // inside the value of the key above
        }
        // Every other top-level line is a plain key too, or it is refused
        // (ruling D4): core might read a quoted, escaped, anchored, aliased
        // or tagged key, a flow or complex key, or a sequence as content.
        let Some((key, value)) = plain_key(line) else {
            return Err(format!(
                "its top-level line {} is not a plain key",
                json_line(line)
            ));
        };
        // Ruling D6: a quoted value may run onto the next lines, where core
        // reads no key; a flow collection left open runs on too, where a
        // `content:` at the start of a line is the collection's key. Only
        // what comes before a ` #` comment counts: with no quote in it, that
        // is the comment's true start.
        let code = value
            .find(" #")
            .or_else(|| value.find("\t#"))
            .map_or(value, |c| &value[..c]);
        if code.contains(['"', '\'']) {
            return Err(format!(
                "its top-level line {} has a quoted value",
                json_line(line)
            ));
        }
        let opens = code.matches(['{', '[']).count();
        let closes = code.matches(['}', ']']).count();
        if opens != closes {
            return Err("it has a flow collection ({ } or [ ]) that spans lines".into());
        }
        if key != "content" {
            continue; // another key, such as contents:
        }
        let rest = value;
        if found.is_some() {
            return Err("it has content twice at the top level".into());
        }
        found = Some((i, rest));
    }
    let Some((at, rest)) = found else {
        return Ok(DEFAULT_CONTENT.to_string());
    };
    let mut value = rest.trim();
    if value.starts_with('#') {
        value = "";
    } else if let Some(c) = value.find(" #").or_else(|| value.find("\t#")) {
        value = value[..c].trim_end();
    }
    // An indented line next belongs to the value, empty or not: a plain
    // scalar continues onto it (`content: .` then `  x` reads `. x`).
    let continues = lines[at + 1..]
        .iter()
        .find(|l| meaningful(l))
        .is_some_and(|l| indented(l));
    if value.is_empty() {
        if continues {
            return Err("its content value goes on to the next line".into());
        }
        return Ok(DEFAULT_CONTENT.to_string());
    }
    if matches!(value, "~" | "null" | "Null" | "NULL") {
        if continues {
            return Err("its content value goes on to the next line".into());
        }
        return Ok(DEFAULT_CONTENT.to_string());
    }
    let first = value.chars().next().unwrap_or(' ');
    let why = match first {
        '"' | '\'' => Some("its content value is quoted"),
        '&' | '*' => Some("its content value is an anchor or an alias"),
        '!' => Some("its content value has a tag"),
        '|' | '>' => Some("its content value is a block scalar"),
        '{' | '[' => Some("its content value is in flow style"),
        '@' | '`' | '%' | ',' | '?' | ':' => {
            Some("its content value starts with a character YAML reserves")
        }
        '-' if value == "-" || value.starts_with("- ") => Some("its content value is a list"),
        _ => None,
    };
    if let Some(why) = why {
        return Err(why.into());
    }
    if value.contains('\\') {
        return Err("its content value has a backslash, which may be an escape".into());
    }
    if value.contains(": ") || value.ends_with(':') {
        return Err("its content value holds a colon and a space".into());
    }
    if continues {
        return Err("its content value goes on to the next line".into());
    }
    Ok(value.to_string())
}

/// nothing_runs_onto_a_top_level_line refuses a document in which a quoted
/// scalar or a flow collection, opened on any line (indented or not), is
/// still open when an unindented line starts: core reads that line as part
/// of the scalar or collection, never as a top-level key. A quote counts
/// only where a scalar can start (the line's start, or after `:`, `-`,
/// `?`, `[`, `{` or `,`), so an apostrophe inside a word is no quote; a `#`
/// after whitespace, outside a quote, starts a comment.
fn nothing_runs_onto_a_top_level_line(lines: &[&str]) -> Result<(), String> {
    #[derive(PartialEq)]
    enum Quote {
        None,
        Double,
        Single,
    }
    let mut quote = Quote::None;
    let mut depth: usize = 0;
    for line in lines {
        let top = !line.is_empty() && !line.starts_with([' ', '\t']);
        if top && quote != Quote::None {
            return Err("a quoted value runs onto the next line".into());
        }
        if top && depth > 0 {
            return Err("it has a flow collection ({ } or [ ]) that spans lines".into());
        }
        let chars: Vec<char> = line.chars().collect();
        let mut prev = ' '; // the last non-blank character, ' ' at the start
        let mut after_blank = true;
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            match quote {
                Quote::Double => {
                    if c == '\\' {
                        i += 1; // the escaped character
                    } else if c == '"' {
                        quote = Quote::None;
                    }
                }
                Quote::Single => {
                    if c == '\'' {
                        if chars.get(i + 1) == Some(&'\'') {
                            i += 1; // '' is a quote inside the scalar
                        } else {
                            quote = Quote::None;
                        }
                    }
                }
                Quote::None => {
                    let at_start = matches!(prev, ' ' | ':' | '-' | '?' | '[' | '{' | ',');
                    match c {
                        '#' if after_blank => break, // a comment
                        '"' if at_start => quote = Quote::Double,
                        '\'' if at_start => quote = Quote::Single,
                        '[' | '{' => depth += 1,
                        ']' | '}' => depth = depth.saturating_sub(1),
                        _ => {}
                    }
                }
            }
            if !c.is_whitespace() {
                prev = c;
            }
            after_blank = c.is_whitespace();
            i += 1;
        }
    }
    Ok(())
}

/// plain_key splits a top-level line into a plain key and the rest after
/// its colon: the key is letters, digits, `_`, `-` and `.` (starting with a
/// letter, digit or `_`), and the colon ends the line or is followed by a
/// space or tab. None for any other line.
fn plain_key(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once(':')?;
    let first = key.chars().next()?;
    let plain = (first.is_ascii_alphanumeric() || first == '_')
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    (plain && (value.is_empty() || value.starts_with([' ', '\t']))).then_some((key, value))
}

/// json_line is line quoted for a message, cut short if long.
fn json_line(line: &str) -> String {
    let short: String = line.chars().take(60).collect();
    serde_json::to_string(&short).unwrap_or(short)
}

/// unread_content is the refusal every write meets when scan_content could
/// not read starboard.yaml's content line for certain.
fn unread_content(why: &str) -> Refusal {
    Refusal::new(
        "ContentUnreadError",
        format!(
            "The desktop app could not read starboard.yaml's content setting for certain ({why}), \
             so it writes nothing in this project. Make the change with the starboard CLI, \
             or write the setting as a plain `content: <folder>` line."
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TestDir;

    fn project(d: &TestDir, name: &str, yaml: &str) -> PathBuf {
        d.write(&format!("{name}/{CONFIG_FILE}"), yaml);
        d.path().join(name)
    }

    #[test]
    fn a_project_opens_with_its_canonical_path_name_and_content() {
        let d = TestDir::new();
        let p = project(&d, "alpha", "version: 1\ncontent: screens # here\n");
        let root = open_project(&p).unwrap();
        assert_eq!(root.path, std::fs::canonicalize(&p).unwrap());
        assert_eq!(root.name, "alpha");
        assert_eq!(read_content(&root.path), Ok("screens".to_string()));
        let plain = open_project(&project(&d, "beta", "version: 1\n")).unwrap();
        assert_eq!(read_content(&plain.path).as_deref(), Ok(DEFAULT_CONTENT));
    }

    #[test]
    fn a_folder_without_starboard_yaml_is_refused() {
        let d = TestDir::new();
        d.write("plain/readme.md", "x");
        assert_eq!(
            open_project(&d.path().join("plain")).unwrap_err().name,
            "NoProjectError"
        );
        assert_eq!(
            open_project(&d.path().join("missing")).unwrap_err().name,
            "IoError"
        );
        // starboard.yaml as a folder is no project file either.
        d.write("odd/starboard.yaml/x", "x");
        assert_eq!(
            open_project(&d.path().join("odd")).unwrap_err().name,
            "NoProjectError"
        );
    }

    #[test]
    fn a_content_line_read_unclearly_or_outside_the_root_opens_with_writes_refused() {
        let d = TestDir::new();
        let quoted = open_project(&project(&d, "q", "version: 1\ncontent: \"docs\"\n")).unwrap();
        let err = read_content(&quoted.path).unwrap_err();
        assert_eq!(err.name, "ContentUnreadError");
        assert!(err.message.contains("starboard CLI"), "{}", err.message);
        let out = open_project(&project(&d, "o", "version: 1\ncontent: ../elsewhere\n")).unwrap();
        assert_eq!(
            read_content(&out.path).unwrap_err().name,
            "InvalidPathError"
        );
    }

    /// D5: a starboard.yaml that is a link is refused at open, wherever it
    /// points: what it points to could be written under another name.
    #[cfg(unix)]
    #[test]
    fn a_linked_starboard_yaml_is_refused_at_open_and_by_read_content() {
        let d = TestDir::new();
        for (name, target) in [
            ("flows", "docs/flows/starboard.yaml"),
            ("generated", "docs/flows/generated/cfg.yaml"),
        ] {
            d.write(
                &format!("{name}/{target}"),
                "version: 1\ncontent: docs/flows\n",
            );
            std::os::unix::fs::symlink(
                d.path().join(name).join(target),
                d.path().join(name).join(CONFIG_FILE),
            )
            .unwrap();
            let err = open_project(&d.path().join(name)).unwrap_err();
            assert_eq!(err.name, "ConfigLinkError", "{name}");
            assert!(err.message.contains("Replace the link"), "{}", err.message);
            let real = std::fs::canonicalize(d.path().join(name)).unwrap();
            assert_eq!(read_content(&real).unwrap_err().name, "ConfigLinkError");
        }
        // A regular starboard.yaml is unaffected.
        let p = project(&d, "plain", "version: 1\ncontent: docs/flows\n");
        let root = open_project(&p).unwrap();
        assert_eq!(read_content(&root.path).as_deref(), Ok("docs/flows"));
    }

    #[test]
    fn the_same_folder_keeps_its_id_and_an_unknown_id_is_refused() {
        let d = TestDir::new();
        let mut roots = Roots::default();
        let a = roots.add(open_project(&project(&d, "alpha", "version: 1\n")).unwrap());
        let b = roots.add(open_project(&project(&d, "beta", "version: 1\n")).unwrap());
        assert_eq!((a, b), (0, 1));
        let again = roots.add(open_project(&d.path().join("alpha")).unwrap());
        assert_eq!(again, 0);
        assert_eq!(roots.get(0).unwrap().name, "alpha");
        assert_eq!(roots.get(7).unwrap_err().name, "UnknownRootError");
    }

    #[test]
    fn scan_content_reads_the_plain_forms() {
        let ok = |y: &str| scan_content(y).unwrap_or_else(|e| panic!("{y:?}: {e}"));
        assert_eq!(ok("version: 1\n"), DEFAULT_CONTENT);
        assert_eq!(ok(""), DEFAULT_CONTENT);
        assert_eq!(ok("version: 1\ncontent: docs\n"), "docs");
        assert_eq!(ok("\u{feff}content: my docs # x\n"), "my docs");
        assert_eq!(ok("content: .\n"), ".");
        assert_eq!(ok("content: a/b-c_d.e\n"), "a/b-c_d.e");
        assert_eq!(ok("content: records # where they live\n"), "records");
        assert_eq!(ok("content:\n"), DEFAULT_CONTENT);
        assert_eq!(ok("content: # none\nversion: 1\n"), DEFAULT_CONTENT);
        assert_eq!(ok("content:\n# a comment\nversion: 1\n"), DEFAULT_CONTENT);
        assert_eq!(ok("content: ~\n"), DEFAULT_CONTENT);
        assert_eq!(ok("content: null\n"), DEFAULT_CONTENT);
        assert_eq!(ok("---\ncontent: docs\n"), "docs");
        assert_eq!(ok("%YAML 1.2\n---\ncontent: docs\n"), "docs");
        // Indented, it belongs to another key: not the top-level content.
        assert_eq!(
            ok("platforms:\n  web:\n    content: elsewhere\n"),
            DEFAULT_CONTENT
        );
        assert_eq!(ok("# content: commented\ncontent: real\n"), "real");
        // Other keys that start alike.
        assert_eq!(ok("contents: x\ncontent_dir: y\ncontent: z\n"), "z");
    }

    #[test]
    fn scan_content_fails_closed_on_anything_it_cannot_read_for_certain() {
        for (yaml, why) in [
            ("content: \"my docs\"\n", "quoted"),
            ("content: 'a/b'\n", "quoted"),
            ("content: docs\\flows\n", "backslash"),
            ("content: docs\nversion: 1\ncontent: other\n", "twice"),
            ("content: docs\n---\ncontent: other\n", "more than one"),
            ("---\nversion: 1\n---\nversion: 2\n", "more than one"),
            ("content: docs\n...\n", "end of a YAML document"),
            ("content: &c docs\n", "anchor"),
            ("base: &c docs\ncontent: *c\n", "anchor"),
            ("<<: *defaults\nversion: 1\n", "merges"),
            ("{content: docs}\n", "flow style"),
            ("content: {dir: docs}\n", "flow style"),
            ("content: [docs]\n", "flow style"),
            ("content: |\n  docs\n", "block scalar"),
            ("content: >-\n  docs\n", "block scalar"),
            ("content:\n  docs\n", "next line"),
            ("\"content\": docs\n", "quoted"),
            ("'content': docs\n", "quoted"),
            ("content : docs\n", "space before the colon"),
            ("? content\n: docs\n", "complex key"),
            ("content: !!str docs\n", "tag"),
            ("content: - docs\n", "list"),
            ("content: a: b\n", "colon"),
        ] {
            let err = scan_content(yaml).expect_err(yaml);
            assert!(err.contains(why), "{yaml:?}: {err}");
        }
    }

    /// D4: every top-level line must be one scan_content can classify: a
    /// plain key, a comment, a blank, a marker or a directive. Anything core
    /// might read as a `content` key another way is refused.
    #[test]
    fn scan_content_refuses_any_top_level_line_that_is_not_a_plain_key() {
        for yaml in [
            "version: 1\n\"version\": 1\ncontent: docs\n",
            "version: 1\n'platforms': {}\n",
            "version: 1\n\"con\\x74ent\": src\n",
            "version: 1\n\"\\u0063ontent\": src\n",
            "version: 1\n&a content: src\n",
            "version: 1\n*a : src\n",
            "version: 1\n!!str content: src\n",
            "version: 1\n? content\n",
            "version: 1\n[content]: src\n",
            "version: 1\n- content\n",
            "version: 1\n: src\n",
            "version: 1\nplain line\n",
        ] {
            assert!(scan_content(yaml).is_err(), "{yaml:?}");
        }
    }

    /// D4: a flow collection opened on a top-level line and closed later can
    /// hold a `content` key at the start of a line, which core reads as the
    /// collection's, not the document's.
    #[test]
    fn scan_content_refuses_a_flow_collection_that_spans_lines() {
        for yaml in [
            "version: 1\nplatforms: {web: {formFactors: [phone]},\ncontent: src}\n",
            "version: 1\nareas: [a,\ncontent: src]\n",
        ] {
            let err = scan_content(yaml).expect_err(yaml);
            assert!(err.contains("flow"), "{yaml:?}: {err}");
        }
        // One closed on its own line is fine.
        assert_eq!(
            scan_content("version: 1\nareas: [a, b]\ncontent: docs\n").unwrap(),
            "docs"
        );
    }

    /// D6: a quoted value on a top-level line is refused (a quoted scalar
    /// may run onto the next lines, where core reads no key), and so is a
    /// quote or flow collection still open when an unindented line starts,
    /// wherever it opened; brackets in a comment are not counted.
    #[test]
    fn scan_content_refuses_a_quote_that_can_run_onto_a_top_level_line() {
        for yaml in [
            "version: 1\nareas: \"x\ncontent: src\nlint: y\"\n",
            "version: 1\nareas: [\"]x\ncontent: src\nlint: y\"] #[\n",
            "version: 1\nareas: 'x'\ncontent: docs\n",
            "version: 1\nplatforms:\n  web:\n    roots: [\"a\ncontent: src\n  b\"]\n",
            "version: 1\nplatforms:\n  web: 'x\ncontent: src\n  y'\n",
            "version: 1\nplatforms:\n  web:\n    roots: [a,\ncontent: src]\n",
            // Counted per top-level line, so one left open is refused even
            // when it closes on an indented line.
            "version: 1\nareas: [a,\n  b]\ncontent: docs\n",
        ] {
            assert!(scan_content(yaml).is_err(), "{yaml:?}");
        }
        for (yaml, value) in [
            ("version: 1\nareas: [a] # see {x}\ncontent: docs\n", "docs"),
            (
                "version: 1\nareas: [a] # it's [here\ncontent: docs\n",
                "docs",
            ),
            (
                "version: 1\nplatforms:\n  web:\n    roots: [\"app\", 'it''s']\ncontent: docs\n",
                "docs",
            ),
        ] {
            assert_eq!(scan_content(yaml).as_deref(), Ok(value), "{yaml:?}");
        }
    }

    #[test]
    fn scan_content_refuses_a_value_that_continues_onto_an_indented_line() {
        // core reads `content: .` then `  x` as ". x".
        for yaml in [
            "content: .\n  x\n",
            "content: docs\n  more\n",
            "content: docs\n# c\n\tmore\n",
            "content: docs\n\n  more\n",
            "content: ~\n  x\n",
            "content: null\n  x\n",
        ] {
            let err = scan_content(yaml).expect_err(yaml);
            assert!(err.contains("next line"), "{yaml:?}: {err}");
        }
    }

    #[test]
    fn scan_content_refuses_line_breaks_yaml_knows_and_lines_does_not() {
        for yaml in [
            "content: docs\rmore\n",
            "version: 1\rcontent: docs\n",
            "content: docs\r",
            "content: docs\u{85}more\n",
            "content: docs\u{2028}more\n",
            "content: docs\u{2029}more\n",
        ] {
            let err = scan_content(yaml).expect_err(yaml);
            assert!(err.contains("line break"), "{yaml:?}: {err}");
        }
        // \r\n is the one ordinary pair.
        assert_eq!(
            scan_content("content: docs\r\nversion: 1\r\n").unwrap(),
            "docs"
        );
    }

    #[test]
    fn scan_content_refuses_a_document_indented_as_a_whole() {
        for yaml in [
            "  content: docs\n",
            "---\n  content: docs\n",
            "# c\n\n\tcontent: docs\n",
        ] {
            let err = scan_content(yaml).expect_err(yaml);
            assert!(err.contains("indented"), "{yaml:?}: {err}");
        }
    }

    #[test]
    fn scan_content_refuses_a_marker_with_more_than_a_comment_after_it() {
        for yaml in [
            "--- !!map\ncontent: docs\n",
            "--- {content: docs}\n",
            "--- |\n  content: docs\n",
            "content: docs\n... x\n",
        ] {
            let err = scan_content(yaml).expect_err(yaml);
            assert!(err.contains("after the marker"), "{yaml:?}: {err}");
        }
        assert_eq!(scan_content("--- # top\ncontent: docs\n").unwrap(), "docs");
        assert_eq!(scan_content("---  \ncontent: docs\n").unwrap(), "docs");
    }

    /// The golden the Go test (internal/config) writes: every file there
    /// is one core's config.Parse either reads as the value given or Rust
    /// refuses. Rust must accept exactly the cases marked accepted, with
    /// exactly that value.
    #[test]
    fn scan_content_agrees_with_the_golden_core_is_tested_against() {
        #[derive(serde::Deserialize)]
        struct Case {
            name: String,
            yaml: String,
            accept: bool,
            #[serde(default)]
            value: String,
        }
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../testdata/scan-content.json")).unwrap();
        assert!(cases.len() > 40, "the golden is empty or missing");
        for c in cases {
            match (c.accept, scan_content(&c.yaml)) {
                (true, Ok(v)) => assert_eq!(v, c.value, "{}", c.name),
                (false, Err(_)) => {}
                (true, Err(e)) => panic!("{}: refused an accepted form: {e}", c.name),
                (false, Ok(v)) => panic!("{}: accepted a refused form as {v:?}", c.name),
            }
        }
    }
}
