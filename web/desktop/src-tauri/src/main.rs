// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

//! Starboard's desktop app: a Tauri window around web/app's desktop build
//! (src/desktop.tsx), whose `tauri` host (web/app/src/host/tauri.ts) reads
//! and writes a project through the commands here. The page names files
//! only as project-relative slash paths under a root the user opened, by
//! its root_id: a root is added only through the folder dialog
//! (open_dialog), a recent project (open_recent) or the folder the app was
//! started with (open_arg), and every path goes through confine. Core runs
//! in the page, as in the browser; Rust does file I/O and nothing else, and
//! runs no process. While a project is open, watch.rs follows its folder
//! and sends files-changed, which runs the page's own check for changes on
//! disk; opening another project moves the watch there.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod confine;
mod fsops;
mod recents;
mod roots;
mod watch;

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;

use crate::recents::Recent;
use crate::roots::Roots;

/// A refusal, as the page receives it: the name of the error (the host's
/// own names, such as DeletionRefusedError, where it has one) and a
/// sentence saying what was refused and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Refusal {
    pub name: String,
    pub message: String,
}

impl Refusal {
    pub fn new(name: &str, message: String) -> Self {
        Self {
            name: name.to_string(),
            message,
        }
    }

    /// invalid_path is web/app's InvalidPathError, word for word.
    pub fn invalid_path(rel: &str) -> Self {
        Self::new(
            "InvalidPathError",
            format!(
                "{} is not a path inside the project; use a relative path written with /.",
                json_string(rel)
            ),
        )
    }

    /// deletion_refused is web/app's DeletionRefusedError, word for word.
    pub fn deletion_refused(rel: &str) -> Self {
        Self::new(
            "DeletionRefusedError",
            format!(
                "Starboard deletes only generated pages, under the content root's generated/ folder; \
                 {rel} was not deleted. Delete it yourself if you meant to."
            ),
        )
    }

    pub fn io(rel: &str, err: &std::io::Error) -> Self {
        Self::new("IoError", format!("{rel}: {err}"))
    }
}

fn json_string(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| s.to_string())
}

/// What opening a folder gives the page: the id it names the root by from
/// then on, and the folder's name for the header.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub root_id: u32,
    pub name: String,
}

/// Desktop is the commands' state and their logic, apart from Tauri so the
/// tests drive it directly.
pub struct Desktop {
    roots: Mutex<Roots>,
    /// Where the recent projects are kept; None when the OS gives no config folder.
    recents_file: Option<PathBuf>,
    /// The folder the app was started with, if any (open_arg).
    arg: Option<PathBuf>,
    /// The watch on the open root, replaced when another is opened.
    watching: Mutex<Option<watch::ProjectWatch>>,
}

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// project_arg is the folder named on the command line: the first argument
/// that is not an option (macOS once passed `-psn_…` to an app it launched).
fn project_arg(args: impl IntoIterator<Item = OsString>) -> Option<PathBuf> {
    args.into_iter()
        .skip(1)
        .find(|a| !a.to_string_lossy().starts_with('-'))
        .map(PathBuf::from)
}

impl Desktop {
    pub fn new(recents_file: Option<PathBuf>, arg: Option<PathBuf>) -> Self {
        Self {
            roots: Mutex::new(Roots::default()),
            recents_file,
            arg,
            watching: Mutex::new(None),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Roots> {
        // A panic elsewhere never leaves the list half changed: each change is one push or one field.
        self.roots.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// root is the canonical path of the root id names.
    fn root(&self, id: u32) -> Result<PathBuf, Refusal> {
        Ok(self.lock().get(id)?.path.clone())
    }

    /// open adds the folder at path as a root, once it is seen to be a
    /// Starboard project (it holds starboard.yaml), and puts it first in
    /// the recent projects. Only open_dialog, open_recent and open_arg
    /// call it: each is a folder the user named.
    fn open(&self, path: &Path) -> Result<Opened, Refusal> {
        let root = roots::open_project(path)?;
        if let Some(file) = &self.recents_file {
            // Not remembering it is no reason to refuse the folder.
            if let Err(e) = recents::record(file, &root.path, &root.name, now_ms()) {
                eprintln!(
                    "starboard: could not save the recent projects to {}: {e}",
                    file.display()
                );
            }
        }
        let name = root.name.clone();
        let root_id = self.lock().add(root);
        Ok(Opened { root_id, name })
    }

    /// open_recent opens path, which must be one of the recent projects;
    /// one that has moved or gone is taken off the list, and said to be.
    fn open_recent(&self, path: &str) -> Result<Opened, Refusal> {
        let file = self.recents_file.as_deref().ok_or_else(|| {
            Refusal::new(
                "NotRecentError",
                "This system gives Starboard no settings folder, so it keeps no recent projects; \
                 open the folder with Open folder… instead."
                    .to_string(),
            )
        })?;
        let real = recents::reopen(file, path)?;
        self.open(&real)
    }

    /// open_arg opens the folder the app was started with, if any.
    fn open_arg(&self) -> Result<Option<Opened>, Refusal> {
        match &self.arg {
            None => Ok(None),
            Some(p) => self.open(p).map(Some),
        }
    }

    /// watch follows root id, the one the window now has open, in place of
    /// any other: the old watch stops first, so no two run and the old
    /// project sends nothing more. A watch that cannot start is reported
    /// and left out; the project still opens, and the window-focus check
    /// still sees changes.
    fn watch(&self, id: u32, sink: &watch::Sink) -> Result<(), Refusal> {
        let root = self.root(id)?;
        let mut watching = self.watching.lock().unwrap_or_else(|e| e.into_inner());
        *watching = None;
        *watching = watch::watch_project(root.clone(), sink.clone())
            .map_err(|e| eprintln!("starboard: could not watch {}: {e}", root.display()))
            .ok();
        Ok(())
    }

    fn recents(&self) -> Vec<Recent> {
        self.recents_file
            .as_deref()
            .map(recents::load)
            .unwrap_or_default()
    }

    fn list(&self, id: u32, dir: Option<&str>) -> Result<Vec<String>, Refusal> {
        fsops::list(&self.root(id)?, dir.unwrap_or("."))
    }

    fn read_text(&self, id: u32, path: &str) -> Result<Option<String>, Refusal> {
        fsops::read_text(&self.root(id)?, path)
    }

    fn stat(&self, id: u32, path: &str) -> Result<Option<fsops::Stamp>, Refusal> {
        fsops::stat(&self.root(id)?, path)
    }

    /// write writes under the content root Rust reads from starboard.yaml
    /// on disk now (so an editor's change to it counts at once); the page
    /// names none, cannot move it (fsops::write), and when Rust cannot read
    /// it for certain, nothing is written.
    fn write(&self, id: u32, changes: &BTreeMap<String, Option<String>>) -> Result<(), Refusal> {
        let root = self.root(id)?;
        let content = roots::read_content(&root)?;
        fsops::write(&root, &content, changes)
    }
}

// ---------------------------------------------------------------------
// The commands. Each is async, so Tauri runs it off the main thread and
// file I/O never stalls the window.

type Reply<T> = Result<T, Refusal>;

/// sink sends the watcher's news to the page: files-changed, with no payload.
fn sink<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> watch::Sink {
    use tauri::Emitter;
    let app = app.clone();
    Arc::new(move || {
        if let Err(e) = app.emit(watch::FILES_CHANGED, ()) {
            eprintln!("starboard: could not send {}: {e}", watch::FILES_CHANGED);
        }
    })
}

/// opened watches the root just opened, and gives it to the page.
fn opened<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    desktop: &Desktop,
    o: Opened,
) -> Reply<Opened> {
    desktop.watch(o.root_id, &sink(app))?;
    Ok(o)
}

/// open_dialog asks the user for a project folder with the native dialog;
/// null when they cancel.
#[tauri::command]
async fn open_dialog<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    desktop: tauri::State<'_, Desktop>,
) -> Reply<Option<Opened>> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app
        .dialog()
        .file()
        .set_title("Open a Starboard project")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| Refusal::new("IoError", e.to_string()))?;
    opened(&app, &desktop, desktop.open(&path)?).map(Some)
}

#[tauri::command]
async fn open_recent<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    desktop: tauri::State<'_, Desktop>,
    path: String,
) -> Reply<Opened> {
    opened(&app, &desktop, desktop.open_recent(&path)?)
}

#[tauri::command]
async fn open_arg<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    desktop: tauri::State<'_, Desktop>,
) -> Reply<Option<Opened>> {
    match desktop.open_arg()? {
        Some(o) => opened(&app, &desktop, o).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
async fn recents(desktop: tauri::State<'_, Desktop>) -> Reply<Vec<Recent>> {
    Ok(desktop.recents())
}

/// list is every file under dir (the whole root when none), as web/app's
/// hosts walk a folder core.scope asks for.
#[tauri::command]
async fn list(
    desktop: tauri::State<'_, Desktop>,
    root_id: u32,
    dir: Option<String>,
) -> Reply<Vec<String>> {
    desktop.list(root_id, dir.as_deref())
}

#[tauri::command]
async fn read_text(
    desktop: tauri::State<'_, Desktop>,
    root_id: u32,
    path: String,
) -> Reply<Option<String>> {
    desktop.read_text(root_id, &path)
}

#[tauri::command]
async fn stat(
    desktop: tauri::State<'_, Desktop>,
    root_id: u32,
    path: String,
) -> Reply<Option<fsops::Stamp>> {
    desktop.stat(root_id, &path)
}

#[tauri::command]
async fn write(
    desktop: tauri::State<'_, Desktop>,
    root_id: u32,
    changes: BTreeMap<String, Option<String>>,
) -> Reply<()> {
    desktop.write(root_id, &changes)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            app.manage(Desktop::new(
                recents::recents_file(),
                project_arg(std::env::args_os()),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_dialog,
            open_recent,
            open_arg,
            recents,
            list,
            read_text,
            stat,
            write
        ])
        .run(tauri::generate_context!())
        .expect("error while running Starboard");
}

#[cfg(test)]
pub mod testdir {
    //! TestDir is a fresh folder under the system's temporary folder,
    //! removed when it is dropped.

    use std::path::{Path, PathBuf};

    pub struct TestDir(PathBuf);

    impl Default for TestDir {
        fn default() -> Self {
            Self::new()
        }
    }

    impl TestDir {
        pub fn new() -> Self {
            use std::hash::{BuildHasher, Hasher};
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u32(std::process::id());
            let dir =
                std::env::temp_dir().join(format!("starboard-desktop-test-{:016x}", h.finish()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        pub fn path(&self) -> &Path {
            &self.0
        }

        pub fn write(&self, rel: &str, text: &str) {
            let p = self.0.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text).unwrap();
        }

        pub fn read(&self, rel: &str) -> String {
            std::fs::read_to_string(self.0.join(rel)).unwrap()
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            // A test may leave a folder read-only; make it writable to remove it.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fn open_up(p: &Path) {
                    let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755));
                    if let Ok(entries) = std::fs::read_dir(p) {
                        for e in entries.flatten() {
                            if e.file_type().is_ok_and(|t| t.is_dir()) {
                                open_up(&e.path());
                            }
                        }
                    }
                }
                open_up(&self.0);
            }
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TestDir;

    fn project(d: &TestDir, name: &str) -> PathBuf {
        d.write(&format!("{name}/starboard.yaml"), "version: 1\n");
        d.path().join(name)
    }

    fn one(path: &str, text: Option<&str>) -> BTreeMap<String, Option<String>> {
        [(path.to_string(), text.map(str::to_string))].into()
    }

    #[test]
    fn opening_a_project_gives_a_root_id_and_remembers_it() {
        let d = TestDir::new();
        let desk = Desktop::new(Some(d.path().join("cfg/recents.json")), None);
        let a = desk.open(&project(&d, "alpha")).unwrap();
        assert_eq!(
            a,
            Opened {
                root_id: 0,
                name: "alpha".into()
            }
        );
        let b = desk.open(&project(&d, "beta")).unwrap();
        assert_eq!(b.root_id, 1);
        // The same folder again keeps its id, and moves up the list.
        assert_eq!(desk.open(&d.path().join("alpha")).unwrap().root_id, 0);
        let names: Vec<String> = desk.recents().into_iter().map(|r| r.name).collect();
        assert_eq!(names, ["alpha", "beta"]);
        let canonical = std::fs::canonicalize(d.path().join("alpha")).unwrap();
        assert_eq!(desk.recents()[0].path, canonical.to_string_lossy());
    }

    #[test]
    fn a_folder_without_starboard_yaml_is_refused_and_not_remembered() {
        let d = TestDir::new();
        d.write("plain/readme.md", "x");
        let desk = Desktop::new(Some(d.path().join("recents.json")), None);
        assert_eq!(
            desk.open(&d.path().join("plain")).unwrap_err().name,
            "NoProjectError"
        );
        assert!(desk.recents().is_empty());
        assert!(desk.list(0, None).is_err());
    }

    #[test]
    fn open_recent_takes_only_a_listed_path_and_drops_one_that_has_gone() {
        let d = TestDir::new();
        let file = d.path().join("recents.json");
        let desk = Desktop::new(Some(file.clone()), None);
        let p = project(&d, "alpha");
        assert_eq!(
            desk.open_recent(&p.to_string_lossy()).unwrap_err().name,
            "NotRecentError"
        );
        desk.open(&p).unwrap();
        desk.open(&project(&d, "beta")).unwrap();
        let listed = desk.recents()[1].path.clone();
        // A fresh session: the list is read from the file.
        let later = Desktop::new(Some(file.clone()), None);
        let o = later.open_recent(&listed).unwrap();
        assert_eq!(o.name, "alpha");
        assert_eq!(
            later
                .read_text(o.root_id, "starboard.yaml")
                .unwrap()
                .as_deref(),
            Some("version: 1\n")
        );
        // Gone: said so, and off the list.
        std::fs::remove_dir_all(&p).unwrap();
        assert_eq!(later.open_recent(&listed).unwrap_err().name, "MovedError");
        let names: Vec<String> = later.recents().into_iter().map(|r| r.name).collect();
        assert_eq!(names, ["beta"]);
        // With no settings folder there is no list to reopen from.
        assert_eq!(
            Desktop::new(None, None)
                .open_recent(&listed)
                .unwrap_err()
                .name,
            "NotRecentError"
        );
    }

    #[test]
    fn open_arg_opens_the_folder_the_app_was_started_with() {
        let d = TestDir::new();
        let p = project(&d, "alpha");
        assert_eq!(Desktop::new(None, None).open_arg().unwrap(), None);
        let desk = Desktop::new(None, Some(p.clone()));
        assert_eq!(desk.open_arg().unwrap().unwrap().name, "alpha");
        // Asked again, the same root.
        assert_eq!(desk.open_arg().unwrap().unwrap().root_id, 0);
        d.write("plain/x.md", "x");
        assert_eq!(
            Desktop::new(None, Some(d.path().join("plain")))
                .open_arg()
                .unwrap_err()
                .name,
            "NoProjectError"
        );
    }

    #[test]
    fn the_project_argument_is_the_first_that_is_not_an_option() {
        let args = |a: &[&str]| project_arg(a.iter().map(OsString::from));
        assert_eq!(args(&["starboard"]), None);
        assert_eq!(args(&["starboard", "proj"]), Some(PathBuf::from("proj")));
        assert_eq!(
            args(&["starboard", "-psn_0_123", "/a/proj"]),
            Some(PathBuf::from("/a/proj"))
        );
    }

    #[test]
    fn an_unknown_root_id_is_refused_by_every_command() {
        let d = TestDir::new();
        let desk = Desktop::new(None, None);
        desk.open(&project(&d, "alpha")).unwrap();
        assert_eq!(desk.list(7, None).unwrap_err().name, "UnknownRootError");
        assert!(desk.read_text(7, "starboard.yaml").is_err());
        assert!(desk.stat(7, "starboard.yaml").is_err());
        assert!(desk.write(7, &BTreeMap::new()).is_err());
    }

    /// Review Focus 1, through every command.
    #[test]
    fn every_command_refuses_a_path_that_escapes_the_root() {
        let d = TestDir::new();
        d.write("secret.txt", "secret");
        let desk = Desktop::new(None, None);
        let id = desk.open(&project(&d, "alpha")).unwrap().root_id;
        for bad in [
            "../secret.txt",
            "/etc/hosts",
            "C:\\x",
            "\\\\?\\C:\\x",
            "a\\b",
        ] {
            assert!(desk.list(id, Some(bad)).is_err(), "{bad}");
            assert!(desk.read_text(id, bad).is_err(), "{bad}");
            assert!(desk.stat(id, bad).is_err(), "{bad}");
            assert!(desk.write(id, &one(bad, Some("x"))).is_err(), "{bad}");
            assert!(desk.write(id, &one(bad, None)).is_err(), "{bad}");
        }
        assert_eq!(d.read("secret.txt"), "secret");
    }

    /// Review Focus 1: a link inside the root that points out, through every command.
    #[cfg(unix)]
    #[test]
    fn every_command_refuses_a_link_that_points_out() {
        let outside = TestDir::new();
        outside.write("secret.yaml", "secret");
        let d = TestDir::new();
        let p = project(&d, "alpha");
        d.write("alpha/docs/flows/generated/.keep", "");
        std::os::unix::fs::symlink(outside.path(), p.join("docs/flows/out")).unwrap();
        std::os::unix::fs::symlink(outside.path(), p.join("docs/flows/generated/out")).unwrap();
        let desk = Desktop::new(None, None);
        let id = desk.open(&p).unwrap().root_id;
        assert!(desk.list(id, Some("docs/flows/out")).is_err());
        assert!(desk.read_text(id, "docs/flows/out/secret.yaml").is_err());
        assert!(desk.stat(id, "docs/flows/out/secret.yaml").is_err());
        assert!(desk
            .write(id, &one("docs/flows/out/secret.yaml", Some("pwned")))
            .is_err());
        assert!(desk
            .write(id, &one("docs/flows/generated/out/secret.yaml", None))
            .is_err());
        assert_eq!(outside.read("secret.yaml"), "secret");
    }

    /// Review Focus 2, through the write command: the page's own check skipped.
    #[test]
    fn a_deletion_outside_generated_is_refused_whatever_the_page_asks() {
        let d = TestDir::new();
        let p = project(&d, "alpha");
        d.write("alpha/docs/flows/screens.yaml", "keep");
        d.write("alpha/docs/flows/generated/x.md", "gen");
        let desk = Desktop::new(None, None);
        let id = desk.open(&p).unwrap().root_id;
        for bad in ["starboard.yaml", "docs/flows/screens.yaml"] {
            assert_eq!(
                desk.write(id, &one(bad, None)).unwrap_err().name,
                "DeletionRefusedError",
                "{bad}"
            );
        }
        assert_eq!(d.read("alpha/starboard.yaml"), "version: 1\n");
        desk.write(id, &one("docs/flows/generated/x.md", None))
            .unwrap();
        assert!(!p.join("docs/flows/generated/x.md").exists());
    }

    #[test]
    fn a_content_line_read_unclearly_refuses_every_write_and_says_to_use_the_cli() {
        let d = TestDir::new();
        let p = project(&d, "alpha");
        d.write("alpha/starboard.yaml", "version: 1\ncontent: \"docs\"\n");
        let desk = Desktop::new(None, None);
        // The project opens, to be read; nothing may be written.
        let id = desk.open(&p).unwrap().root_id;
        assert!(desk.read_text(id, "starboard.yaml").unwrap().is_some());
        for rel in ["docs/a.md", "docs/flows/a.md", "starboard.yaml"] {
            let err = desk.write(id, &one(rel, Some("x"))).unwrap_err();
            assert_eq!(err.name, "ContentUnreadError", "{rel}");
            assert!(err.message.contains("starboard CLI"), "{}", err.message);
        }
        assert!(!p.join("docs").exists());
    }

    /// D2: an editor's change to content: on disk bounds the next write, with no reopen.
    #[test]
    fn a_write_is_checked_against_the_content_on_disk_now() {
        let d = TestDir::new();
        let p = project(&d, "alpha");
        let desk = Desktop::new(None, None);
        let id = desk.open(&p).unwrap().root_id;
        desk.write(id, &one("docs/flows/a.yaml", Some("x")))
            .unwrap();
        d.write("alpha/starboard.yaml", "version: 1\ncontent: screens\n");
        assert_eq!(
            desk.write(id, &one("docs/flows/b.yaml", Some("x")))
                .unwrap_err()
                .name,
            "OutsideContentError"
        );
        desk.write(id, &one("screens/b.yaml", Some("x"))).unwrap();
        // And an outside edit Rust cannot read for certain stops every write.
        d.write("alpha/starboard.yaml", "version: 1\ncontent: 'screens'\n");
        assert_eq!(
            desk.write(id, &one("screens/c.yaml", Some("x")))
                .unwrap_err()
                .name,
            "ContentUnreadError"
        );
    }

    /// D2: the page cannot move the content root by writing starboard.yaml
    /// and reopening the project itself; the sequence stops at its first step.
    #[test]
    fn the_page_cannot_move_the_content_root_by_writing_starboard_yaml_and_reopening() {
        let d = TestDir::new();
        let file = d.path().join("recents.json");
        let p = project(&d, "alpha");
        d.write("alpha/src/main.rs", "fn main() {}\n");
        let desk = Desktop::new(Some(file), None);
        let id = desk.open(&p).unwrap().root_id;
        let err = desk
            .write(
                id,
                &one("starboard.yaml", Some("version: 1\ncontent: src\n")),
            )
            .unwrap_err();
        assert_eq!(err.name, "ContentChangeError");
        assert_eq!(d.read("alpha/starboard.yaml"), "version: 1\n");
        let listed = desk.recents()[0].path.clone();
        let again = desk.open_recent(&listed).unwrap().root_id;
        assert_eq!(
            desk.write(again, &one("src/notes.md", Some("pwned")))
                .unwrap_err()
                .name,
            "OutsideContentError"
        );
        assert!(!p.join("src/notes.md").exists());
        assert_eq!(
            desk.write(again, &one("src/generated/x.md", None))
                .unwrap_err()
                .name,
            "DeletionRefusedError"
        );
        assert_eq!(d.read("alpha/src/main.rs"), "fn main() {}\n");
    }

    /// D5, the reviewer's repro: a starboard.yaml linked into the content
    /// root would let a write under content move the content root.
    #[cfg(unix)]
    #[test]
    fn a_linked_starboard_yaml_is_refused_at_open_and_at_the_next_write() {
        let d = TestDir::new();
        let file = d.path().join("recents.json");
        let p = project(&d, "alpha");
        d.write("alpha/src/main.rs", "fn main() {}\n");
        let desk = Desktop::new(Some(file.clone()), Some(p.clone()));
        let id = desk.open(&p).unwrap().root_id;
        let listed = desk.recents()[0].path.clone();
        // The link appears after the project was opened.
        d.write(
            "alpha/docs/flows/starboard.yaml",
            "version: 1\ncontent: docs/flows\n",
        );
        std::fs::remove_file(p.join("starboard.yaml")).unwrap();
        std::os::unix::fs::symlink(
            p.join("docs/flows/starboard.yaml"),
            p.join("starboard.yaml"),
        )
        .unwrap();
        for (rel, text) in [
            (
                "docs/flows/starboard.yaml",
                Some("version: 1\ncontent: src\n"),
            ),
            ("src/main.rs", Some("pwned")),
            ("docs/flows/screens.yaml", Some("x")),
        ] {
            assert_eq!(
                desk.write(id, &one(rel, text)).unwrap_err().name,
                "ConfigLinkError",
                "{rel}"
            );
        }
        assert_eq!(
            d.read("alpha/docs/flows/starboard.yaml"),
            "version: 1\ncontent: docs/flows\n"
        );
        assert_eq!(d.read("alpha/src/main.rs"), "fn main() {}\n");
        assert!(!p.join("docs/flows/screens.yaml").exists());
        // Every way in refuses it.
        assert_eq!(desk.open(&p).unwrap_err().name, "ConfigLinkError");
        assert_eq!(desk.open_arg().unwrap_err().name, "ConfigLinkError");
        assert_eq!(
            desk.open_recent(&listed).unwrap_err().name,
            "ConfigLinkError"
        );
    }

    /// D5, the variant: a starboard.yaml linked into <content>/generated/,
    /// whose target a deletion would remove and a write remake.
    #[cfg(unix)]
    #[test]
    fn a_starboard_yaml_linked_into_generated_cannot_be_deleted_and_remade() {
        let d = TestDir::new();
        let p = project(&d, "alpha");
        let desk = Desktop::new(None, None);
        let id = desk.open(&p).unwrap().root_id;
        d.write("alpha/docs/flows/generated/cfg.yaml", "version: 1\n");
        std::fs::remove_file(p.join("starboard.yaml")).unwrap();
        std::os::unix::fs::symlink(
            p.join("docs/flows/generated/cfg.yaml"),
            p.join("starboard.yaml"),
        )
        .unwrap();
        assert_eq!(
            desk.write(id, &one("docs/flows/generated/cfg.yaml", None))
                .unwrap_err()
                .name,
            "ConfigLinkError"
        );
        assert_eq!(
            desk.write(
                id,
                &one(
                    "docs/flows/generated/cfg.yaml",
                    Some("version: 1\ncontent: src\n")
                )
            )
            .unwrap_err()
            .name,
            "ConfigLinkError"
        );
        assert_eq!(
            d.read("alpha/docs/flows/generated/cfg.yaml"),
            "version: 1\n"
        );
    }

    /// D7/D8, the reviewer's end-to-end repro: whatever an author-crafted
    /// starboard.yaml makes Rust read as content, code is never written.
    #[test]
    fn an_author_crafted_content_root_never_lets_the_page_write_code() {
        let d = TestDir::new();
        for (name, yaml) in [
            // core reads docs/flows here; the scan once read src.
            (
                "crafted",
                "version: 1\nplatforms:\n  web:\n    roots:\n      - a - \"b\n      - \"d\ncontent: src\n# e\"\n",
            ),
            // The author could always have said so plainly.
            ("plain", "version: 1\ncontent: src\n"),
        ] {
            let p = project(&d, name);
            d.write(&format!("{name}/starboard.yaml"), yaml);
            d.write(&format!("{name}/src/main.rs"), "fn main() {}\n");
            let desk = Desktop::new(None, None);
            let id = desk.open(&p).unwrap().root_id;
            let err = desk
                .write(id, &one("src/main.rs", Some("pwned")))
                .unwrap_err();
            assert!(
                matches!(err.name.as_str(), "FileTypeError" | "ContentUnreadError"),
                "{name}: {}",
                err.name
            );
            assert_eq!(d.read(&format!("{name}/src/main.rs")), "fn main() {}\n");
        }
    }

    #[test]
    fn writes_go_only_where_core_writes_under_the_content_root_rust_read() {
        let d = TestDir::new();
        let p = project(&d, "alpha");
        d.write("alpha/starboard.yaml", "version: 1\ncontent: screens\n");
        d.write("alpha/.git/config", "[core]\n");
        let desk = Desktop::new(None, None);
        let id = desk.open(&p).unwrap().root_id;
        for forged in [
            ".git/config",
            ".GIT/config",
            "src/app.rs",
            "docs/flows/a.md",
        ] {
            assert!(
                desk.write(id, &one(forged, Some("pwned"))).is_err(),
                "{forged}"
            );
        }
        assert_eq!(d.read("alpha/.git/config"), "[core]\n");
        desk.write(id, &one("screens/screens.yaml", Some("x")))
            .unwrap();
        assert_eq!(d.read("alpha/screens/screens.yaml"), "x");
    }

    #[test]
    fn refusals_and_answers_serialize_as_the_page_reads_them() {
        let v = serde_json::to_value(Refusal::deletion_refused("docs/a.md")).unwrap();
        assert_eq!(v["name"], "DeletionRefusedError");
        assert!(v["message"]
            .as_str()
            .unwrap()
            .contains("docs/a.md was not deleted"));
        let o = serde_json::to_value(Opened {
            root_id: 3,
            name: "x".into(),
        })
        .unwrap();
        assert_eq!(o, serde_json::json!({"rootId": 3, "name": "x"}));
        let s = serde_json::to_value(fsops::Stamp {
            mtime: 1.5,
            size: 2,
        })
        .unwrap();
        assert_eq!(s, serde_json::json!({"mtime": 1.5, "size": 2}));
    }

    /// The watcher follows the open root: watching another stops the old
    /// one, so a change there sends nothing, and a change in the new one
    /// sends files-changed.
    #[test]
    fn watching_another_project_stops_the_old_watcher() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::time::{Duration, Instant};
        let d = TestDir::new();
        let desk = Desktop::new(None, None);
        let a = desk.open(&project(&d, "alpha")).unwrap().root_id;
        let b = desk.open(&project(&d, "beta")).unwrap().root_id;
        let count = Arc::new(AtomicUsize::new(0));
        let c = count.clone();
        let sink: watch::Sink = Arc::new(move || {
            c.fetch_add(1, Ordering::SeqCst);
        });
        desk.watch(a, &sink).unwrap();
        desk.watch(b, &sink).unwrap();
        assert!(desk.watch(9, &sink).is_err());
        // FSEvents can deliver the writes made just before the watch began:
        // wait for a quiet second (at most ten), then forget them.
        let start = Instant::now();
        let (mut seen, mut quiet) = (usize::MAX, Instant::now());
        while start.elapsed().as_secs() < 10 {
            let n = count.load(Ordering::SeqCst);
            if n != seen {
                (seen, quiet) = (n, Instant::now());
            } else if quiet.elapsed().as_secs() >= 1 {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        count.store(0, Ordering::SeqCst);
        d.write("alpha/docs/flows/screens.yaml", "screens: {}\n");
        std::thread::sleep(Duration::from_millis(1200));
        assert_eq!(count.load(Ordering::SeqCst), 0);
        d.write("beta/docs/flows/screens.yaml", "screens: {}\n");
        let start = Instant::now();
        while count.load(Ordering::SeqCst) == 0 && start.elapsed().as_secs() < 10 {
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
}
