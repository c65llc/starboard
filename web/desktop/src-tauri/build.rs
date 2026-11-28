// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// The app's commands are listed in its manifest, so each needs a
// permission (allow-<command>) that capabilities/default.json grants: a
// command left out of both cannot be called from the page.
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_dialog",
            "open_recent",
            "open_arg",
            "recents",
            "list",
            "read_text",
            "stat",
            "write",
        ]),
    ))
    .expect("failed to run tauri-build");
}
