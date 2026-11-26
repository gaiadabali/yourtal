import sanitizeHtml from "sanitize-html";
import type { IOptions, Attributes } from "sanitize-html";

/**
 * The server-side HTML sanitiser for mail (spambank/BUILD.md B6, §4.4). Pure: HTML in, safe HTML and
 * counts out. Allowlist only: formatting, tables, lists, links (http, https, mailto; opened outside),
 * images only as `data:` (the caller turns `cid:` parts into those), and CSS with every way of
 * loading something removed. The client wraps the result in a sandboxed iframe with a CSP meta,
 * which is the second wall, not the first.
 */

export interface SanitizeInput {
  readonly html: string;
  /** `cid` (lower-case, without `<>`) to a `data:` URI, for the inline parts that were small enough. */
  readonly inline: ReadonlyMap<string, string>;
}

export interface SanitizeOutput {
  readonly html: string;
  readonly remoteImagesBlocked: number;
  readonly inlineImagesDropped: number;
}

const TAGS = [
  "a",
  "abbr",
  "address",
  "article",
  "b",
  "bdi",
  "bdo",
  "big",
  "blockquote",
  "br",
  "caption",
  "center",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "font",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strike",
  "strong",
  "style",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "tt",
  "u",
  "ul",
  "var",
  "wbr",
];

const SHARED_ATTRIBUTES = [
  "style",
  "class",
  "dir",
  "lang",
  "title",
  "align",
  "valign",
  "width",
  "height",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "colspan",
  "rowspan",
  "nowrap",
  "color",
  "face",
  "size",
];

/** A data URI an `<img>` may keep: raster types only (SVG can carry script). */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+$/i;
const REMOTE = /^\s*(https?:)?\/\//i;
/** Anything in CSS that can load, run or hide something. */
const CSS_FORBIDDEN =
  /url\s*\(|image-set\s*\(|image\s*\(|cross-fade\s*\(|element\s*\(|src\s*\(|@import|@font-face|@namespace|expression\s*\(|behavior\s*:|-moz-binding|javascript:|vbscript:/i;
const CSS_REMOTE_URL = /url\s*\(\s*["']?\s*(https?:)?\/\//gi;

/** CSS with every loader removed, and how many remote images that blocked. */
export function cleanCss(css: string): { css: string; remote: number } {
  const remote = (css.match(CSS_REMOTE_URL) ?? []).length;
  let text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // CSS escapes can spell `url(` any number of ways, and `<` has no business in a style.
  if (text.includes("\\") || text.includes("<")) return { css: "", remote };
  text = text
    .replace(/@import[^;]*;?/gi, "")
    .replace(/@font-face\s*\{[^}]*\}/gi, "")
    .replace(/url\s*\(\s*("[^"]*"|'[^']*'|[^)]*)\)/gi, "none")
    .replace(/(-webkit-)?image-set\s*\([^)]*\)/gi, "none");
  if (CSS_FORBIDDEN.test(text)) return { css: "", remote };
  return { css: text, remote };
}

function normaliseCid(value: string): string {
  return value.replace(/^cid:/i, "").replace(/^<|>$/g, "").trim().toLowerCase();
}

export function sanitizeMailHtml(input: SanitizeInput): SanitizeOutput {
  let remoteImagesBlocked = 0;
  let inlineImagesDropped = 0;

  function transform(
    tagName: string,
    attribs: Attributes,
  ): { tagName: string; attribs: Attributes } {
    const next: Attributes = { ...attribs };
    if (next.background !== undefined) {
      if (REMOTE.test(next.background)) remoteImagesBlocked += 1;
      delete next.background;
    }
    if (next.style !== undefined) {
      const cleaned = cleanCss(next.style);
      remoteImagesBlocked += cleaned.remote;
      if (cleaned.css.trim() === "") delete next.style;
      else next.style = cleaned.css;
    }
    if (tagName === "img") {
      const src = (next.src ?? "").trim();
      delete next.src;
      if (/^cid:/i.test(src)) {
        const data = input.inline.get(normaliseCid(src));
        if (data === undefined) inlineImagesDropped += 1;
        else next.src = data;
      } else if (SAFE_DATA_IMAGE.test(src)) {
        next.src = src;
      } else if (REMOTE.test(src)) {
        remoteImagesBlocked += 1;
      }
    }
    if (tagName === "a" && next.href !== undefined) {
      next.target = "_blank";
      next.rel = "noopener noreferrer";
    }
    return { tagName, attribs: next };
  }

  const options: IOptions = {
    allowedTags: TAGS,
    allowedAttributes: {
      "*": SHARED_ATTRIBUTES,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt"],
      td: ["headers", "scope"],
      th: ["headers", "scope", "abbr"],
      ol: ["start", "type", "reversed"],
      ul: ["type"],
      li: ["value"],
      col: ["span"],
      colgroup: ["span"],
      time: ["datetime"],
      style: [],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["data"], a: ["http", "https", "mailto"] },
    allowProtocolRelative: false,
    allowedSchemesAppliedToAttributes: ["href", "src", "cite"],
    // Text inside these is never shown; everything else unknown keeps its text, not its tag.
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "template", "xml"],
    disallowedTagsMode: "discard",
    // `<style>` is allowed on purpose; its CSS is cleaned below, as no other tag can be.
    allowVulnerableTags: true,
    transformTags: { "*": transform },
    exclusiveFilter: (frame) => frame.tag === "img" && (frame.attribs.src ?? "") === "",
  };

  let html = sanitizeHtml(input.html, options);
  // Text and attributes come out escaped, so a literal `<style>` here is always a real block.
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_block, css: string) => {
    const cleaned = cleanCss(css);
    remoteImagesBlocked += cleaned.remote;
    return cleaned.css.trim() === "" ? "" : `<style>${cleaned.css}</style>`;
  });
  return { html: `<div>${html}</div>`, remoteImagesBlocked, inlineImagesDropped };
}

/** Plain text as HTML that shows it as written. */
export function textAsHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<div style="white-space: pre-wrap">${escaped}</div>`;
}
