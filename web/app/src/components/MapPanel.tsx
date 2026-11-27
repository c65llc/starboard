// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Beside the map: the selected screen's links out and in (each a button
// that selects the screen at its other end, so the keyboard can follow
// links), its editor, the flows that pass through it, and the key to the
// drawing.

import type { Model } from "@c65llc/starboard-core";

import { flowsThrough } from "../map/graph.ts";
import type { MapGraph } from "../map/graph.ts";
import { hrefFor } from "../router.ts";

interface Props {
  model: Model;
  graph: MapGraph;
  selected: string | null;
  /** Selects id and moves focus to its node. */
  go(id: string): void;
}

/** linksOf is the selected screen's links out and in, self links left out. */
export function linksOf(graph: MapGraph, id: string) {
  const out = graph.links.filter((l) => l.from === id && l.to !== id);
  const into = graph.links.filter((l) => l.to === id && l.from !== id);
  return { out, into };
}

const region = (name: string) => (name ? `#${name}` : "(unnamed region)");

function Key() {
  return (
    <div class="map-key">
      <p class="map-panel__label">Key</p>
      <ul class="map-key__list">
        <li>
          <svg width="28" height="10" aria-hidden="true">
            <line class="map-key__on" x1="0" y1="5" x2="22" y2="5" />
            <path class="map-key__head-on" d="M20 1 L27 5 L20 9 Z" />
          </svg>
          Link to or from selected
        </li>
        <li>
          <svg width="28" height="10" aria-hidden="true">
            <line class="map-key__idle" x1="0" y1="5" x2="22" y2="5" />
            <path class="map-key__head-idle" d="M20 1 L27 5 L20 9 Z" />
          </svg>
          Other link
        </li>
        <li>
          <svg width="28" height="10" aria-hidden="true">
            <line class="map-key__on" x1="6" y1="5" x2="22" y2="5" />
            <path class="map-key__head-on" d="M20 1 L27 5 L20 9 Z" />
            <path class="map-key__head-on" d="M8 1 L1 5 L8 9 Z" />
          </svg>
          Two-way (tabs)
        </li>
        <li>
          <span class="map-key__box map-key__box--proposed" aria-hidden="true" />
          Proposed screen or link (dashed)
        </li>
        <li>
          <span class="map-key__box map-key__box--error" aria-hidden="true" />
          Has errors
        </li>
      </ul>
    </div>
  );
}

export function MapPanel({ model, graph, selected, go }: Props) {
  const node = selected ? graph.nodes.find((n) => n.id === selected) : undefined;
  if (!node) {
    return (
      <section class="map-panel" aria-label="Selected screen">
        <p class="map-panel__empty">Select a screen to see its links in and out.</p>
        <Key />
      </section>
    );
  }
  const { out, into } = linksOf(graph, node.id);
  const flows = flowsThrough(model, node.id);
  return (
    <section class="map-panel" aria-label="Selected screen">
      <p class="map-panel__label">Selected</p>
      <h2 class="map-panel__id">{node.id}</h2>
      <p class="map-panel__title">{node.title}</p>

      <h3 id="map-out" class="map-panel__heading">
        Links out ({out.length})
      </h3>
      {out.length === 0 ? (
        <p class="map-panel__none">None</p>
      ) : (
        <ul class="map-panel__links" aria-labelledby="map-out">
          {out.map((l) => (
            <li key={`${l.path}>${l.to}`}>
              {l.registered ? (
                <button type="button" class="map-panel__link" onClick={() => go(l.to)}>
                  {region(l.region)} → {l.to}
                </button>
              ) : (
                <span class="map-panel__unregistered">
                  {region(l.region)} → {l.to} (not registered)
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 id="map-in" class="map-panel__heading">
        Links in ({into.length})
      </h3>
      {into.length === 0 ? (
        <p class="map-panel__none">None</p>
      ) : (
        <ul class="map-panel__links" aria-labelledby="map-in">
          {into.map((l) => (
            <li key={`${l.from}>${l.path}`}>
              <button type="button" class="map-panel__link" onClick={() => go(l.from)}>
                {l.from} · {region(l.region)}
              </button>
            </li>
          ))}
        </ul>
      )}

      <a class="map-panel__open" href={hrefFor({ name: "screens", screen: node.id })}>
        Open in screen editor
      </a>

      <h3 id="map-flows" class="map-panel__heading">
        Flows that pass through here ({flows.length})
      </h3>
      {flows.length === 0 ? (
        <p class="map-panel__none">None</p>
      ) : (
        <ul class="map-panel__flows" aria-labelledby="map-flows">
          {flows.map(({ flow, step }) => (
            <li key={flow.id}>
              <a href={hrefFor({ name: "flowWalk", flow: flow.id, step })}>{flow.title || flow.id}</a>
              <span class="map-panel__step"> from step {step}</span>
            </li>
          ))}
        </ul>
      )}
      <Key />
    </section>
  );
}
