# Security Policy

## Reporting a Vulnerability

Report vulnerabilities privately through GitHub's security advisories:

1. Go to [github.com/c65llc/starboard](https://github.com/c65llc/starboard)
2. Open **Security > Advisories** and choose **Report a vulnerability**
3. Describe the issue, how to reproduce it, and its potential impact

**Do not open a public issue for security vulnerabilities.**

## Scope

- **The `starboard` binary and release artifacts** — e.g. a crafted
  `starboard.yaml`, `screens.yaml` or flow file that makes `starboard` read or
  write files outside the project, or execute code.
- **The GitHub Action** — e.g. a way to bypass checksum verification of the
  downloaded release.
- **The PWA editor** — e.g. writes outside the folder the user granted, or
  project content executing script in the app.
- **Release integrity** — tampered or unverifiable release archives.

## Response Timeline

- **Acknowledgment** within **48 hours**
- **Assessment and fix timeline** within **7 days**
- **Disclosure** coordinated with you after a fix is available

## Not a Security Issue

Feature requests, disagreements with lint rules, and documentation typos —
please open a regular [GitHub issue](https://github.com/c65llc/starboard/issues).
