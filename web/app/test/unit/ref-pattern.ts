// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// core's RefPattern as the app gets it (model.refPattern), from the copy
// core's TestRefPatternCopy keeps equal to internal/flows.RefPattern.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { refSyntax } from "../../src/flows/refs.ts";

// A path, not a URL: under jsdom the global URL is jsdom's, which node:fs refuses.
const file = join(dirname(fileURLToPath(import.meta.url)), "../../../../core/testdata/refpattern.txt");

export const REF_PATTERN = readFileSync(file, "utf8").trim();

export const syntax = refSyntax(REF_PATTERN);
