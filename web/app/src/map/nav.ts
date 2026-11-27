// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Arrow keys on the map move to the spatial neighbour: the nearest node
// in the arrow's direction, as the eye reads the drawing. Following edges
// instead would strand screens with no links and make a key's meaning
// depend on which links happen to exist; the selected screen's panel lists
// its links in and out as buttons, which is how the keyboard follows them.

/** A placed box, as layout.ts gives it. */
export interface Box {
  node: { id: string };
  x: number;
  y: number;
  width: number;
  height: number;
}

const directions: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

/**
 * neighbour is the ID of the node nearest to from in key's direction, or
 * undefined at the map's edge or for any other key. Distance is measured
 * between centres, with sideways distance counting double so that a move
 * stays in its row or column when it can; ties go to the lower ID.
 */
export function neighbour(boxes: Box[], from: string, key: string): string | undefined {
  const d = directions[key];
  const here = boxes.find((b) => b.node.id === from);
  if (!d || !here) return undefined;
  const [dx, dy] = d;
  const cx = here.x + here.width / 2;
  const cy = here.y + here.height / 2;
  let best: { id: string; score: number } | undefined;
  for (const b of boxes) {
    if (b === here) continue;
    const ox = b.x + b.width / 2 - cx;
    const oy = b.y + b.height / 2 - cy;
    const ahead = ox * dx + oy * dy;
    if (ahead <= 0) continue;
    const side = Math.abs(ox * dy) + Math.abs(oy * dx);
    const score = ahead + 2 * side;
    if (!best || score < best.score || (score === best.score && b.node.id < best.id)) best = { id: b.node.id, score };
  }
  return best?.id;
}

/** selectionStatus is what the map announces when a screen is selected: its links out and in. */
export function selectionStatus(id: string, out: number, into: number): string {
  return `Selected ${id}: ${out} ${out === 1 ? "link" : "links"} out, ${into} in.`;
}
