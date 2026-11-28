// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Hash routes, so the app works from any static host and offline:
//   #/                      Open a project
//   #/screens[/<id>]        Screen editor (Task 5)
//   #/flows                 Flow list (Task 6)
//   #/flows/<id>/edit|walk  Flow editor and walkthrough (Tasks 6 and 7)
//   #/flows/<id>/walk/<n>   The walkthrough at step n (1-based)
//   #/map                   App map (Task 8)
//   #/map/<id>              The map centred on screen id
//   #/map/<id>?steps=0|1|2  ... at focus level 0, 1 or 2 (steps from the centre)

import { signal } from "@preact/signals";

/** How many steps from the centre screen the map keeps in focus. */
export type FocusLevel = 0 | 1 | 2;

export type Route =
  | { name: "open" }
  | { name: "screens"; screen?: string }
  | { name: "flows" }
  | { name: "flowEdit"; flow: string }
  | { name: "flowWalk"; flow: string; step?: number }
  | { name: "map"; screen?: string; steps?: FocusLevel }
  | { name: "notFound" };

export type RouteName = Route["name"];

/** parseRoute reads a location hash such as "#/screens/trip.timeline". */
export function parseRoute(hash: string): Route {
  // Split the query off before decoding: an ID's own "?" arrives as %3F.
  const [rawPath = "", query] = hash.replace(/^#/, "").split(/\?(.*)/s, 2);
  const path = rawPath.replace(/^\/+|\/+$/g, "");
  let parts: string[];
  try {
    parts = path === "" ? [] : path.split("/").map(decodeURIComponent);
  } catch {
    return { name: "notFound" };
  }
  const [head, id, mode, step, ...rest] = parts;
  if (query !== undefined && head !== "map") return { name: "notFound" };
  if (rest.length > 0) return { name: "notFound" };
  if (step !== undefined && !(head === "flows" && mode === "walk")) return { name: "notFound" };
  switch (head) {
    case undefined:
      return { name: "open" };
    case "screens":
      if (mode !== undefined) break;
      return id === undefined ? { name: "screens" } : { name: "screens", screen: id };
    case "flows":
      if (id === undefined) return { name: "flows" };
      if (mode === undefined || mode === "edit") return { name: "flowEdit", flow: id };
      if (mode === "walk" && step === undefined) return { name: "flowWalk", flow: id };
      if (mode === "walk" && step !== undefined && /^[1-9][0-9]{0,5}$/.test(step)) {
        return { name: "flowWalk", flow: id, step: Number(step) };
      }
      break;
    case "map":
      if (id === undefined) return { name: "map" };
      if (mode !== undefined) break;
      return withSteps({ name: "map", screen: id }, query);
  }
  return { name: "notFound" };
}

// Anything but 0, 1 or 2 is dropped rather than rejected, so a hand-edited
// URL still opens the map.
function withSteps(r: Route & { name: "map" }, query: string | undefined): Route {
  const n = new URLSearchParams(query).get("steps");
  return n === "0" || n === "1" || n === "2" ? { ...r, steps: Number(n) as FocusLevel } : r;
}

/** hrefFor is the hash of route. */
export function hrefFor(route: Route): string {
  const e = encodeURIComponent;
  switch (route.name) {
    case "open":
    case "notFound":
      return "#/";
    case "screens":
      return route.screen === undefined ? "#/screens" : `#/screens/${e(route.screen)}`;
    case "flows":
      return "#/flows";
    case "flowEdit":
      return `#/flows/${e(route.flow)}/edit`;
    case "flowWalk":
      return `#/flows/${e(route.flow)}/walk${route.step === undefined ? "" : `/${route.step}`}`;
    case "map":
      if (route.screen === undefined) return "#/map";
      return `#/map/${e(route.screen)}${route.steps === undefined ? "" : `?steps=${route.steps}`}`;
  }
}

/** The current route: set by navigate and replaceRoute as they change the hash, and by startRouter on any other hash change (Back, Forward, a typed address). */
export const route = signal<Route>({ name: "open" });

/**
 * navigate goes to r, adding a history entry. The route is set here as well
 * as on the hashchange that follows a task later, so what renders next
 * already sees r: the map's layout and its focus requests follow the new
 * centre at once rather than meeting the old one for a tick.
 */
export function navigate(r: Route): void {
  location.hash = hrefFor(r);
  route.value = parseRoute(location.hash);
}

/**
 * replaceRoute goes to r in place of the current history entry, as the
 * walkthrough's step moves do: replaceState fires no hashchange, so the
 * route is set here.
 */
export function replaceRoute(r: Route): void {
  history.replaceState(history.state, "", hrefFor(r));
  route.value = parseRoute(location.hash);
}

/** startRouter follows hashchange; it returns a function that stops it. */
export function startRouter(): () => void {
  const sync = () => {
    route.value = parseRoute(location.hash);
  };
  sync();
  addEventListener("hashchange", sync);
  return () => removeEventListener("hashchange", sync);
}
