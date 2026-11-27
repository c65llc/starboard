---
title: yaml-syntax
description: starboard.yaml or screens.yaml cannot be read as one YAML document.
---

## What it catches

`starboard.yaml` or `screens.yaml` is not valid YAML: an unclosed bracket or
quote, a tab used for indentation, a key indented to the wrong level, and so
on. It also catches a file that holds more than one YAML document, separated
by a `---` line; each of these files must hold exactly one.

A syntax error in a flow's front matter is reported as
[flow-frontmatter-invalid](../flow-frontmatter-invalid/), and one in a
vocabulary file as [vocabulary-source-invalid](../vocabulary-source-invalid/).

## Why it matters

Starboard cannot read anything from a file it cannot parse. When
`starboard.yaml` does not parse, nothing else is checked; when
`screens.yaml` does not parse, the project has no screens, so every flow
reference to a screen fails too. Fix this finding first. This is a
correctness rule: it is always an error.

## How to fix

Go to the line the finding names and correct the YAML there. The message is
the YAML parser's own description of the problem. Indent with spaces only,
close every `[`, `{` and quote you open, and keep the whole file one
document.

## Example

The `presentation` value opens a flow sequence and never closes it:

<!-- example: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: [tab
```

A presentation is a single word:

<!-- fixed: docs/flows/screens.yaml -->
```yaml
screens:
  trip.timeline:
    title: Timeline
    area: trip
    presentation: tab
```
