// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// A generated project for perf.spec.ts (Review Focus 4): 300 screens in 10
// areas and 60 flows, made at test time rather than committed as data.
// Every screen has a bar, a list and an action that navigates on, and each
// flow walks five screens, so lint, model and render all have real work.

export type Files = Record<string, string>;

export const SCREENS = 300;
export const FLOWS = 60;
const AREAS = 10;

const area = (i: number) => `area${i % AREAS}`;
const id = (i: number) => `${area(i)}.screen-${String(i).padStart(3, "0")}`;

function screen(i: number): string {
  const next = id((i + 1) % SCREENS);
  const proposed = i % 7 === 0 ? "    status: proposed\n" : "";
  return [
    `  ${id(i)}:`,
    `    title: Screen ${i}`,
    `    area: ${area(i)}`,
    `    purpose: Screen number ${i} of the generated project.`,
    `    presentation: push`,
    proposed.trimEnd(),
    `    layout:`,
    `      - region: app-bar`,
    `        kind: bar`,
    `        children:`,
    `          - {region: title, kind: header, label: Screen ${i}}`,
    `          - {region: back, kind: action, label: Back, to: ${id((i + SCREENS - 1) % SCREENS)}}`,
    `      - region: items`,
    `        kind: list`,
    `        item: {kind: card, label: Item, to: ${next}}`,
    `        empty:`,
    `          label: Nothing yet`,
    `      - {region: go, kind: primary-action, label: Continue, to: ${next}}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function flow(f: number): string {
  const first = (f * 5) % SCREENS;
  const steps = [0, 1, 2, 3, 4].map((k) => `${k + 1}. Tap @${id((first + k) % SCREENS)}#go.`);
  return [
    "---",
    `id: flow-${f}`,
    `title: Flow ${f}`,
    "status: shipped",
    `entry: ${id(first)}`,
    "---",
    "",
    "## Steps",
    "",
    ...steps,
    "",
  ].join("\n");
}

/** largeProject is the generated project's files. */
export function largeProject(): Files {
  const config = [
    "version: 1",
    "platforms:",
    "  ios:",
    "    formFactors: [phone]",
    "  web:",
    "    formFactors: [web-wide]",
    `areas: [${Array.from({ length: AREAS }, (_, i) => `area${i}`).join(", ")}]`,
    "",
  ].join("\n");
  const registry = ["screens:", ...Array.from({ length: SCREENS }, (_, i) => screen(i)), ""].join("\n");
  const files: Files = { "starboard.yaml": config, "docs/flows/screens.yaml": registry };
  for (let f = 0; f < FLOWS; f++) files[`docs/flows/flows/flow-${f}.md`] = flow(f);
  return files;
}
