// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 C65 LLC
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { syntax } from "./ref-pattern.ts";
import { cleanCss, hideStyleAttributes, linkNodes, loadsUrl, sanitizeSvg, unescapeCss } from "../../src/flows/svg.ts";

describe("cleanCss", () => {
  it("drops @import and every declaration that loads a URL, keeping url(#…) references", () => {
    const css = '@import url("https://x.test/a.css");#d .node rect{fill:#fff;background:url(https://x.test/t.png);stroke:red}#d .m{marker-end:url(#arrow)}';
    expect(cleanCss(css)).toBe("#d .node rect{fill:#fff;stroke:red}#d .m{marker-end:url(#arrow)}");
  });

  it("drops expression() and -moz-binding", () => {
    expect(cleanCss("a{width:expression(alert(1));color:red;-moz-binding:x}")).toBe("a{color:red;}");
  });

  it("drops image-set() and escaped url()", () => {
    expect(cleanCss("a{background:image-set('x.png' 1x);color:red;background:u\\72l(https://x.test)}")).toBe("a{color:red;}");
  });
});

describe("loadsUrl", () => {
  it("is true for any url() not of a #fragment, image-set() and the code-running forms, after unescaping", () => {
    for (const v of [
      "url(https://x.test/a.png)",
      "url( 'x.png' )",
      "url(#a) url(x.png)",
      'image-set("x.png" 1x)',
      "-webkit-image-set(x.png 1x)",
      "u\\72l(https://x.test/a)",
      "\\75 rl(x)",
      "ur/**/l(x)",
      "expression(alert(1))",
      "-moz-binding: x",
      "src(x)",
    ]) {
      expect(loadsUrl(v), v).toBe(true);
    }
  });

  it("is false for fragment references and plain values", () => {
    for (const v of ["url(#arrow)", "url( '#a' )", "red", "M0 0 L10 10", "translate(1, 2)"]) expect(loadsUrl(v), v).toBe(false);
  });

  it("unescapeCss reads hex and character escapes and drops comments", () => {
    expect(unescapeCss("\\75 r\\l/* c */(")).toBe("url(");
  });
});

describe("hideStyleAttributes", () => {
  it("renames style attributes, which the CSP refuses even in a parsed document, to data-sb-style", () => {
    expect(hideStyleAttributes('<svg id="d"><g style="fill:red" class="a"><text>style="kept as is"</text></g></svg>')).toBe(
      '<svg id="d"><g data-sb-style="fill:red" class="a"><text>style="kept as is"</text></g></svg>',
    );
  });
});

const dirty = [
  '<svg xmlns="http://www.w3.org/2000/svg" id="d1" role="graphics-document document" aria-roledescription="flowchart-v2" viewBox="0 0 10 10" onload="alert(1)">',
  "<style>#d1{fill:red}</style><script>alert(1)</script>",
  '<g class="node" id="n1" data-sb-style="fill: red; background: url(https://x.test/a.png)"><rect width="5" height="5"></rect><text>@trip.timeline</text></g>',
  '<g class="node" id="n2"><text>Save</text></g>',
  '<a href="javascript:alert(1)"><text>x</text></a><image href="https://x.test/t.png"></image>',
  '<rect id="r1" fill="url(https://x.test/p.svg#p)" filter="url(#shadow)" mask="url(&quot;https://x.test/m&quot;)"></rect>',
  '<foreignObject><div>html</div></foreignObject><path marker-end="url(#arrow)" d="M0 0"></path><!-- a comment -->',
  "</svg>",
].join("");

describe("sanitizeSvg", () => {
  it("keeps the drawing and drops script, style, foreignObject, handlers, outside URLs and comments", () => {
    const svg = sanitizeSvg(dirty, document);
    expect(svg).not.toBeNull();
    const out = svg?.outerHTML ?? "";
    expect(out).not.toMatch(/script|<style|foreignObject|onload|javascript:|x\.test|comment|data-sb-style/i);
    expect(svg?.querySelector("#n1 rect")).not.toBeNull();
    expect(svg?.querySelector("path")?.getAttribute("marker-end")).toBe("url(#arrow)");
    const rect = svg?.querySelector("#r1");
    expect(rect?.hasAttribute("fill")).toBe(false);
    expect(rect?.hasAttribute("mask")).toBe(false);
    expect(rect?.getAttribute("filter")).toBe("url(#shadow)");
    expect(svg?.getAttribute("role")).toBe("group");
    expect(svg?.hasAttribute("aria-roledescription")).toBe(false);
  });

  it("applies the renamed styles through the CSSOM, without the declarations that load URLs", () => {
    const svg = sanitizeSvg(dirty, document);
    const g = svg?.querySelector<SVGGElement>("#n1");
    expect(g?.style.getPropertyValue("fill")).toBe("red");
    expect(g?.style.getPropertyValue("background")).toBe("");
  });

  it("keeps text attributes (aria-*, role, id, class, data-*) whose words look like a URL load", () => {
    const svg = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" id="d"><g id="n2" class="node behavior:x" aria-label="Pick src(foo) or url(maps)" data-label="@import notes"><rect/></g></svg>',
      document,
    );
    const g = svg?.querySelector("#n2");
    expect(g?.getAttribute("aria-label")).toBe("Pick src(foo) or url(maps)");
    expect(g?.getAttribute("data-label")).toBe("@import notes");
    expect(g?.getAttribute("class")).toBe("node behavior:x");
  });

  it("is null for something that is not an SVG", () => {
    expect(sanitizeSvg("<p>hi</p>", document)).toBeNull();
  });
});

describe("linkNodes", () => {
  it("wraps each node labelled with a registered screen's reference in a link to it", () => {
    const svg = sanitizeSvg(dirty, document);
    if (!svg) throw new Error("no svg");
    const linked = linkNodes(svg, syntax, (screen) => screen === "trip.timeline", (screen) => `#/screens/${screen}`);
    expect(linked).toEqual(["trip.timeline"]);
    const a = svg.querySelector("a");
    expect(a?.getAttribute("href")).toBe("#/screens/trip.timeline");
    expect(a?.getAttribute("aria-label")).toBe("Open screen trip.timeline");
    expect(a?.querySelector("#n1")).not.toBeNull();
    expect(svg.querySelectorAll("a")).toHaveLength(1);
  });
});
