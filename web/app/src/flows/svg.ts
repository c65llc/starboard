// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC

// Making Mermaid's SVG safe to put in the page, and CSP-clean. The page's
// style-src is 'self': no <style> element and no style attribute may reach
// the DOM, not even a parsed but detached one (WebKit reports those too).
// So Mermaid's stylesheet goes into a constructed stylesheet (cleanCss
// drops anything that loads a URL), its style attributes travel as
// data-sb-style and are applied through the CSSOM, and DOMPurify keeps the
// drawing and drops script, foreignObject, handlers and outside URLs.

import DOMPurify from "dompurify";

import { parseRefLabel } from "./refs.ts";
import type { RefSyntax } from "./refs.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

/** unescapeCss reads CSS escapes (\75 rl, \u) and drops comments, so a check sees what the browser will. */
export function unescapeCss(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16) || 0xfffd))
    .replace(/\\(.)/g, "$1");
}

/**
 * loadsUrl reports whether a CSS or attribute value could load something
 * or run code: any url() whose target is not #fragment, image-set(),
 * @import, expression(), -moz-binding or behavior, read after unescaping.
 */
export function loadsUrl(value: string): boolean {
  const v = unescapeCss(value).toLowerCase().replace(/\s+/g, "");
  if (/image-set\(|@import|expression\(|-moz-binding|behavior:|src\(/.test(v)) return true;
  for (const m of v.matchAll(/url\(/g)) {
    const rest = v.slice((m.index ?? 0) + 4).replace(/^["']/, "");
    if (!rest.startsWith("#")) return true;
  }
  return false;
}

/** cleanCss drops every rule part and declaration that loads a URL or runs code (loadsUrl), keeping url(#…) references. */
export function cleanCss(css: string): string {
  return css.replace(/[^;{}]+;?/g, (part) => (loadsUrl(part) ? "" : part));
}

/** hideStyleAttributes renames the style attributes in serialised markup to data-sb-style; text is left alone. */
export function hideStyleAttributes(markup: string): string {
  return markup.replace(/<[^<>]*>/g, (tag) => tag.replace(/(\s)style=(["'])/g, "$1data-sb-style=$2"));
}

/**
 * isText reports whether an attribute holds only words, never read as CSS
 * or a URL: its value is a label, a name or data, so loadsUrl's patterns in
 * it ("src(", "url(" in a label) are harmless.
 */
function isText(name: string): boolean {
  return name.startsWith("aria-") || name.startsWith("data-") || name === "role" || name === "id" || name === "class";
}

/**
 * sanitizeSvg parses Mermaid's SVG (its style attributes hidden by
 * hideStyleAttributes) into doc, safe to attach: or null when it is not an
 * SVG. It is a group (its nodes may be links) rather than Mermaid's
 * graphics-document, which axe and screen readers handle unevenly.
 */
export function sanitizeSvg(svg: string, doc: Document): SVGSVGElement | null {
  const view = doc.defaultView;
  if (!view) return null;
  const purify = DOMPurify(view);
  const fragment = purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_ATTR: ["role", "aria-label", "aria-labelledby", "aria-describedby", "dominant-baseline", "text-anchor"],
    FORBID_TAGS: ["style", "script", "foreignObject", "foreignobject", "image", "a", "iframe"],
    FORBID_ATTR: ["style"],
    ALLOW_DATA_ATTR: true,
    RETURN_DOM_FRAGMENT: true,
  });
  const root = fragment.firstElementChild;
  if (!root || root.namespaceURI !== SVG_NS || root.localName !== "svg") return null;
  const element = doc.importNode(root, true) as SVGSVGElement;

  for (const el of [element, ...element.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name === "data-sb-style") {
        (el as SVGElement).style.cssText = cleanCss(attr.value);
        el.removeAttribute(attr.name);
      } else if ((name === "href" || name === "xlink:href") && !attr.value.startsWith("#")) {
        el.removeAttributeNode(attr);
      } else if (name.startsWith("on") || (!isText(name) && loadsUrl(attr.value))) {
        // Any presentation attribute (fill, filter, mask, marker-*, …) may take url(): only #fragments stay.
        el.removeAttributeNode(attr);
      }
    }
  }
  const comments = doc.createTreeWalker(element, 128 /* NodeFilter.SHOW_COMMENT */);
  const drop: Node[] = [];
  while (comments.nextNode()) drop.push(comments.currentNode);
  for (const c of drop) c.parentNode?.removeChild(c);

  element.setAttribute("role", "group");
  element.removeAttribute("aria-roledescription");
  return element;
}

/**
 * linkNodes wraps each node whose label is a reference to a screen known
 * accepts in a link to href(screen), and lists the screens it linked.
 */
export function linkNodes(
  svg: SVGSVGElement,
  syntax: RefSyntax,
  known: (screen: string) => boolean,
  href: (screen: string) => string,
): string[] {
  const linked: string[] = [];
  for (const node of [...svg.querySelectorAll("g.node")]) {
    const ref = parseRefLabel(node.textContent ?? "", syntax);
    if (!ref || !known(ref.screen)) continue;
    const doc = svg.ownerDocument;
    const a = doc.createElementNS(SVG_NS, "a");
    a.setAttribute("href", href(ref.screen));
    a.setAttribute("aria-label", `Open screen ${ref.screen}${ref.region ? ` (region ${ref.region})` : ""}`);
    a.setAttribute("class", "diagram__link");
    node.replaceWith(a);
    a.append(node);
    linked.push(ref.screen);
  }
  return linked;
}
