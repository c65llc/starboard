---
title: config-invalid
description: starboard.yaml breaks the config schema, such as a missing version, an unknown key or a value of the wrong type.
---

## What it catches

`starboard.yaml` is valid YAML, but something in it is not what the config
schema allows. Among them:

- `version` is missing, is not an integer, or is not `1`.
- A key Starboard does not know, at the top level (only `version`,
  `content`, `platforms`, `formFactors`, `vocabularies`, `areas` and `lint`
  are allowed), under a platform (only `formFactors`, `roots` and
  `screenFiles`), or anywhere else; or the same key written twice.
- A value of the wrong type, such as a string where a list is expected.
- A form factor without both `width` and `height`, or a size that is not a
  positive integer.
- A vocabulary without both `file` and `select`.
- An area listed twice, or an area written over more than one line.
- Under `lint.rules`, a correctness rule (these cannot be configured), an
  unknown rule, or a severity other than `error`, `warn` or `off`.
- Under `lint.limits`, an unknown limit, or a value that is not a positive
  integer.

Each problem is reported at its line, and the rest of the file is still read.
A file that is not YAML at all is reported by
[yaml-syntax](../yaml-syntax/) instead.

## Why it matters

Every other check reads its settings from `starboard.yaml`. A setting
Starboard cannot read is a setting it silently does without, so lint would
check the project against something other than what you wrote. This is a
correctness rule: it is always an error.

## How to fix

Correct the key or value the message names. `starboard schema config` prints
the JSON Schema for `starboard.yaml`; point your editor's YAML support at it to
catch these as you type. To silence a finding you disagree with, change the
severity of a quality rule; a correctness rule such as `file-missing` cannot
be turned down, so fix what it reports instead.

## Example

A project tries to turn a correctness rule into a warning:

<!-- example: starboard.yaml -->
```yaml
version: 1
platforms:
  ios:
    formFactors: [phone]
areas: [trip]
lint:
  rules:
    file-missing: warn
```

Only quality rules can be configured. Remove the entry, and fix the missing
files the rule reports:

<!-- fixed: starboard.yaml -->
```yaml
version: 1
platforms:
  ios:
    formFactors: [phone]
areas: [trip]
```
