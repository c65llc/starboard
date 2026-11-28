// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

//! watch follows the project the window has open, on `notify`, and says
//! when it changed: files-changed, with no payload, once things have been
//! quiet for DEBOUNCE (or MAX_WAIT has passed on a project that never goes
//! quiet). The page then runs the web app's own external-change check
//! (state.ts checkDisk), whose stamps decide whether anything changed: the
//! app's own writes have already updated them, so they reload nothing, and
//! this module need not tell them apart.
//!
//! `.git` and `node_modules` are never news. Where the OS watches a tree as
//! one (FSEvents, ReadDirectoryChangesW) their events are filtered; where
//! it watches folder by folder (inotify, kqueue) they are never registered
//! at all, and a folder made later is registered when its creation is seen
//! (WatchMode). A change under node_modules shows on the next window focus.

use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher};

use crate::confine::is_git;

/// How long the project must be quiet before files-changed is emitted.
pub const DEBOUNCE: Duration = Duration::from_millis(200);

/// The longest files-changed waits on a project that never goes quiet.
pub const MAX_WAIT: Duration = Duration::from_secs(2);

/// The event the page is sent when the project changed on disk.
pub const FILES_CHANGED: &str = "files-changed";

/// Where the watcher's news goes: main.rs emits files-changed; tests count.
pub type Sink = Arc<dyn Fn() + Send + Sync>;

/// is_skipped_dir reports whether a folder of this name is never watched:
/// `.git` (in any case, as confine::is_git) and node_modules.
pub fn is_skipped_dir(name: &str) -> bool {
    is_git(name) || name == "node_modules"
}

/// relative is path under root as its names, or None when it is not under root.
fn relative(root: &Path, path: &Path) -> Option<Vec<String>> {
    let rest = path.strip_prefix(root).ok()?;
    let mut names = Vec::new();
    for c in rest.components() {
        match c {
            Component::Normal(s) => names.push(s.to_string_lossy().into_owned()),
            _ => return None,
        }
    }
    Some(names)
}

/// is_news reports whether a change at path is the page's business: under
/// root, not the root itself, and in no skipped folder. A path outside root
/// (a watcher may name one by another spelling, /private/var for /var)
/// counts, unless it passes through a skipped folder.
pub fn is_news(root: &Path, path: &Path) -> bool {
    match relative(root, path) {
        Some(names) => !names.is_empty() && !names.iter().any(|n| is_skipped_dir(n)),
        None => !path
            .components()
            .any(|c| matches!(c, Component::Normal(s) if is_skipped_dir(&s.to_string_lossy()))),
    }
}

/// Debounce is the trailing debounce of the project's news: it fires once
/// DEBOUNCE has passed since the last news, or MAX_WAIT since the first
/// news it has not fired for, and not again without more.
#[derive(Debug, Default)]
pub struct Debounce {
    first: Option<Instant>,
    last: Option<Instant>,
}

impl Debounce {
    pub fn news(&mut self, now: Instant) {
        self.first.get_or_insert(now);
        self.last = Some(now);
    }

    /// wait is how long until it may fire, or None when nothing is pending.
    pub fn wait(&self, now: Instant) -> Option<Duration> {
        let (first, last) = (self.first?, self.last?);
        let quiet = DEBOUNCE.saturating_sub(now.saturating_duration_since(last));
        let most = MAX_WAIT.saturating_sub(now.saturating_duration_since(first));
        Some(quiet.min(most))
    }

    /// fire reports whether the quiet spell (or the longest wait) is over, and clears it if so.
    pub fn fire(&mut self, now: Instant) -> bool {
        if self.wait(now) == Some(Duration::ZERO) {
            *self = Self::default();
            return true;
        }
        false
    }
}

/// How the watcher registers the root.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchMode {
    /// One recursive watch, where the OS watches a tree as one (FSEvents,
    /// ReadDirectoryChangesW): the skipped folders' events are filtered.
    Recursive,
    /// A watch per folder, where the OS watches folder by folder (inotify,
    /// kqueue): the skipped folders are never registered, and a folder
    /// made later is registered when its creation is seen.
    PerFolder,
}

impl WatchMode {
    /// The mode for this OS.
    pub fn native() -> Self {
        if cfg!(any(target_os = "macos", windows)) {
            Self::Recursive
        } else {
            Self::PerFolder
        }
    }
}

/// watch_tree registers dir and every folder under it but the skipped
/// ones, each without recursion. A link is not followed: confine keeps
/// every command inside the root, and a linked folder's changes show on
/// the next window focus.
fn watch_tree(watcher: &mut notify::RecommendedWatcher, dir: &Path) {
    if let Err(e) = watcher.watch(dir, RecursiveMode::NonRecursive) {
        eprintln!("starboard: could not watch {}: {e}", dir.display());
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
        if is_dir && !is_skipped_dir(&entry.file_name().to_string_lossy()) {
            watch_tree(watcher, &entry.path());
        }
    }
}

/// register_new_folders watches each folder among paths made under root,
/// and those under it, unless it is (or is in) a skipped folder.
fn register_new_folders(
    watcher: &Mutex<notify::RecommendedWatcher>,
    root: &Path,
    paths: &[PathBuf],
) {
    for path in paths {
        let in_skipped =
            relative(root, path).is_none_or(|names| names.iter().any(|n| is_skipped_dir(n)));
        let is_dir = std::fs::symlink_metadata(path).is_ok_and(|m| m.is_dir());
        if is_dir && !in_skipped {
            watch_tree(&mut watcher.lock().unwrap_or_else(|e| e.into_inner()), path);
        }
    }
}

/// ProjectWatch watches an opened root until it is dropped. Dropping it
/// stops the watch: once drop returns, nothing more is sent, not even a
/// change that was still being debounced.
pub struct ProjectWatch {
    /// Set when the watch stops; the thread sends only while holding it unset.
    stopped: Arc<Mutex<bool>>,
    _watcher: Arc<Mutex<notify::RecommendedWatcher>>,
}

impl Drop for ProjectWatch {
    fn drop(&mut self) {
        // Waits for a send in progress, so none starts after this.
        *self.stopped.lock().unwrap_or_else(|e| e.into_inner()) = true;
        // The watcher drops with self, which drops the channel's sender
        // and ends the thread.
    }
}

/// watch_project watches root, in the OS's own mode, sending to sink once
/// a change other than one in a skipped folder has been followed by
/// DEBOUNCE of quiet (or MAX_WAIT has passed).
pub fn watch_project(root: PathBuf, sink: Sink) -> notify::Result<ProjectWatch> {
    watch_project_in(WatchMode::native(), root, sink)
}

/// watch_project_in is watch_project in the mode given.
pub fn watch_project_in(
    mode: WatchMode,
    root: PathBuf,
    sink: Sink,
) -> notify::Result<ProjectWatch> {
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(move |res| {
        // The receiver is gone only once the watch has stopped.
        let _ = tx.send(res);
    })?;
    match mode {
        WatchMode::Recursive => watcher.watch(&root, RecursiveMode::Recursive)?,
        WatchMode::PerFolder => {
            watcher.watch(&root, RecursiveMode::NonRecursive)?;
            watch_tree(&mut watcher, &root);
        }
    }
    let watcher = Arc::new(Mutex::new(watcher));
    // The thread holds the watcher only weakly (to register new folders),
    // so dropping the ProjectWatch drops it.
    let weak = Arc::downgrade(&watcher);
    let stopped = Arc::new(Mutex::new(false));
    let thread_stopped = stopped.clone();
    std::thread::Builder::new()
        .name("starboard-watch".into())
        .spawn(move || {
            let mut debounce = Debounce::default();
            loop {
                let wait = debounce
                    .wait(Instant::now())
                    .unwrap_or(Duration::from_secs(3600));
                match rx.recv_timeout(wait) {
                    Ok(Ok(event)) => {
                        if matches!(event.kind, EventKind::Access(_)) {
                            continue;
                        }
                        if event.paths.iter().any(|p| is_news(&root, p)) {
                            debounce.news(Instant::now());
                        }
                        if mode == WatchMode::PerFolder
                            && matches!(event.kind, EventKind::Create(_))
                        {
                            if let Some(w) = weak.upgrade() {
                                register_new_folders(&w, &root, &event.paths);
                            }
                        }
                    }
                    Ok(Err(e)) => eprintln!("starboard: the project's watcher failed: {e}"),
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => return,
                }
                if debounce.fire(Instant::now()) {
                    let stopped = thread_stopped.lock().unwrap_or_else(|e| e.into_inner());
                    if *stopped {
                        return;
                    }
                    sink();
                }
            }
        })
        .map_err(notify::Error::io)?;
    Ok(ProjectWatch {
        stopped,
        _watcher: watcher,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testdir::TestDir;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn git_and_node_modules_are_skipped_in_any_case_git_is_written() {
        for skipped in [".git", ".GIT", ".git.", "node_modules"] {
            assert!(is_skipped_dir(skipped), "{skipped}");
        }
        for kept in [".github", "git", "docs", "node_modules_old", "Node_Modules"] {
            assert!(!is_skipped_dir(kept), "{kept}");
        }
    }

    #[test]
    fn news_is_any_change_but_one_in_git_or_node_modules() {
        let root = Path::new("/p/proj");
        let news = |p: &str| is_news(root, Path::new(p));
        assert!(news("/p/proj/docs/flows/screens.yaml"));
        assert!(news("/p/proj/starboard.yaml"));
        assert!(news("/p/proj/docs/flows/screens.yaml.starboard-tmp-0123"));
        // A path the OS spells another way (/private/var for /var) counts.
        assert!(news("/elsewhere/proj/docs/x.md"));
        assert!(!news("/p/proj/.git/index"));
        assert!(!news("/p/proj/.GIT/HEAD"));
        assert!(!news("/p/proj/node_modules/x/package.json"));
        assert!(!news("/p/proj/app/node_modules/kit/Card.tsx"));
        assert!(!news("/other/.git/x"));
        // The root itself (its own metadata) is not.
        assert!(!news("/p/proj"));
    }

    #[test]
    fn debounce_fires_once_after_a_quiet_spell() {
        let t0 = Instant::now();
        let ms = Duration::from_millis;
        let mut d = Debounce::default();
        assert_eq!(d.wait(t0), None);
        assert!(!d.fire(t0));
        d.news(t0);
        d.news(t0 + ms(150));
        // DEBOUNCE after the first, but not after the last: not yet.
        assert!(!d.fire(t0 + ms(200)));
        assert_eq!(d.wait(t0 + ms(200)), Some(ms(150)));
        assert!(d.fire(t0 + ms(350)));
        // Once, and not again without more news.
        assert!(!d.fire(t0 + ms(900)));
        assert_eq!(d.wait(t0 + ms(900)), None);
    }

    #[test]
    fn debounce_fires_by_max_wait_when_the_project_never_goes_quiet() {
        let t0 = Instant::now();
        let mut d = Debounce::default();
        let mut t = t0;
        while t < t0 + MAX_WAIT {
            d.news(t);
            assert!(!d.fire(t));
            t += Duration::from_millis(100);
        }
        d.news(t0 + MAX_WAIT);
        assert!(d.fire(t0 + MAX_WAIT));
    }

    #[test]
    fn each_os_watches_in_its_own_mode() {
        let want = if cfg!(any(target_os = "macos", windows)) {
            WatchMode::Recursive
        } else {
            WatchMode::PerFolder
        };
        assert_eq!(WatchMode::native(), want);
    }

    // The watcher on disk. Each test runs the mode of the OS it runs on
    // (WatchMode::native): a mode's events are the OS's own, so another
    // OS's say nothing of it, and CI runs these on macOS, Linux and Windows.

    struct Watched {
        _dir: TestDir,
        root: PathBuf,
        count: Arc<AtomicUsize>,
        sent: Arc<Mutex<Vec<Instant>>>,
        watch: Option<ProjectWatch>,
    }

    /// watched is a project (with .git and node_modules) under watch, once
    /// the writes that set it up have been forgotten: FSEvents can deliver
    /// them after the watch began. It waits for a quiet second (at most
    /// ten), then clears the count.
    fn watched() -> Watched {
        let d = TestDir::new();
        d.write("proj/starboard.yaml", "version: 1\n");
        d.write("proj/docs/flows/screens.yaml", "screens: {}\n");
        d.write("proj/.git/HEAD", "ref: refs/heads/main\n");
        d.write("proj/app/node_modules/kit/Card.tsx", "export {}\n");
        let root = std::fs::canonicalize(d.path().join("proj")).unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let sent = Arc::new(Mutex::new(Vec::new()));
        let (c, s) = (count.clone(), sent.clone());
        let sink: Sink = Arc::new(move || {
            s.lock().unwrap().push(Instant::now());
            c.fetch_add(1, Ordering::SeqCst);
        });
        let watch = watch_project_in(WatchMode::native(), root.clone(), sink).unwrap();
        let start = Instant::now();
        let (mut seen, mut quiet) = (usize::MAX, Instant::now());
        while start.elapsed() < Duration::from_secs(10) {
            let n = count.load(Ordering::SeqCst);
            if n != seen {
                (seen, quiet) = (n, Instant::now());
            } else if quiet.elapsed() >= Duration::from_secs(1) {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        count.store(0, Ordering::SeqCst);
        sent.lock().unwrap().clear();
        Watched {
            _dir: d,
            root,
            count,
            sent,
            watch: Some(watch),
        }
    }

    impl Watched {
        fn write(&self, rel: &str, text: &str) {
            let p = self.root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text).unwrap();
        }

        fn count(&self) -> usize {
            self.count.load(Ordering::SeqCst)
        }

        /// wait_for waits (at most ten seconds) until n have been sent, then
        /// a further second, so a second event would have come.
        fn wait_for(&self, n: usize) -> usize {
            let start = Instant::now();
            while self.count() < n && start.elapsed() < Duration::from_secs(10) {
                std::thread::sleep(Duration::from_millis(20));
            }
            std::thread::sleep(Duration::from_secs(1));
            self.count()
        }
    }

    #[test]
    fn one_write_sends_one_files_changed_once_debounced() {
        let w = watched();
        let wrote = Instant::now();
        w.write("docs/flows/screens.yaml", "screens: {home: {}}\n");
        assert_eq!(w.wait_for(1), 1);
        let sent = w.sent.lock().unwrap()[0];
        assert!(
            sent.duration_since(wrote) >= DEBOUNCE,
            "{:?}",
            sent.duration_since(wrote)
        );
    }

    #[test]
    fn a_burst_of_twenty_writes_within_100_ms_sends_one() {
        let w = watched();
        let start = Instant::now();
        for i in 0..20 {
            w.write(&format!("docs/flows/flows/f{i}.md"), "# F\n");
            std::thread::sleep(Duration::from_millis(4));
        }
        assert!(
            start.elapsed() < Duration::from_millis(250),
            "{:?}",
            start.elapsed()
        );
        assert_eq!(w.wait_for(1), 1);
    }

    #[test]
    fn changes_in_git_or_node_modules_send_none() {
        let w = watched();
        w.write(".git/HEAD", "ref: refs/heads/other\n");
        w.write(".git/refs/heads/new", "0000\n");
        w.write("app/node_modules/kit/Card.tsx", "export const x = 1\n");
        w.write("node_modules/new/deep/a.js", "z\n");
        std::thread::sleep(Duration::from_millis(1200));
        assert_eq!(w.count(), 0);
        // A folder made after the watch began is followed (PerFolder
        // registers it when its creation is seen).
        w.write("docs/new/deeper/a.md", "# A\n");
        assert_eq!(w.wait_for(1), 1);
    }

    #[test]
    fn once_stopped_nothing_more_is_sent() {
        let mut w = watched();
        // A change still being debounced when the watch stops is dropped too.
        w.write("docs/flows/screens.yaml", "screens: {a: {}}\n");
        w.watch = None;
        w.write("docs/flows/screens.yaml", "screens: {b: {}}\n");
        std::thread::sleep(Duration::from_millis(1200));
        assert_eq!(w.count(), 0);
    }
}
