// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

//! The app's native menu (D13): Tauri's standard one, whose Edit and Window
//! menus keep copy, paste and the window commands working, with two entries
//! at the top of File (a File menu of their own on Linux, where Tauri's has
//! none):
//!
//! - **Open Folder…** (Cmd/Ctrl+O) sends the page `menu-open {kind: "folder"}`;
//! - **Open Recent** is a submenu of the recent projects, each of which
//!   sends `menu-open {kind: "recent", path}`.
//!
//! The page opens each through its own open path, as the start screen's
//! buttons do: open_dialog, or open_recent, which refuses a path the recent
//! list does not hold and drops one that has moved. The menu is rebuilt
//! (refresh) whenever the recent list may have changed.

use serde::Serialize;
use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::recents::Recent;
use crate::Desktop;

/// The event a menu entry sends the page.
pub const MENU_OPEN: &str = "menu-open";

/// The window the page is in.
const MAIN_WINDOW: &str = "main";

const ID_OPEN_FOLDER: &str = "open-folder";
const ID_OPEN_RECENT: &str = "open-recent";
const ID_NO_RECENT: &str = "no-recent";
const ID_RECENT: &str = "recent:";

/// The most characters of a recent project's name shown in the menu.
const LABEL_MAX: usize = 48;

/// What a menu entry asks the page to open, as `menu-open` carries it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum MenuOpen {
    /// Open Folder…: the folder dialog.
    Folder,
    /// A recent project, by the path the recent list gave.
    Recent { path: String },
}

/// One entry of File's part of the menu, before Tauri builds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    Item {
        id: String,
        label: String,
        enabled: bool,
        accelerator: Option<&'static str>,
    },
    Submenu {
        id: String,
        label: String,
        items: Vec<Entry>,
    },
    Separator,
}

fn item(id: &str, label: &str, enabled: bool, accelerator: Option<&'static str>) -> Entry {
    Entry::Item {
        id: id.to_string(),
        label: label.to_string(),
        enabled,
        accelerator,
    }
}

/// menu_label is a recent project's name as a menu entry: cut to LABEL_MAX
/// characters, control characters out, and `&` doubled where a menu would
/// take it for a mnemonic.
pub fn menu_label(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(LABEL_MAX)
        .collect();
    let clean = clean.trim();
    let shown = if clean.is_empty() { "(unnamed)" } else { clean };
    shown.replace('&', "&&")
}

fn recent_id(path: &str) -> String {
    format!("{ID_RECENT}{path}")
}

/// file_entries is what the menu puts at the top of File, for the recent
/// list given: Open Folder…, Open Recent with each recent project newest
/// first (or a disabled line saying there are none), and a separator.
pub fn file_entries(recents: &[Recent]) -> Vec<Entry> {
    let mut list: Vec<Entry> = recents
        .iter()
        .map(|r| item(&recent_id(&r.path), &menu_label(&r.name), true, None))
        .collect();
    if list.is_empty() {
        list.push(item(ID_NO_RECENT, "No Recent Projects", false, None));
    }
    vec![
        item(ID_OPEN_FOLDER, "Open Folder…", true, Some("CmdOrCtrl+O")),
        Entry::Submenu {
            id: ID_OPEN_RECENT.to_string(),
            label: "Open Recent".to_string(),
            items: list,
        },
        Entry::Separator,
    ]
}

/// action is what the menu entry of id asks the page to open, if anything.
pub fn action(id: &str) -> Option<MenuOpen> {
    if id == ID_OPEN_FOLDER {
        return Some(MenuOpen::Folder);
    }
    id.strip_prefix(ID_RECENT)
        .filter(|p| !p.is_empty())
        .map(|p| MenuOpen::Recent {
            path: p.to_string(),
        })
}

/// make is entry built by Tauri.
fn make<R: Runtime>(app: &AppHandle<R>, entry: &Entry) -> tauri::Result<Box<dyn IsMenuItem<R>>> {
    Ok(match entry {
        Entry::Item {
            id,
            label,
            enabled,
            accelerator,
        } => Box::new(MenuItem::with_id(
            app,
            id.as_str(),
            label,
            *enabled,
            *accelerator,
        )?),
        Entry::Submenu { id, label, items } => {
            let sub = Submenu::with_id(app, id.as_str(), label, true)?;
            for e in items {
                sub.append(make(app, e)?.as_ref())?;
            }
            Box::new(sub)
        }
        Entry::Separator => Box::new(PredefinedMenuItem::separator(app)?),
    })
}

/// build is Tauri's standard menu with file_entries at the top of File.
pub fn build<R: Runtime>(app: &AppHandle<R>, recents: &[Recent]) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    let made = file_entries(recents)
        .iter()
        .map(|e| make(app, e))
        .collect::<tauri::Result<Vec<_>>>()?;
    let ours: Vec<&dyn IsMenuItem<R>> = made.iter().map(|b| b.as_ref()).collect();
    let mut file = None;
    for kind in menu.items()? {
        if let Some(sub) = kind.as_submenu() {
            if sub.text()? == "File" {
                file = Some(sub.clone());
                break;
            }
        }
    }
    match file {
        Some(file) => file.insert_items(&ours, 0)?,
        None => {
            // Linux: Tauri's menu has no File; ours goes first.
            let file = Submenu::with_items(app, "File", true, &ours[..ours.len() - 1])?;
            menu.prepend(&file)?;
        }
    }
    Ok(menu)
}

fn recents_now<R: Runtime>(app: &AppHandle<R>) -> Vec<Recent> {
    app.try_state::<Desktop>()
        .map(|d| d.recents())
        .unwrap_or_default()
}

/// install sets the app's menu, with the recent list as it is now.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    app.set_menu(build(app, &recents_now(app))?)?;
    Ok(())
}

/// refresh rebuilds the menu, so Open Recent shows the list as it now is:
/// the project just opened first, and one that has moved gone.
pub fn refresh<R: Runtime>(app: &AppHandle<R>) {
    if let Err(e) = install(app) {
        eprintln!("starboard: could not update the menu: {e}");
    }
}

/// on_event sends the page what a chosen menu entry asks it to open.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(open) = action(id) {
        if let Err(e) = app.emit_to(MAIN_WINDOW, MENU_OPEN, open) {
            eprintln!("starboard: could not send {MENU_OPEN}: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recent(path: &str, name: &str) -> Recent {
        Recent {
            path: path.to_string(),
            name: name.to_string(),
            opened_at: 0.0,
        }
    }

    fn recent_items(entries: &[Entry]) -> Vec<(String, String, bool)> {
        let Some(Entry::Submenu { id, label, items }) = entries.get(1) else {
            panic!("no Open Recent submenu: {entries:?}");
        };
        assert_eq!(
            (id.as_str(), label.as_str()),
            (ID_OPEN_RECENT, "Open Recent")
        );
        items
            .iter()
            .map(|e| match e {
                Entry::Item {
                    id, label, enabled, ..
                } => (id.clone(), label.clone(), *enabled),
                other => panic!("not an item: {other:?}"),
            })
            .collect()
    }

    #[test]
    fn file_opens_a_folder_with_cmd_or_ctrl_o_then_lists_the_recent_projects() {
        let entries = file_entries(&[recent("/w/alpha", "alpha"), recent("/w/beta", "beta")]);
        assert_eq!(
            entries[0],
            item(ID_OPEN_FOLDER, "Open Folder…", true, Some("CmdOrCtrl+O"))
        );
        assert_eq!(
            recent_items(&entries),
            [
                ("recent:/w/alpha".to_string(), "alpha".to_string(), true),
                ("recent:/w/beta".to_string(), "beta".to_string(), true),
            ]
        );
        assert_eq!(entries[2], Entry::Separator);
        assert_eq!(entries.len(), 3);
    }

    #[test]
    fn with_no_recent_projects_open_recent_says_so_and_offers_nothing() {
        assert_eq!(
            recent_items(&file_entries(&[])),
            [(
                ID_NO_RECENT.to_string(),
                "No Recent Projects".to_string(),
                false
            )]
        );
    }

    #[test]
    fn the_menu_follows_the_recent_list_as_it_changes() {
        let before = recent_items(&file_entries(&[recent("/w/a", "a"), recent("/w/b", "b")]));
        let after = recent_items(&file_entries(&[recent("/w/b", "b")]));
        assert_eq!(before.len(), 2);
        assert_eq!(after, [("recent:/w/b".to_string(), "b".to_string(), true)]);
    }

    #[test]
    fn each_entry_asks_the_page_for_what_it_names() {
        assert_eq!(action(ID_OPEN_FOLDER), Some(MenuOpen::Folder));
        let entries = file_entries(&[recent("C:\\w\\a & b", "a & b")]);
        let (id, label, _) = recent_items(&entries).remove(0);
        assert_eq!(label, "a && b");
        assert_eq!(
            action(&id),
            Some(MenuOpen::Recent {
                path: "C:\\w\\a & b".to_string()
            })
        );
        for none in ["recent:", ID_OPEN_RECENT, ID_NO_RECENT, "quit", ""] {
            assert_eq!(action(none), None, "{none}");
        }
    }

    #[test]
    fn a_menu_label_is_cut_cleaned_and_keeps_ampersands_literal() {
        assert_eq!(menu_label("Tom & Jerry"), "Tom && Jerry");
        assert_eq!(menu_label("a\nb"), "a b");
        assert_eq!(menu_label(&"n".repeat(100)).chars().count(), LABEL_MAX);
        assert_eq!(menu_label("  "), "(unnamed)");
    }

    #[test]
    fn menu_open_carries_its_kind_and_a_recent_path() {
        assert_eq!(
            serde_json::to_value(MenuOpen::Folder).unwrap(),
            serde_json::json!({"kind": "folder"})
        );
        assert_eq!(
            serde_json::to_value(MenuOpen::Recent { path: "/p".into() }).unwrap(),
            serde_json::json!({"kind": "recent", "path": "/p"})
        );
    }
}
