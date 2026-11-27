// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Hash routes, so the app works from any static host and offline:
//   #/                      Open a project
//   #/screens[/<id>]        Screen editor (Task 5)
//   #/flows                 Flow list (Task 6)
//   #/flows/<id>/edit|walk  Flow editor and walkthrough (Tasks 6 and 7)
//   #/flows/<id>/walk/<n>   The walkthrough at step n (1-based)
//   #/map                   App map (Task 8)

import { signal } from "@preact/signals";

export type Route =
  | { name: "open" }
  | { name: "screens"; screen?: string }
  | { name: "flows" }
  | { name: "flowEdit"; flow: string }
  | { name: "flowWalk"; flow: string; step?: number }
  | { name: "map" }
  | { name: "notFound" };

export type RouteName = Route["name"];

/** parseRoute reads a location hash such as "#/screens/trip.timeline". */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "").replace(/^\/+|\/+$/g, "");
  let parts: string[];
  try {
    parts = path === "" ? [] : path.split("/").map(decodeURIComponent);
  } catch {
    return { name: "notFound" };
  }
  const [head, id, mode, step, ...rest] = parts;
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
      break;
  }
  return { name: "notFound" };
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
      return "#/map";
  }
}

/** The current route, kept in step with location.hash by startRouter. */
export const route = signal<Route>({ name: "open" });

/** navigate goes to r, adding a history entry. */
export function navigate(r: Route): void {
  location.hash = hrefFor(r);
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
