// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

//! fsops is every file operation the page may ask for, on one opened root:
//! list, read, stat and write. Every path goes through confine first. A
//! write is checked whole before any of it happens, and refused whole: each
//! path confined to the root, written only where core writes (starboard.yaml,
//! or under the content root as Rust read it, in no hidden folder), and
//! deleted only under `<content>/generated/`, each rule checked on the path
//! as the page wrote it and again on where it resolves, so no link inside
//! the root dodges one. Each file is then written atomically: to a
//! temporary file beside it, synced, then renamed over it. A write that
//! fails part way stops there: the files already renamed stay, the failure
//! names the file, and no temporary file is left behind.

use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::confine::{check_rel, confine, confine_parent, is_absent, is_git, rel_of};
use crate::roots::{scan_content, CONFIG_FILE};
use crate::Refusal;

/// The mark in a temporary file's name: `.<name>.starboard-tmp-<random>`.
/// A listing leaves such files out, as web/app's fsaccess host does.
pub const TMP_MARK: &str = ".starboard-tmp-";

/// The largest file read_text reads.
pub const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;

/// A file's modified time, in milliseconds since the epoch, and its size in bytes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Stamp {
    pub mtime: f64,
    pub size: u64,
}

/// list is every file under dir (`.` for the whole root), at any depth, as
/// project-relative slash paths in order; none when dir is missing or a
/// file, as web/app's Tree.walk. `.git` is skipped anywhere. node_modules
/// is listed only when dir reaches it, which is how web/app's hosts defer
/// it: they list only the folders core.scope walks. Links to folders are
/// not followed; a link to a file is listed only when it resolves inside
/// the root (and not into .git); temporary files are left out; and a name
/// that is not UTF-8 is left out, as no project file can be named so.
pub fn list(root: &Path, dir: &str) -> Result<Vec<String>, Refusal> {
    let (start, prefix) = if dir == "." {
        (root.to_path_buf(), String::new())
    } else {
        (confine(root, dir)?, format!("{dir}/"))
    };
    match fs::metadata(&start) {
        Ok(m) if m.is_dir() => {}
        Ok(_) => return Ok(Vec::new()),
        Err(e) if is_absent(&e) => return Ok(Vec::new()),
        Err(e) => return Err(Refusal::io(dir, &e)),
    }
    let mut out = Vec::new();
    walk(root, &start, &prefix, &mut out)?;
    out.sort();
    Ok(out)
}

fn walk(root: &Path, dir: &Path, prefix: &str, out: &mut Vec<String>) -> Result<(), Refusal> {
    let entries = fs::read_dir(dir).map_err(|e| Refusal::io(prefix, &e))?;
    for entry in entries {
        let entry = entry.map_err(|e| Refusal::io(prefix, &e))?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let rel = format!("{prefix}{name}");
        let kind = entry.file_type().map_err(|e| Refusal::io(&rel, &e))?;
        if kind.is_dir() {
            if !is_git(&name) {
                walk(root, &entry.path(), &format!("{rel}/"), out)?;
            }
        } else if name.contains(TMP_MARK) {
            // Half a write (one a crash left behind): never project content.
        } else if kind.is_file() {
            out.push(rel);
        } else if kind.is_symlink() && entry.path().is_file() && confine(root, &rel).is_ok() {
            // A link to a file is listed only when it resolves inside the
            // root, and not into .git: confine's own test.
            out.push(rel);
        }
    }
    Ok(())
}

/// read_text is the file's text (invalid UTF-8 replaced, as a browser's
/// File.text() does), or None when there is none; a folder is no file.
pub fn read_text(root: &Path, rel: &str) -> Result<Option<String>, Refusal> {
    let path = confine(root, rel)?;
    match fs::metadata(&path) {
        Ok(m) if m.is_file() => {}
        Ok(_) => return Ok(None),
        Err(e) if is_absent(&e) => return Ok(None),
        Err(e) => return Err(Refusal::io(rel, &e)),
    }
    let f = fs::File::open(&path).map_err(|e| Refusal::io(rel, &e))?;
    let mut buf = Vec::new();
    // One byte past the cap tells a file over it, however it grew.
    f.take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|e| Refusal::io(rel, &e))?;
    if buf.len() as u64 > MAX_FILE_BYTES {
        return Err(Refusal::new(
            "TooBigError",
            format!("{rel} is over {MAX_FILE_BYTES} bytes, more than Starboard reads."),
        ));
    }
    Ok(Some(String::from_utf8_lossy(&buf).into_owned()))
}

/// stat is the file's stamp, or None when there is no such file.
pub fn stat(root: &Path, rel: &str) -> Result<Option<Stamp>, Refusal> {
    let path = confine(root, rel)?;
    let m = match fs::metadata(&path) {
        Ok(m) if m.is_file() => m,
        Ok(_) => return Ok(None),
        Err(e) if is_absent(&e) => return Ok(None),
        Err(e) => return Err(Refusal::io(rel, &e)),
    };
    let mtime = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0);
    Ok(Some(Stamp {
        mtime,
        size: m.len(),
    }))
}

/// check_content refuses a content root that is not `.` or a clean
/// project-relative slash path (check_rel).
pub fn check_content(content: &str) -> Result<(), Refusal> {
    if content == "." {
        Ok(())
    } else {
        check_rel(content)
    }
}

/// in_content reports whether rel belongs to the content root content, as
/// web/app's inContent (and core's Scope) has it: anything under it, or,
/// when content is `.`, screens.yaml and whatever is under flows/ and
/// generated/ at the top.
fn in_content(rel: &str, content: &str) -> bool {
    if content == "." {
        return rel == "screens.yaml" || rel.starts_with("flows/") || rel.starts_with("generated/");
    }
    rel.strip_prefix(content)
        .is_some_and(|rest| rest.starts_with('/'))
}

/// may_write reports whether rel is a file core writes: starboard.yaml, or
/// under the content root, and in no hidden folder (.git, .github), as the
/// VS Code extension's write path has it.
fn may_write(rel: &str, content: &str) -> bool {
    (rel == CONFIG_FILE || in_content(rel, content)) && !rel.split('/').any(|s| s.starts_with('.'))
}

/// generated_dir is the folder of generated pages under content, with a trailing slash.
fn generated_dir(content: &str) -> String {
    if content == "." {
        "generated/".to_string()
    } else {
        format!("{content}/generated/")
    }
}

fn outside_content(rel: &str, content: &str) -> Refusal {
    Refusal::new(
        "OutsideContentError",
        format!(
            "{rel} is not starboard.yaml or a file under the content root {content}, \
             so Starboard does not write it."
        ),
    )
}

/// content_change is the refusal of a starboard.yaml text whose content
/// root Rust would not read as content, the one every other write is
/// bounded by: the page may reformat the file, never move that boundary.
fn content_change(content: &str) -> Refusal {
    Refusal::new(
        "ContentChangeError",
        format!(
            "starboard.yaml was not written: the new text does not keep the content setting \
             plainly as {content}, and the desktop app never changes where it writes. \
             Change the content setting with the starboard CLI or in your editor."
        ),
    )
}

/// The file types core writes (ruling D8): the only ones Rust writes or
/// deletes. A limit no reading of starboard.yaml can widen: even a
/// content root Rust reads differently from core never lets the page
/// write or delete code.
const CORE_TYPES: [&str; 3] = [".md", ".yaml", ".svg"];

/// core_type reports whether rel's file name is a name with one of
/// CORE_TYPES as its extension, compared case-sensitively.
fn core_type(rel: &str) -> bool {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    CORE_TYPES
        .iter()
        .any(|ext| name.len() > ext.len() && name.ends_with(ext))
}

fn file_type(rel: &str) -> Refusal {
    Refusal::new(
        "FileTypeError",
        format!(
            "{rel} is not a .md, .yaml or .svg file, the only kinds Starboard writes, \
             as named or where it leads, so nothing was written."
        ),
    )
}

/// config_by_another_name is the refusal of a write named rel that lands
/// on starboard.yaml through a link.
fn config_by_another_name(rel: &str) -> Refusal {
    Refusal::new(
        "ContentChangeError",
        format!(
            "{rel} leads to starboard.yaml through a link, and Starboard writes starboard.yaml \
             only by its own name, so nothing was written."
        ),
    )
}

/// write applies changes (text, or None to delete) under root, within
/// content (the content root starboard.yaml names, as Rust read it). The
/// whole write is checked first and refused, writing nothing, when any
/// path is not confined; or is not a .md, .yaml or .svg file, as written
/// or as landed (FileTypeError); or a text is not for a file may_write
/// allows; or a starboard.yaml text's content line does not read as
/// exactly content, or a write lands on starboard.yaml under any other
/// name (ContentChangeError); or a deletion is not under
/// `<content>/generated/`, as written or once resolved. Then each file is written atomically, in path order; a
/// deletion removes the name itself, never what a link there points to,
/// and one already gone is no error.
pub fn write(
    root: &Path,
    content: &str,
    changes: &BTreeMap<String, Option<String>>,
) -> Result<(), Refusal> {
    check_content(content)?;
    let generated = generated_dir(content);
    let mut plan: Vec<(&str, PathBuf, Option<&str>)> = Vec::new();
    for (rel, value) in changes {
        check_rel(rel)?;
        match value {
            Some(text) => {
                if !core_type(rel) {
                    return Err(file_type(rel));
                }
                if !may_write(rel, content) {
                    return Err(outside_content(rel, content));
                }
                let path = confine(root, rel)?;
                let landed = rel_of(root, &path);
                // starboard.yaml bounds every other write, so it is written
                // only by its own name (never through a link that lands on
                // it, ruling D3), and only with the content Rust reads now.
                if landed.as_deref() == Some(CONFIG_FILE) && rel != CONFIG_FILE {
                    return Err(config_by_another_name(rel));
                }
                if rel == CONFIG_FILE && scan_content(text).ok().as_deref() != Some(content) {
                    return Err(content_change(content));
                }
                if !landed.as_deref().is_some_and(|r| may_write(r, content)) {
                    return Err(outside_content(rel, content));
                }
                if !landed.as_deref().is_some_and(core_type) {
                    return Err(file_type(rel));
                }
                plan.push((rel, path, Some(text)));
            }
            None => {
                if !rel.starts_with(&generated) {
                    return Err(Refusal::deletion_refused(rel));
                }
                if !core_type(rel) {
                    return Err(file_type(rel));
                }
                let (dir, name) = confine_parent(root, rel)?;
                let path = dir.join(name);
                let landed = rel_of(root, &path);
                if !landed.as_deref().is_some_and(|r| r.starts_with(&generated)) {
                    return Err(Refusal::deletion_refused(rel));
                }
                if !landed.as_deref().is_some_and(core_type) {
                    return Err(file_type(rel));
                }
                plan.push((rel, path, None));
            }
        }
    }
    for (rel, path, text) in plan {
        match text {
            Some(t) => atomic_write(&path, t.as_bytes()),
            None => match fs::remove_file(&path) {
                Err(e) if !is_absent(&e) => Err(e),
                _ => Ok(()),
            },
        }
        .map_err(|e| Refusal::io(rel, &e))?;
    }
    Ok(())
}

/// temp_name is a name for a temporary file beside target, unlikely to be
/// taken and hidden: `.<target>.starboard-tmp-<random>`.
fn temp_name(target: &Path) -> PathBuf {
    use std::hash::{BuildHasher, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNT: AtomicU64 = AtomicU64::new(0);
    // RandomState is seeded from the OS's randomness, once per process,
    // and varies per instance; the count and the clock vary it further.
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(COUNT.fetch_add(1, Ordering::Relaxed));
    h.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos()),
    );
    h.write_u32(std::process::id());
    let mut name = std::ffi::OsString::from(".");
    name.push(target.file_name().unwrap_or_default());
    name.push(format!("{TMP_MARK}{:016x}", h.finish()));
    target.with_file_name(name)
}

/// atomic_write writes data to path: to a temporary file in the same
/// folder (made if missing), synced to disk, then renamed over path, so a
/// reader sees the old file or the new one, never part of either. However
/// it fails, the temporary file is removed.
pub fn atomic_write(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = temp_name(path);
    let result = (|| {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::confine::canonical_root;
    use crate::testdir::TestDir;
    use std::fs;

    fn root(d: &TestDir) -> PathBuf {
        canonical_root(d.path()).unwrap()
    }

    fn changes(items: &[(&str, Option<&str>)]) -> BTreeMap<String, Option<String>> {
        items
            .iter()
            .map(|(p, v)| (p.to_string(), v.map(str::to_string)))
            .collect()
    }

    /// leftovers is every temporary file under dir, at any depth.
    fn leftovers(dir: &Path) -> Vec<String> {
        let mut out = Vec::new();
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().into_string().unwrap();
            if entry.file_type().unwrap().is_dir() {
                out.extend(leftovers(&entry.path()));
            } else if name.contains(TMP_MARK) {
                out.push(name);
            }
        }
        out
    }

    #[test]
    fn list_skips_git_and_sorts() {
        let d = TestDir::new();
        for p in [
            "starboard.yaml",
            "docs/flows/b.md",
            "docs/flows/a.md",
            ".git/HEAD",
            "docs/.git/x",
            ".github/ci.yml",
        ] {
            d.write(p, "x");
        }
        assert_eq!(
            list(&root(&d), ".").unwrap(),
            vec![
                ".github/ci.yml",
                "docs/flows/a.md",
                "docs/flows/b.md",
                "starboard.yaml"
            ]
        );
        assert_eq!(
            list(&root(&d), "docs/flows").unwrap(),
            vec!["docs/flows/a.md", "docs/flows/b.md"]
        );
    }

    #[test]
    fn list_reaches_node_modules_only_through_the_folder_asked_for() {
        // As web/app's hosts: node_modules is listed only when a walk
        // core.scope asks for reaches it, never with the folder beside it.
        let d = TestDir::new();
        for p in [
            "app/Home.swift",
            "app/node_modules/kit/Card.tsx",
            "node_modules/x/package.json",
            "docs/flows/screens.yaml",
        ] {
            d.write(p, "x");
        }
        let r = root(&d);
        assert_eq!(
            list(&r, "app").unwrap(),
            vec!["app/Home.swift", "app/node_modules/kit/Card.tsx"]
        );
        assert_eq!(
            list(&r, "docs/flows").unwrap(),
            vec!["docs/flows/screens.yaml"]
        );
        assert_eq!(
            list(&r, "node_modules").unwrap(),
            vec!["node_modules/x/package.json"]
        );
    }

    #[test]
    fn list_of_a_missing_folder_or_a_file_is_empty() {
        let d = TestDir::new();
        d.write("notes/todo.txt", "x");
        let r = root(&d);
        assert_eq!(list(&r, "gone/deeper").unwrap(), Vec::<String>::new());
        assert_eq!(list(&r, "notes/todo.txt").unwrap(), Vec::<String>::new());
        assert!(list(&r, "../x").is_err());
    }

    #[test]
    fn list_leaves_out_temporary_files() {
        let d = TestDir::new();
        d.write("docs/flows/screens.yaml", "x");
        d.write(&format!("docs/flows/.screens.yaml{TMP_MARK}0123"), "half");
        assert_eq!(
            list(&root(&d), ".").unwrap(),
            vec!["docs/flows/screens.yaml"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn list_does_not_follow_a_folder_link_and_leaves_out_a_file_link_that_points_out() {
        let outside = TestDir::new();
        outside.write("secret.md", "x");
        let d = TestDir::new();
        d.write("a.md", "x");
        d.write(".git/config", "x");
        std::os::unix::fs::symlink(outside.path(), d.path().join("out")).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.md"), d.path().join("out.md"))
            .unwrap();
        std::os::unix::fs::symlink(d.path().join("a.md"), d.path().join("in.md")).unwrap();
        std::os::unix::fs::symlink(d.path().join(".git/config"), d.path().join("cfg.md")).unwrap();
        assert_eq!(list(&root(&d), ".").unwrap(), vec!["a.md", "in.md"]);
    }

    #[test]
    fn reads_text_and_stats() {
        let d = TestDir::new();
        d.write("a.md", "héllo");
        let r = root(&d);
        assert_eq!(read_text(&r, "a.md").unwrap().as_deref(), Some("héllo"));
        assert_eq!(read_text(&r, "missing.md").unwrap(), None);
        let s = stat(&r, "a.md").unwrap().unwrap();
        assert_eq!(s.size, 6);
        assert!(s.mtime > 0.0);
        assert_eq!(stat(&r, "missing.md").unwrap(), None);
        assert_eq!(stat(&r, "nope/deeper.md").unwrap(), None);
        // A folder is not a file.
        d.write("dir/x.md", "x");
        assert_eq!(stat(&r, "dir").unwrap(), None);
        assert_eq!(read_text(&r, "dir").unwrap(), None);
    }

    #[test]
    fn every_read_and_write_is_confined() {
        let outside = TestDir::new();
        outside.write("secret.txt", "secret");
        let d = TestDir::new();
        let r = root(&d);
        for bad in ["../x", "/etc/hosts", "C:\\x", "\\\\?\\C:\\x", "a\\b"] {
            assert!(read_text(&r, bad).is_err(), "{bad}");
            assert!(stat(&r, bad).is_err(), "{bad}");
            assert!(list(&r, bad).is_err(), "{bad}");
            assert!(
                write(&r, ".", &changes(&[(bad, Some("x"))])).is_err(),
                "{bad}"
            );
            assert!(write(&r, ".", &changes(&[(bad, None)])).is_err(), "{bad}");
        }
        assert_eq!(outside.read("secret.txt"), "secret");
    }

    #[cfg(unix)]
    #[test]
    fn no_command_reads_or_writes_through_a_link_that_points_out() {
        let outside = TestDir::new();
        outside.write("secret.txt", "secret");
        outside.write("generated/x.md", "theirs");
        let d = TestDir::new();
        d.write("starboard.yaml", "version: 1\n");
        d.write("docs/flows/generated/.keep", "");
        std::os::unix::fs::symlink(
            outside.path().join("secret.txt"),
            d.path().join("docs/flows/screens.yaml"),
        )
        .unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("docs/flows/out")).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("generated"),
            d.path().join("docs/flows/generated/out"),
        )
        .unwrap();
        let r = root(&d);
        for bad in ["docs/flows/screens.yaml", "docs/flows/out/secret.txt"] {
            assert!(read_text(&r, bad).is_err(), "{bad}");
            assert!(stat(&r, bad).is_err(), "{bad}");
        }
        let content = "docs/flows";
        for ch in [
            changes(&[("docs/flows/screens.yaml", Some("pwned"))]),
            changes(&[("docs/flows/out/new.yaml", Some("pwned"))]),
            changes(&[("docs/flows/generated/out/x.md", None)]),
        ] {
            assert!(write(&r, content, &ch).is_err(), "{ch:?}");
        }
        assert_eq!(outside.read("secret.txt"), "secret");
        assert_eq!(outside.read("generated/x.md"), "theirs");
        assert!(!outside.path().join("new.yaml").exists());
    }

    /// D2: starboard.yaml stays writable for format and fix, but a write
    /// may not move the content root, which is what bounds every other write.
    #[test]
    fn a_starboard_yaml_write_that_changes_content_is_refused_and_writes_nothing() {
        let d = TestDir::new();
        d.write("starboard.yaml", "version: 1\n");
        let r = root(&d);
        for text in [
            "version: 1\ncontent: src\n",
            "version: 1\ncontent: .\n",
            "version: 1\ncontent: \"docs/flows\"\n",
            "version: 1\ncontent: ../elsewhere\n",
        ] {
            let err = write(
                &r,
                "docs/flows",
                &changes(&[
                    ("docs/flows/screens.yaml", Some("x")),
                    ("starboard.yaml", Some(text)),
                ]),
            )
            .unwrap_err();
            assert_eq!(err.name, "ContentChangeError", "{text:?}");
            assert!(err.message.contains("starboard CLI"), "{}", err.message);
        }
        assert_eq!(d.read("starboard.yaml"), "version: 1\n");
        assert!(!d.path().join("docs/flows/screens.yaml").exists());
    }

    #[test]
    fn a_starboard_yaml_write_that_keeps_content_is_accepted() {
        let d = TestDir::new();
        d.write("starboard.yaml", "version: 1\n");
        let r = root(&d);
        for text in [
            "version: 1\n\n",
            "version: 1\ncontent: docs/flows # where they live\n",
            "# formatted\nversion: 1\n",
        ] {
            write(
                &r,
                "docs/flows",
                &changes(&[("starboard.yaml", Some(text))]),
            )
            .unwrap();
            assert_eq!(d.read("starboard.yaml"), text);
        }
        write(
            &r,
            "src",
            &changes(&[("starboard.yaml", Some("content: src\n"))]),
        )
        .unwrap();
    }

    /// D2: an equivalent value spelled another way is still a change: Rust
    /// compares what it reads, and reads only the one spelling.
    #[test]
    fn a_differently_spelled_content_value_is_refused() {
        let d = TestDir::new();
        d.write("starboard.yaml", "version: 1\n");
        let r = root(&d);
        for text in [
            "version: 1\ncontent: docs/flows/\n",
            "version: 1\ncontent: ./docs/flows\n",
            "version: 1\ncontent: docs//flows\n",
        ] {
            let err = write(
                &r,
                "docs/flows",
                &changes(&[("starboard.yaml", Some(text))]),
            )
            .unwrap_err();
            assert_eq!(err.name, "ContentChangeError", "{text:?}");
        }
        assert_eq!(d.read("starboard.yaml"), "version: 1\n");
    }

    /// D3: a file link under the content root to starboard.yaml is refused,
    /// whatever its text: starboard.yaml is written only by its own name.
    #[cfg(unix)]
    #[test]
    fn a_link_to_starboard_yaml_under_content_is_refused() {
        let d = TestDir::new();
        d.write("starboard.yaml", "version: 1\n");
        d.write("docs/flows/screens.yaml", "x");
        std::os::unix::fs::symlink(
            d.path().join("starboard.yaml"),
            d.path().join("docs/flows/cfg.yaml"),
        )
        .unwrap();
        let r = root(&d);
        for text in ["version: 1\ncontent: src\n", "version: 1\n"] {
            let err = write(
                &r,
                "docs/flows",
                &changes(&[("docs/flows/cfg.yaml", Some(text))]),
            )
            .unwrap_err();
            assert_eq!(err.name, "ContentChangeError", "{text:?}");
        }
        assert_eq!(d.read("starboard.yaml"), "version: 1\n");
        assert!(fs::symlink_metadata(d.path().join("docs/flows/cfg.yaml"))
            .unwrap()
            .file_type()
            .is_symlink());
    }

    /// D3: a folder link under the content root up to the project's top.
    #[cfg(unix)]
    #[test]
    fn a_folder_link_up_to_the_root_cannot_reach_starboard_yaml() {
        let d = TestDir::new();
        d.write("starboard.yaml", "version: 1\n");
        d.write("docs/flows/screens.yaml", "x");
        std::os::unix::fs::symlink(d.path(), d.path().join("docs/flows/up")).unwrap();
        let r = root(&d);
        let err = write(
            &r,
            "docs/flows",
            &changes(&[(
                "docs/flows/up/starboard.yaml",
                Some("version: 1\ncontent: src\n"),
            )]),
        )
        .unwrap_err();
        assert_eq!(err.name, "ContentChangeError");
        // Under it, everything else outside content is refused as before.
        let err = write(
            &r,
            "docs/flows",
            &changes(&[("docs/flows/up/README.md", Some("x"))]),
        )
        .unwrap_err();
        assert_eq!(err.name, "OutsideContentError");
        assert_eq!(d.read("starboard.yaml"), "version: 1\n");
        assert!(!d.path().join("README.md").exists());
    }

    /// D3: starboard.yaml that is itself a link (to a file inside the root)
    /// still obeys the content check: it lands on what it links to.
    #[cfg(unix)]
    #[test]
    fn a_starboard_yaml_that_is_a_link_still_keeps_its_content() {
        let d = TestDir::new();
        d.write("config/real.yaml", "version: 1\n");
        std::os::unix::fs::symlink(
            d.path().join("config/real.yaml"),
            d.path().join("starboard.yaml"),
        )
        .unwrap();
        let r = root(&d);
        let err = write(
            &r,
            "docs/flows",
            &changes(&[("starboard.yaml", Some("version: 1\ncontent: src\n"))]),
        )
        .unwrap_err();
        // It resolves outside content and is not starboard.yaml itself: refused either way.
        assert!(
            matches!(
                err.name.as_str(),
                "ContentChangeError" | "OutsideContentError"
            ),
            "{}",
            err.name
        );
        assert_eq!(d.read("config/real.yaml"), "version: 1\n");
    }

    /// D3: no deletion reaches starboard.yaml, through a link or a folder link.
    #[cfg(unix)]
    #[test]
    fn no_deletion_reaches_starboard_yaml() {
        let d = TestDir::new();
        d.write("starboard.yaml", "version: 1\n");
        d.write("docs/flows/generated/.keep", "");
        std::os::unix::fs::symlink(
            d.path().join("starboard.yaml"),
            d.path().join("docs/flows/generated/cfg.yaml"),
        )
        .unwrap();
        std::os::unix::fs::symlink(d.path(), d.path().join("docs/flows/generated/up")).unwrap();
        let r = root(&d);
        let err = write(
            &r,
            "docs/flows",
            &changes(&[("docs/flows/generated/up/starboard.yaml", None)]),
        )
        .unwrap_err();
        assert_eq!(err.name, "DeletionRefusedError");
        // Deleting the link removes the link, never starboard.yaml.
        write(
            &r,
            "docs/flows",
            &changes(&[("docs/flows/generated/cfg.yaml", None)]),
        )
        .unwrap();
        assert_eq!(d.read("starboard.yaml"), "version: 1\n");
    }

    /// D8: only the file types core writes, as written and as landed,
    /// whatever content root Rust read.
    #[test]
    fn only_markdown_yaml_and_svg_are_written_or_deleted() {
        let d = TestDir::new();
        d.write("src/main.rs", "fn main() {}\n");
        d.write("src/generated/keep.rs", "x");
        let r = root(&d);
        for ok in ["src/a.md", "src/b.yaml", "src/c.svg"] {
            write(&r, "src", &changes(&[(ok, Some("x"))])).unwrap();
        }
        for bad in [
            "src/main.rs",
            "src/run.sh",
            "src/a.MD",
            "src/b.yml",
            "src/c.svg.js",
            "src/noext",
            "src/.md",
        ] {
            let err = write(&r, "src", &changes(&[(bad, Some("pwned"))])).unwrap_err();
            assert_eq!(err.name, "FileTypeError", "{bad}");
        }
        let err = write(&r, "src", &changes(&[("src/generated/keep.rs", None)])).unwrap_err();
        assert_eq!(err.name, "FileTypeError");
        assert_eq!(d.read("src/main.rs"), "fn main() {}\n");
        assert_eq!(d.read("src/generated/keep.rs"), "x");
    }

    /// D8: a `.md` name that is a link to a file of another type lands on that file: refused.
    #[cfg(unix)]
    #[test]
    fn a_markdown_link_to_another_type_is_refused() {
        let d = TestDir::new();
        d.write("docs/flows/run.sh", "echo hi\n");
        std::os::unix::fs::symlink(
            d.path().join("docs/flows/run.sh"),
            d.path().join("docs/flows/notes.md"),
        )
        .unwrap();
        let r = root(&d);
        let err = write(
            &r,
            "docs/flows",
            &changes(&[("docs/flows/notes.md", Some("rm -rf /\n"))]),
        )
        .unwrap_err();
        assert_eq!(err.name, "FileTypeError");
        assert_eq!(d.read("docs/flows/run.sh"), "echo hi\n");
    }

    #[test]
    fn writes_stay_in_the_project_files_core_writes() {
        let d = TestDir::new();
        d.write("starboard.yaml", "version: 1\n");
        d.write("docs/flows/screens.yaml", "x");
        let r = root(&d);
        for bad in [
            "README.md",
            "docs/other.md",
            "docs/flows-x/a.md",
            "src/main.md",
            "docs/flows/.hidden/a.md",
            ".github/workflows/ci.yaml",
        ] {
            let err = write(&r, "docs/flows", &changes(&[(bad, Some("forged"))])).unwrap_err();
            assert_eq!(err.name, "OutsideContentError", "{bad}");
        }
        assert!(!d.path().join("README.md").exists());
        // starboard.yaml and the content root are written.
        write(
            &r,
            "docs/flows",
            &changes(&[
                ("starboard.yaml", Some("version: 1\ncontent: docs/flows\n")),
                ("docs/flows/flows/new.md", Some("# New\n")),
            ]),
        )
        .unwrap();
        assert_eq!(d.read("docs/flows/flows/new.md"), "# New\n");
        // With content ".", the content is screens.yaml, flows/ and generated/.
        write(&r, ".", &changes(&[("screens.yaml", Some("ok"))])).unwrap();
        write(&r, ".", &changes(&[("flows/a.md", Some("ok"))])).unwrap();
        for bad in ["README.md", "docs/flows/screens.yaml"] {
            assert_eq!(
                write(&r, ".", &changes(&[(bad, Some("x"))]))
                    .unwrap_err()
                    .name,
                "OutsideContentError",
                "{bad}"
            );
        }
    }

    #[test]
    fn write_is_atomic_and_leaves_no_temporary_file() {
        let d = TestDir::new();
        d.write("docs/flows/screens.yaml", "old");
        let r = root(&d);
        write(
            &r,
            "docs/flows",
            &changes(&[
                ("docs/flows/screens.yaml", Some("new")),
                ("docs/flows/flows/a.md", Some("made")),
            ]),
        )
        .unwrap();
        assert_eq!(d.read("docs/flows/screens.yaml"), "new");
        assert_eq!(d.read("docs/flows/flows/a.md"), "made");
        assert_eq!(leftovers(d.path()), Vec::<String>::new());
        let names: Vec<String> = fs::read_dir(d.path().join("docs/flows"))
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|n| !n.starts_with("flows"))
            .collect();
        assert_eq!(names, vec!["screens.yaml"]);
    }

    #[test]
    fn atomic_write_replaces_by_rename_and_cleans_up_on_failure() {
        let d = TestDir::new();
        d.write("a.md", "old");
        atomic_write(&d.path().join("a.md"), b"new").unwrap();
        assert_eq!(d.read("a.md"), "new");
        // The target is a folder: the rename fails, and the temporary file goes.
        d.write("dir/x.md", "x");
        assert!(atomic_write(&d.path().join("dir"), b"new").is_err());
        assert_eq!(leftovers(d.path()), Vec::<String>::new());
    }

    #[test]
    fn temporary_names_differ_and_are_hidden_beside_the_target() {
        let p = Path::new("/x/screens.yaml");
        let a = temp_name(p);
        let b = temp_name(p);
        assert_ne!(a, b);
        let name = a.file_name().unwrap().to_str().unwrap();
        assert!(
            name.starts_with(&format!(".screens.yaml{TMP_MARK}")),
            "{name}"
        );
        assert_eq!(a.parent(), p.parent());
    }

    #[test]
    fn deleting_starboard_yaml_or_anything_outside_generated_is_refused() {
        let d = TestDir::new();
        d.write("starboard.yaml", "version: 1\n");
        d.write("docs/flows/screens.yaml", "keep");
        d.write("docs/flows/generated/x.md", "gen");
        let r = root(&d);
        for (content, beside) in [
            ("docs/flows", "docs/flows/flows/new.md"),
            (".", "flows/new.md"),
        ] {
            for bad in [
                "starboard.yaml",
                "docs/flows/screens.yaml",
                "docs/flows/generated-x/a.md",
                "generated-x/a.md",
            ] {
                // With a write beside it: the whole call is refused, nothing written.
                let err = write(&r, content, &changes(&[(beside, Some("new")), (bad, None)]))
                    .unwrap_err();
                assert_eq!(err.name, "DeletionRefusedError", "{content} {bad}");
            }
        }
        assert_eq!(d.read("starboard.yaml"), "version: 1\n");
        assert_eq!(d.read("docs/flows/screens.yaml"), "keep");
        assert!(!d.path().join("docs/flows/flows/new.md").exists());
        assert!(!d.path().join("flows/new.md").exists());
        // Under generated/, the deletion happens; a missing file is no error.
        write(
            &r,
            "docs/flows",
            &changes(&[
                ("docs/flows/generated/x.md", None),
                ("docs/flows/generated/gone.md", None),
            ]),
        )
        .unwrap();
        assert!(!d.path().join("docs/flows/generated/x.md").exists());
        // With content ".", generated/ is at the root.
        d.write("generated/y.md", "gen");
        write(&r, ".", &changes(&[("generated/y.md", None)])).unwrap();
        assert!(!d.path().join("generated/y.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn deleting_a_generated_link_removes_the_link_never_its_target() {
        let d = TestDir::new();
        d.write("docs/flows/screens.yaml", "keep");
        d.write("docs/flows/generated/.keep", "");
        std::os::unix::fs::symlink(
            d.path().join("docs/flows/screens.yaml"),
            d.path().join("docs/flows/generated/x.md"),
        )
        .unwrap();
        let r = root(&d);
        write(
            &r,
            "docs/flows",
            &changes(&[("docs/flows/generated/x.md", None)]),
        )
        .unwrap();
        assert!(fs::symlink_metadata(d.path().join("docs/flows/generated/x.md")).is_err());
        assert_eq!(d.read("docs/flows/screens.yaml"), "keep");
    }

    #[cfg(unix)]
    #[test]
    fn a_generated_folder_that_is_a_link_deletes_nothing() {
        let d = TestDir::new();
        d.write("docs/flows/flows/a.md", "keep");
        std::os::unix::fs::symlink(
            d.path().join("docs/flows/flows"),
            d.path().join("docs/flows/generated"),
        )
        .unwrap();
        let r = root(&d);
        let err = write(
            &r,
            "docs/flows",
            &changes(&[("docs/flows/generated/a.md", None)]),
        )
        .unwrap_err();
        assert_eq!(err.name, "DeletionRefusedError");
        assert_eq!(d.read("docs/flows/flows/a.md"), "keep");
    }

    /// Review Focus 5: a write that fails part way. Here the second of two
    /// files cannot be made (its folder is read-only): the first, already
    /// renamed into place, stays; the failure names the file; no temporary
    /// file is left to be read as a project file; and the same write
    /// succeeds once the folder can be written again (Save again).
    #[cfg(unix)]
    #[test]
    fn a_write_into_a_read_only_folder_reports_the_error_and_leaves_no_temporary_file() {
        use std::os::unix::fs::PermissionsExt;
        let d = TestDir::new();
        d.write("docs/flows/flows/a.md", "old a");
        d.write("docs/flows/locked/b.md", "old b");
        let locked = d.path().join("docs/flows/locked");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o555)).unwrap();
        let r = root(&d);
        let ch = changes(&[
            ("docs/flows/flows/a.md", Some("new a")),
            ("docs/flows/locked/b.md", Some("new b")),
        ]);
        let err = write(&r, "docs/flows", &ch).unwrap_err();
        assert_eq!(err.name, "IoError");
        assert!(
            err.message.contains("docs/flows/locked/b.md"),
            "{}",
            err.message
        );
        assert_eq!(d.read("docs/flows/flows/a.md"), "new a");
        assert_eq!(d.read("docs/flows/locked/b.md"), "old b");
        assert_eq!(leftovers(d.path()), Vec::<String>::new());
        assert_eq!(
            list(&r, "docs/flows").unwrap(),
            vec!["docs/flows/flows/a.md", "docs/flows/locked/b.md"]
        );
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        write(&r, "docs/flows", &ch).unwrap();
        assert_eq!(d.read("docs/flows/locked/b.md"), "new b");
    }

    #[test]
    fn content_must_be_a_clean_relative_path() {
        let d = TestDir::new();
        let r = root(&d);
        for bad in [
            "",
            "/",
            "..",
            "../docs",
            "/etc",
            "C:\\x",
            "docs/../..",
            ".git",
        ] {
            assert_eq!(
                check_content(bad).err().map(|e| e.name),
                Some("InvalidPathError".to_string()),
                "{bad}"
            );
            assert!(
                write(&r, bad, &changes(&[("starboard.yaml", Some("x"))])).is_err(),
                "{bad}"
            );
        }
        assert!(check_content(".").is_ok());
        assert!(check_content("docs/flows").is_ok());
    }
}
