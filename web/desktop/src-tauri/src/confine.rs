// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

//! confine is the one guard every command's path goes through: a
//! project-relative slash path the page names becomes a file under a root
//! the user opened, or an error. Nothing outside the root is ever named,
//! whether the path tries to get there by `..`, an absolute path, a
//! backslash, a drive or verbatim prefix, or a symbolic link (on Windows, a
//! junction too) inside the root that points out of it. No path names
//! anything in a `.git` folder, either as written or once its links are
//! resolved: the repository's own files (hooks, config) are never the
//! app's to touch.
//!
//! A race remains, and is accepted: confine resolves a path, and the
//! command then opens it, so a link swapped in between (by another program
//! writing in the project at that instant) is followed. Closing it needs
//! openat-style calls (O_NOFOLLOW at each step) that std does not offer on
//! every platform. The page cannot make the swap itself: it has no command
//! that creates a link.

use std::path::{Component, Path, PathBuf};

use crate::Refusal;

/// check_rel refuses rel unless it is a clean project-relative slash path:
/// not empty, no leading `/`, no `\`, no empty, `.` or `..` segment, no
/// drive prefix (`C:`), no NUL, and no `.git` segment (is_git). On Windows a
/// `:` anywhere is refused too, as it names an alternate data stream.
pub fn check_rel(rel: &str) -> Result<(), Refusal> {
    let bad = || Refusal::invalid_path(rel);
    if rel.is_empty() || rel.starts_with('/') || rel.contains('\\') || rel.contains('\0') {
        return Err(bad());
    }
    let segments: Vec<&str> = rel.split('/').collect();
    if segments
        .iter()
        .any(|s| s.is_empty() || *s == "." || *s == ".." || is_git(s))
    {
        return Err(bad());
    }
    if is_drive(segments[0]) || (cfg!(windows) && rel.contains(':')) {
        return Err(bad());
    }
    // Belt and braces: what Path makes of it must be plain names alone.
    if !Path::new(rel)
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
    {
        return Err(bad());
    }
    Ok(())
}

/// is_git reports whether a path segment names a `.git` folder, in any case,
/// and with the trailing dots and spaces Windows ignores (`.GIT.`).
pub fn is_git(segment: &str) -> bool {
    segment
        .trim_end_matches(['.', ' '])
        .eq_ignore_ascii_case(".git")
}

/// is_drive reports whether segment is a drive prefix such as `C:` or `c:x`.
fn is_drive(segment: &str) -> bool {
    let b = segment.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

/// canonical_root is root with every symbolic link resolved, as the roots
/// are kept: a directory, or an error.
pub fn canonical_root(root: &Path) -> Result<PathBuf, Refusal> {
    let real =
        std::fs::canonicalize(root).map_err(|e| Refusal::io(&root.display().to_string(), &e))?;
    if !real.is_dir() {
        return Err(Refusal::new(
            "NotADirectory",
            format!("{} is not a folder.", root.display()),
        ));
    }
    Ok(real)
}

/// confine is the file rel names under root, which must already be
/// canonical (canonical_root). rel is checked (check_rel), joined onto
/// root, and its nearest existing ancestor, the path itself included, is
/// resolved (symbolic links and junctions alike): its real path must lie
/// under root, compared component by component, and in no `.git` folder. A
/// link that cannot be resolved (one whose target is missing) is refused,
/// as writing through it would create its target. The result is that real
/// ancestor with the rest of rel, not yet made, joined on.
pub fn confine(root: &Path, rel: &str) -> Result<PathBuf, Refusal> {
    check_rel(rel)?;
    let outside = || {
        Refusal::new(
            "OutsideRootError",
            format!("{rel} leads outside the project, so Starboard does not touch it."),
        )
    };
    // Segment by segment: a Windows verbatim root (\\?\C:\…) takes no `/`.
    let mut at = root.to_path_buf();
    for seg in rel.split('/') {
        at.push(seg);
    }
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    loop {
        match std::fs::symlink_metadata(&at) {
            Ok(_) => {
                let real = std::fs::canonicalize(&at).map_err(|_| outside())?;
                let inside = real.strip_prefix(root).map_err(|_| outside())?;
                if inside
                    .components()
                    .any(|c| is_git(&c.as_os_str().to_string_lossy()))
                {
                    return Err(Refusal::invalid_path(rel));
                }
                let mut out = real;
                for name in rest.iter().rev() {
                    out.push(name);
                }
                return Ok(out);
            }
            // Not there, or a file stands where a folder would (a/b.yaml/c):
            // look one level up.
            Err(e) if is_absent(&e) => {
                let name = at.file_name().ok_or_else(outside)?.to_os_string();
                rest.push(name);
                if !at.pop() || !at.starts_with(root) {
                    return Err(outside());
                }
            }
            Err(e) => return Err(Refusal::io(rel, &e)),
        }
    }
}

/// is_absent reports whether err means nothing is at a path: none there,
/// or a file where a folder on the way would be.
pub fn is_absent(err: &std::io::Error) -> bool {
    matches!(
        err.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
    )
}

/// confine_parent is, for a file rel names, its folder confined (the root
/// for a top-level file) and its own name, unresolved: for removing a file,
/// where the last component must not be followed (removing a link removes
/// the link, never what it points to).
pub fn confine_parent(root: &Path, rel: &str) -> Result<(PathBuf, String), Refusal> {
    check_rel(rel)?;
    match rel.rsplit_once('/') {
        Some((dir, name)) => Ok((confine(root, dir)?, name.to_string())),
        None => Ok((root.to_path_buf(), rel.to_string())),
    }
}

/// rel_of is path, which confine gave under root, as a project-relative
/// slash path again: the path as resolved, so a rule on paths can be
/// checked on where a write lands as well as on what the page named. None
/// when path is not under root, or is root itself, or a name in it is not
/// UTF-8.
pub fn rel_of(root: &Path, path: &Path) -> Option<String> {
    let inside = path.strip_prefix(root).ok()?;
    let mut parts = Vec::new();
    for c in inside.components() {
        match c {
            Component::Normal(name) => parts.push(name.to_str()?),
            _ => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TestDir;

    #[test]
    fn check_rel_takes_clean_relative_paths() {
        for ok in [
            "starboard.yaml",
            "screens/a.yaml",
            "docs/flows/screens.yaml",
            "a/b/c.png",
            "dot.in.name",
            ".gitattributes",
            "a/.hidden",
        ] {
            assert!(check_rel(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn check_rel_refuses_every_escape_and_unclean_path() {
        for bad in [
            "",
            "/etc/hosts",
            "/",
            "../x",
            "a/../../b",
            "a/..",
            "..",
            ".",
            "./a",
            "a/./b",
            "a//b",
            "a/",
            "C:\\x",
            "C:/x",
            "c:x",
            "C:",
            "\\\\?\\C:\\x",
            "\\\\server\\share",
            "a\\b",
            "a\0b",
            ".git",
            ".git/config",
            "docs/.GIT/x",
            ".git./x",
        ] {
            let err = check_rel(bad).expect_err(bad);
            assert_eq!(err.name, "InvalidPathError", "{bad}");
        }
    }

    #[test]
    fn confine_maps_a_path_under_the_root() {
        let d = TestDir::new();
        d.write("screens/a.yaml", "x");
        let root = canonical_root(d.path()).unwrap();
        assert_eq!(
            confine(&root, "screens/a.yaml").unwrap(),
            root.join("screens").join("a.yaml")
        );
        // A file not yet made, in folders not yet made.
        assert_eq!(
            confine(&root, "screens/new/b.yaml").unwrap(),
            root.join("screens").join("new").join("b.yaml")
        );
        assert_eq!(
            rel_of(&root, &root.join("screens").join("a.yaml")).as_deref(),
            Some("screens/a.yaml")
        );
    }

    #[test]
    fn confine_refuses_each_review_focus_case() {
        let d = TestDir::new();
        d.write("in.md", "x");
        let root = canonical_root(d.path()).unwrap();
        for bad in [
            "../x",
            "/etc/hosts",
            "C:\\x",
            "\\\\?\\C:\\x",
            "a\\b",
            "a/../../x",
        ] {
            assert!(confine(&root, bad).is_err(), "{bad}");
            assert!(confine_parent(&root, bad).is_err(), "{bad}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn confine_refuses_a_symlink_that_points_out() {
        let outside = TestDir::new();
        outside.write("secret.txt", "secret");
        let d = TestDir::new();
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), d.path().join("link.txt"))
            .unwrap();
        std::os::unix::fs::symlink(outside.path(), d.path().join("out")).unwrap();
        let root = canonical_root(d.path()).unwrap();
        for bad in [
            "link.txt",
            "out",
            "out/secret.txt",
            "out/new.txt",
            "out/deeper/new.txt",
        ] {
            assert_eq!(
                confine(&root, bad).expect_err(bad).name,
                "OutsideRootError",
                "{bad}"
            );
        }
        assert!(confine_parent(&root, "out/secret.txt").is_err());
    }

    /// std makes a symbolic link but not a junction (that takes a reparse
    /// point and an ioctl), and mklink is a cmd.exe builtin, so the test
    /// runs cmd.exe: a test's process, never the app's. cmd.exe reads a `/`
    /// in mklink's arguments as a switch, so the paths are joined by part.
    #[cfg(windows)]
    #[test]
    fn confine_refuses_a_junction_that_points_out() {
        let outside = TestDir::new();
        outside.write("secret.txt", "secret");
        let d = TestDir::new();
        d.write("screens/a.yaml", "x");
        let junction = d.path().join("screens").join("jct");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(outside.path())
            .output()
            .expect("running cmd.exe");
        assert!(
            made.status.success(),
            "mklink /J failed: {}{}",
            String::from_utf8_lossy(&made.stdout),
            String::from_utf8_lossy(&made.stderr)
        );
        let root = canonical_root(d.path()).unwrap();
        for bad in [
            "screens/jct",
            "screens/jct/secret.txt",
            "screens/jct/new.txt",
        ] {
            assert_eq!(
                confine(&root, bad).expect_err(bad).name,
                "OutsideRootError",
                "{bad}"
            );
        }
        assert!(confine(&root, "screens/a.yaml").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn confine_refuses_a_dangling_symlink() {
        let outside = TestDir::new();
        let d = TestDir::new();
        // Its target does not exist yet: writing through it would make it.
        std::os::unix::fs::symlink(
            outside.path().join("made.txt"),
            d.path().join("dangling.txt"),
        )
        .unwrap();
        let root = canonical_root(d.path()).unwrap();
        assert_eq!(
            confine(&root, "dangling.txt").unwrap_err().name,
            "OutsideRootError"
        );
        assert!(!outside.path().join("made.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn confine_follows_a_symlink_that_stays_inside() {
        let d = TestDir::new();
        d.write("real/a.yaml", "x");
        std::os::unix::fs::symlink(d.path().join("real"), d.path().join("alias")).unwrap();
        let root = canonical_root(d.path()).unwrap();
        assert_eq!(
            confine(&root, "alias/a.yaml").unwrap(),
            root.join("real").join("a.yaml")
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_into_the_git_folder_is_refused() {
        let d = TestDir::new();
        d.write(".git/hooks/pre-commit", "#!/bin/sh");
        std::os::unix::fs::symlink(d.path().join(".git/hooks"), d.path().join("hooks")).unwrap();
        let root = canonical_root(d.path()).unwrap();
        assert_eq!(
            confine(&root, "hooks/pre-commit").unwrap_err().name,
            "InvalidPathError"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_root_reached_through_a_symlink_is_kept_canonical() {
        let d = TestDir::new();
        d.write("proj/a.yaml", "x");
        std::os::unix::fs::symlink(d.path().join("proj"), d.path().join("via")).unwrap();
        let root = canonical_root(&d.path().join("via")).unwrap();
        assert_eq!(root, std::fs::canonicalize(d.path().join("proj")).unwrap());
        assert!(confine(&root, "a.yaml").is_ok());
    }

    #[test]
    fn a_sibling_whose_name_extends_the_root_is_outside() {
        // /x/proj-evil is not under /x/proj: compared by component, not by string.
        let d = TestDir::new();
        d.write("proj/a.yaml", "x");
        d.write("proj-evil/b.yaml", "x");
        let root = canonical_root(&d.path().join("proj")).unwrap();
        let evil = std::fs::canonicalize(d.path().join("proj-evil")).unwrap();
        assert!(!evil.starts_with(&root));
        assert_eq!(rel_of(&root, &evil.join("b.yaml")), None);
    }

    #[test]
    fn canonical_root_refuses_a_file() {
        let d = TestDir::new();
        d.write("f.txt", "x");
        assert_eq!(
            canonical_root(&d.path().join("f.txt")).unwrap_err().name,
            "NotADirectory"
        );
    }
}
