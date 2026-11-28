// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

//! The recent projects: the folders the user opened, newest first, at most
//! MAX_RECENTS, each once, by canonical path. They are kept in the app's
//! config folder as `starboard/recents.json`, never in a project. A page
//! may reopen a folder only when its path is in this list (reopen), so the
//! list is also what stands between the page and any other folder on the
//! machine; and a listed project that has moved or gone is taken off it,
//! never replaced by whatever now answers to its path.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::roots::CONFIG_FILE;
use crate::Refusal;

/// How many recent projects are kept.
pub const MAX_RECENTS: usize = 10;

/// One recent project: its canonical path, its folder name, and when it
/// was last opened, in milliseconds since the epoch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recent {
    pub path: String,
    pub name: String,
    pub opened_at: f64,
}

/// recents_file is where the list is kept: `<config dir>/starboard/recents.json`.
pub fn recents_file() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("starboard").join("recents.json"))
}

/// load is the list in file, or empty when there is none or it does not
/// read as one (a damaged file is started afresh, not an error). Entries
/// past MAX_RECENTS, and repeats, are dropped.
pub fn load(file: &Path) -> Vec<Recent> {
    let Ok(text) = std::fs::read_to_string(file) else {
        return Vec::new();
    };
    let list: Vec<Recent> = serde_json::from_str(&text).unwrap_or_default();
    let mut out: Vec<Recent> = Vec::new();
    for r in list {
        if !out.iter().any(|o| o.path == r.path) && out.len() < MAX_RECENTS {
            out.push(r);
        }
    }
    out
}

/// save writes list to file, atomically, making its folder if need be.
pub fn save(file: &Path, list: &[Recent]) -> std::io::Result<()> {
    let text = serde_json::to_string_pretty(list).map_err(std::io::Error::other)?;
    crate::fsops::atomic_write(file, text.as_bytes())
}

/// remember is list with path first, opened at now: an entry already there
/// moves up (and takes the new name), and the oldest past MAX_RECENTS go.
pub fn remember(list: &[Recent], path: &str, name: &str, now: f64) -> Vec<Recent> {
    let mut out = vec![Recent {
        path: path.to_string(),
        name: name.to_string(),
        opened_at: now,
    }];
    out.extend(list.iter().filter(|r| r.path != path).cloned());
    out.truncate(MAX_RECENTS);
    out
}

/// record puts the folder at root first in file's list, by its canonical
/// path, so a project reached by two names is one entry.
pub fn record(file: &Path, root: &Path, name: &str, now: f64) -> std::io::Result<()> {
    let real = std::fs::canonicalize(root)?;
    let list = remember(&load(file), &real.to_string_lossy(), name, now);
    save(file, &list)
}

/// reopen is the folder to open for path, which must be in file's list
/// (else NotRecentError). It must still be that folder: its canonical path
/// is still path itself, and it still holds starboard.yaml. If not, the
/// project has moved or gone: it is taken off the list, and MovedError
/// says so.
pub fn reopen(file: &Path, path: &str) -> Result<PathBuf, Refusal> {
    let list = load(file);
    let Some(entry) = list.iter().find(|r| r.path == path) else {
        return Err(Refusal::new(
            "NotRecentError",
            "That folder is not among the recent projects; open it with Open folder… instead."
                .to_string(),
        ));
    };
    let here = std::fs::canonicalize(path)
        .is_ok_and(|real| real == Path::new(path) && real.join(CONFIG_FILE).is_file());
    if here {
        return Ok(PathBuf::from(path));
    }
    let name = entry.name.clone();
    let rest: Vec<Recent> = list.iter().filter(|r| r.path != path).cloned().collect();
    if let Err(e) = save(file, &rest) {
        eprintln!(
            "starboard: could not save the recent projects to {}: {e}",
            file.display()
        );
    }
    Err(Refusal::new(
        "MovedError",
        format!(
            "{name} is no longer a Starboard project at {path}: it has moved or been deleted, \
             so it was removed from Recent. Use Open folder… to open it where it is now."
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TestDir;

    fn project(d: &TestDir, name: &str) -> PathBuf {
        d.write(&format!("{name}/starboard.yaml"), "version: 1\n");
        std::fs::canonicalize(d.path().join(name)).unwrap()
    }

    fn paths(list: &[Recent]) -> Vec<&str> {
        list.iter().map(|r| r.path.as_str()).collect()
    }

    #[test]
    fn remember_puts_the_newest_first_once() {
        let mut list = Vec::new();
        for i in 0..3 {
            list = remember(&list, &format!("/p/{i}"), &format!("p{i}"), i as f64);
        }
        list = remember(&list, "/p/0", "renamed", 9.0);
        assert_eq!(paths(&list), ["/p/0", "/p/2", "/p/1"]);
        assert_eq!(list[0].name, "renamed");
        assert_eq!(list[0].opened_at, 9.0);
    }

    #[test]
    fn remember_keeps_the_ten_most_recent() {
        let mut list = Vec::new();
        for i in 0..15 {
            list = remember(&list, &format!("/p/{i}"), "p", i as f64);
        }
        assert_eq!(list.len(), MAX_RECENTS);
        assert_eq!(list[0].path, "/p/14");
        assert_eq!(list[9].path, "/p/5");
    }

    #[test]
    fn save_and_load_round_trip() {
        let d = TestDir::new();
        let file = d.path().join("starboard").join("recents.json");
        assert_eq!(load(&file), Vec::new());
        let list = remember(&remember(&[], "/a", "a", 1.0), "/b", "b", 2.0);
        save(&file, &list).unwrap();
        assert_eq!(load(&file), list);
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(text.contains("\"openedAt\""), "{text}");
    }

    #[test]
    fn a_damaged_or_overlong_file_loads_clean() {
        let d = TestDir::new();
        let file = d.path().join("recents.json");
        std::fs::write(&file, "{not json").unwrap();
        assert_eq!(load(&file), Vec::new());
        let many: Vec<Recent> = (0..12)
            .map(|i| Recent {
                path: format!("/p/{}", i % 11),
                name: "p".into(),
                opened_at: 0.0,
            })
            .collect();
        std::fs::write(&file, serde_json::to_string(&many).unwrap()).unwrap();
        let got = load(&file);
        assert_eq!(got.len(), MAX_RECENTS);
        let mut p = paths(&got);
        p.sort();
        p.dedup();
        assert_eq!(p.len(), MAX_RECENTS);
    }

    #[cfg(unix)]
    #[test]
    fn a_project_opened_by_two_names_is_one_recent_entry() {
        let d = TestDir::new();
        let file = d.path().join("cfg/recents.json");
        let real = project(&d, "proj");
        std::os::unix::fs::symlink(d.path().join("proj"), d.path().join("via")).unwrap();
        record(&file, &d.path().join("via"), "via", 1.0).unwrap();
        record(&file, &d.path().join("proj"), "proj", 2.0).unwrap();
        let list = load(&file);
        assert_eq!(paths(&list), [real.to_string_lossy()]);
        assert_eq!(list[0].name, "proj");
    }

    #[test]
    fn reopen_takes_only_a_listed_path() {
        let d = TestDir::new();
        let file = d.path().join("recents.json");
        let a = project(&d, "alpha");
        let other = project(&d, "other");
        record(&file, &a, "alpha", 1.0).unwrap();
        assert_eq!(
            reopen(&file, &a.to_string_lossy()).unwrap(),
            a,
            "a listed project reopens"
        );
        for bad in [
            other.to_string_lossy().into_owned(),
            "/".into(),
            "".into(),
            format!("{}/..", a.to_string_lossy()),
        ] {
            assert_eq!(
                reopen(&file, &bad).unwrap_err().name,
                "NotRecentError",
                "{bad}"
            );
        }
    }

    /// Review Focus 4: a recent project that has moved or been deleted is
    /// said to be gone, and leaves the list; nothing else is opened.
    #[test]
    fn a_moved_or_deleted_project_is_removed_and_reported() {
        let d = TestDir::new();
        let file = d.path().join("recents.json");
        let moved = project(&d, "moved");
        let deleted = project(&d, "deleted");
        let unmade = project(&d, "unmade");
        let kept = project(&d, "kept");
        for (p, n) in [
            (&moved, "moved"),
            (&deleted, "deleted"),
            (&unmade, "unmade"),
            (&kept, "kept"),
        ] {
            record(&file, p, n, 1.0).unwrap();
        }
        std::fs::rename(&moved, d.path().join("elsewhere")).unwrap();
        std::fs::remove_dir_all(&deleted).unwrap();
        // Still a folder, but no longer a Starboard project.
        std::fs::remove_file(unmade.join("starboard.yaml")).unwrap();
        for (p, name) in [
            (&moved, "moved"),
            (&deleted, "deleted"),
            (&unmade, "unmade"),
        ] {
            let err = reopen(&file, &p.to_string_lossy()).unwrap_err();
            assert_eq!(err.name, "MovedError", "{name}");
            assert!(err.message.contains(name), "{}", err.message);
            assert!(
                err.message.contains("removed from Recent"),
                "{}",
                err.message
            );
        }
        assert_eq!(paths(&load(&file)), [kept.to_string_lossy()]);
    }

    /// A folder made at the old path through a link (a different folder
    /// now answering to the listed name) is not opened: the listed path is
    /// canonical, so it must still resolve to itself.
    #[cfg(unix)]
    #[test]
    fn a_listed_path_that_now_leads_elsewhere_is_not_opened() {
        let d = TestDir::new();
        let file = d.path().join("recents.json");
        let a = project(&d, "alpha");
        project(&d, "intruder");
        record(&file, &a, "alpha", 1.0).unwrap();
        std::fs::remove_dir_all(&a).unwrap();
        std::os::unix::fs::symlink(d.path().join("intruder"), &a).unwrap();
        assert_eq!(
            reopen(&file, &a.to_string_lossy()).unwrap_err().name,
            "MovedError"
        );
        assert!(load(&file).is_empty());
    }
}
