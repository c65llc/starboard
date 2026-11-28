---
id: site-entry
noun: Website entry points
status: ruled
owner: system
cells:
  web: The homepage gives visitors a keyboard-accessible Docs link. The web app offers an example project that opens with no lint errors.
assertions:
  - kind: ui-test
    ref: "on a phone the navigation is a menu button that the keyboard opens and Escape closes"
    platform: web
  - kind: ui-test
    ref: "Explore the example project opens travel-app with 0 errors, under the CSP"
    platform: web
---

The navigation on @screen:site.home retains its Docs link at phone
widths. The @component:site-button compact header variant keeps the
@token:site-button-compact-height minimum height. Visitors can also follow the
browser editor link to @screen:app.open and explore a project without
selecting a folder.
