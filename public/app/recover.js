// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// recover.js: a classic script index.html loads before the app (issue #18).
// If the app's module script fails to load, the page this browser was given
// names a build the server no longer has: the service worker's precache
// holds a page and scripts from different builds. Left alone, the app stays
// blank until the next deploy. So unregister the service worker, delete its
// caches and reload once, from the network. At most once a minute, so a
// failure that a reload does not fix (the network is down, say) never loops.
// Unhashed and outside assets/, so every build serves it at the same URL.

/* global addEventListener, HTMLScriptElement, sessionStorage, navigator, self, caches, location */

(function () {
  var KEY = "starboard.recover";
  addEventListener(
    "error",
    function (event) {
      var script = event.target;
      if (!(script instanceof HTMLScriptElement) || script.type !== "module") return;
      try {
        var last = Number(sessionStorage.getItem(KEY));
        if (last && Date.now() - last < 60000) return;
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch {
        return; // no sessionStorage: recovering could loop
      }
      var unregister = "serviceWorker" in navigator
        ? navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
          })
        : Promise.resolve();
      var clear = "caches" in self
        ? caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
          })
        : Promise.resolve();
      Promise.all([unregister, clear]).then(
        function () { location.reload(); },
        function () { location.reload(); }
      );
    },
    true
  );
})();
