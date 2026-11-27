---
title: AGPL and you
editUrl: false
description: Starboard is free software under the GNU Affero General Public License v3.0 only. What that means for the projects you use it on, with the full license text.
---

Starboard is free software: Copyright © 2026 C65 LLC, licensed under the
[GNU Affero General Public License, version 3 only](#the-license-text)
(`AGPL-3.0-only`). Everything in the
[repository](https://github.com/c65llc/starboard) is under it: the
`starboard` command, the WebAssembly core, the web app at [/app/](/app/),
the GitHub Action and the agent skills.

The AGPL is about Starboard itself: what you may do when you copy, change or
pass on Starboard, or offer a changed version of it to people over a
network. It puts no condition on running Starboard on your own project.

This page is a plain-language summary, not legal advice. The license text
below is what counts; for a question about your own situation, ask your
counsel.

## Questions and answers

### Can I use Starboard on a closed-source product?

Yes. Running Starboard, on your machine, in CI or through the GitHub Action,
is use, and section 2 of the license affirms your "unlimited permission to
run the unmodified Program". Your product's code does not become AGPL
because a tool checked its screen reference.

### Are my `screens.yaml`, flows and generated pages covered by the AGPL?

The files you write are yours, under whatever terms you choose. Section 2
also says the output of running Starboard is covered by the license only if
that output, given its content, is itself a covered work. The wireframes,
the app map and the screen catalog are drawn from your files and contain
no part of Starboard's program.

### What about the agent skills that `starboard skills install` writes?

The skills are Starboard's own text, under the same license.
`starboard skills install` copies them into your repository, adapting only
their front matter for each agent. Keeping them beside your code does not
change your code's license. If you change the skills and pass them on, the
changed skills stay under the AGPL.

### I changed Starboard. What do I have to do?

Nothing, if you only run the changed version yourselves. If you give it to
anyone else, you pass it on under the AGPL, with its source. If you change
Starboard and let people use it over a network, for example a hosted copy of
the web app, section 13 asks you to offer those users the source of your
changed version.

### Can I contribute?

Yes. [CONTRIBUTING.md](https://github.com/c65llc/starboard/blob/main/CONTRIBUTING.md)
explains how. Every contribution, once accepted, is licensed under the same
terms, `AGPL-3.0-only`.
