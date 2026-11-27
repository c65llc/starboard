// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Mermaid, loaded on demand as its own chunk when a flow with a diagram
// is shown, and run so that the page's CSP (style-src 'self') refuses
// nothing.
//
// Mermaid draws into the live DOM to measure text, and on the way it sets
// style attributes, inserts a <style> element, and hands its markup, style
// attributes included, to DOMPurify, which parses it with DOMParser. The
// CSP refuses all three (WebKit even in a parsed document). While it
// draws, and only for what it draws, three narrow shims
// turn them into what the CSP allows:
//   - setAttribute("style", v) sets style.cssText = v (the CSSOM, which no
//     CSP governs; the result is the same);
//   - a <style> inserted under the scratch element is replaced with an
//     empty comment, and its rules go into a constructed stylesheet that
//     the shadow root adopts, so they still apply while Mermaid measures;
//   - DOMParser.parseFromString, given this drawing's markup (as a string
//     or TrustedHTML), gets it with its style attributes renamed to
//     data-sb-style (svg.ts).
// The result is then sanitised again (svg.ts) and its nodes linked.

import mermaid from "mermaid";

import { cleanCss, hideStyleAttributes, linkNodes, sanitizeSvg } from "./svg.ts";

let initialised = false;
let counter = 0;
// One drawing at a time: the shims are global while one is active.
let tail: Promise<unknown> = Promise.resolve();

function init(): void {
  if (initialised) return;
  initialised = true;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    // Labels are drawn in the font they were measured in, and an edge's
    // reference label is wide enough not to break.
    flowchart: { htmlLabels: false, wrappingWidth: 400 },
    suppressErrorRendering: true,
    theme: "neutral",
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif",
  });
}

export interface Drawing {
  svg: SVGSVGElement;
  /** Mermaid's stylesheet for the drawing, cleaned (svg.ts cleanCss). */
  css: string;
  /** The drawing's root id, which Mermaid's rules are scoped to. */
  id: string;
}

/** Which screens a node may link to, and the address of each. */
export interface Linker {
  known(screen: string): boolean;
  href(screen: string): string;
}

/**
 * draw renders source with Mermaid, putting its rules in sheet (which the
 * caller's shadow root adopts), and returns the sanitised SVG with
 * its reference nodes linked (svg.ts linkNodes), detached, for the caller
 * to attach.
 */
export function draw(source: string, sheet: CSSStyleSheet, link: Linker): Promise<Drawing> {
  const run = tail.then(() => drawNow(source, sheet, link));
  tail = run.catch(() => undefined);
  return run;
}

async function drawNow(source: string, sheet: CSSStyleSheet, link: Linker): Promise<Drawing> {
  init();
  const id = `sb-diagram-${++counter}`;
  // Mermaid finds its drawing from document.body, so it measures in the
  // light DOM, off screen, with its rules adopted by the document meanwhile.
  const scratch = document.createElement("div");
  scratch.style.cssText = "position:absolute;left:-10000px;top:0;width:800px;visibility:hidden";
  scratch.setAttribute("aria-hidden", "true");
  document.body.append(scratch);
  const adopted = document.adoptedStyleSheets;
  document.adoptedStyleSheets = [...adopted, sheet];

  const proto = Element.prototype;
  const setAttribute = proto.setAttribute;
  const setAttributeNS = proto.setAttributeNS;
  const insertBefore = Node.prototype.insertBefore;
  const appendChild = Node.prototype.appendChild;
  const parse = DOMParser.prototype.parseFromString;
  let css = "";

  const takeStyle = <T extends Node>(parent: Node, node: T): Node | null => {
    if (!(node instanceof HTMLStyleElement) || !scratch.contains(parent)) return null;
    css += node.textContent ?? "";
    sheet.replaceSync(cleanCss(css));
    return document.createComment("");
  };
  // Only elements in the scratch element or not yet in the page: Mermaid's.
  const ours = (el: Element) => !el.isConnected || scratch.contains(el);
  proto.setAttribute = function (this: Element, name: string, value: string) {
    if (name.toLowerCase() === "style" && "style" in this && ours(this)) {
      (this as HTMLElement).style.cssText = String(value);
      return;
    }
    setAttribute.call(this, name, value);
  };
  proto.setAttributeNS = function (this: Element, ns: string | null, name: string, value: string) {
    if (name.toLowerCase() === "style" && "style" in this && ours(this)) {
      (this as HTMLElement).style.cssText = String(value);
      return;
    }
    setAttributeNS.call(this, ns, name, value);
  };
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, child: Node | null): T {
    const stand = takeStyle(this, node);
    insertBefore.call(this, stand ?? node, child);
    return node;
  };
  Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
    const stand = takeStyle(this, node);
    appendChild.call(this, stand ?? node);
    return node;
  };
  DOMParser.prototype.parseFromString = function (this: DOMParser, input: string, type: DOMParserSupportedType) {
    // DOMPurify hands over TrustedHTML where the browser has Trusted Types; String() reads either.
    const text = String(input);
    return parse.call(this, text.includes(`id="${id}"`) ? hideStyleAttributes(text) : input, type);
  };

  try {
    const { svg } = await mermaid.render(id, source, scratch);
    const element = sanitizeSvg(svg, document);
    if (!element) throw new Error("Mermaid did not draw an SVG");
    linkNodes(element, link.known, link.href);
    return { svg: element, css: cleanCss(css), id };
  } finally {
    proto.setAttribute = setAttribute;
    proto.setAttributeNS = setAttributeNS;
    Node.prototype.insertBefore = insertBefore;
    Node.prototype.appendChild = appendChild;
    DOMParser.prototype.parseFromString = parse;
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== sheet);
    scratch.remove();
  }
}
