/**
 * Whitelist HTML sanitizer for 서식 작성기 content (runs on the server before saving and before
 * rendering, and in the browser). Allowed: p, h1, h2, strong, em, u, ul, ol, li, br, hr, div, span;
 * the only attribute kept is `style="text-align: left|center|right|justify"`.
 * `b`/`i` are normalised to `strong`/`em`; everything else is unwrapped (text kept) or dropped
 * together with its content (script, style, …). Output is always well-formed.
 */

const ALLOWED = new Set(["p", "h1", "h2", "strong", "em", "u", "ul", "ol", "li", "br", "hr", "div", "span"]);
const ALIASES: Record<string, string> = { b: "strong", i: "em", h3: "h2", h4: "h2", h5: "h2", h6: "h2", section: "div", article: "div" };
const VOID = new Set(["br", "hr"]);
const ALIGNABLE = new Set(["p", "h1", "h2", "div", "li"]);
/** Elements that implicitly close an open <p> (as the HTML parser does). */
const CLOSES_P = new Set(["p", "h1", "h2", "div", "ul", "ol", "li", "hr"]);
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "noscript",
  "template",
  "svg",
  "math",
  "head",
  "title",
  "textarea",
  "select",
  "button",
  "canvas",
  "video",
  "audio",
  "frameset",
]);

export const MAX_DRAFT_HTML = 500_000;

// Linear-time tokenizer: no class may contain "<" (a run of "<" without ">" would otherwise be
// rescanned from every start position), and the lookahead keeps the tag name from handing
// characters over to the attribute part.
const TOKEN_RE =
  /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^<>]*>|<\?[^<>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(?![a-zA-Z0-9-])((?:[^<>"']|"[^"]*"|'[^']*')*)>/g;
const ENTITY_RE = /&(#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/y;

function escapeText(s: string) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else if (ch === "&") {
      ENTITY_RE.lastIndex = i;
      out += ENTITY_RE.test(s) ? "&" : "&amp;";
    } else out += ch;
  }
  return out;
}

function alignOf(attrs: string): string | null {
  const m = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  if (!m) return null;
  const style = (m[1] ?? m[2] ?? m[3] ?? "").toLowerCase();
  const a = /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify|start|end)\s*(?:!important\s*)?(?:;|$)/.exec(style);
  if (!a) return null;
  return a[1] === "start" ? "left" : a[1] === "end" ? "right" : a[1];
}

export function sanitizeDraftHtml(input: string): string {
  const html = String(input ?? "").slice(0, MAX_DRAFT_HTML * 2);
  const stack: { tag: string; start: number; content: number }[] = [];
  let out = "";
  const closeTop = () => {
    const top = stack.pop()!;
    // drop elements that were opened and immediately closed without any content
    if (top.tag === "p" && out.length === top.content) out = out.slice(0, top.start);
    else out += `</${top.tag}>`;
  };
  let dropTag: string | null = null;
  let dropDepth = 0;
  let last = 0;

  const emitText = (text: string) => {
    if (!dropTag && text) out += escapeText(text);
  };

  TOKEN_RE.lastIndex = 0;
  for (let m = TOKEN_RE.exec(html); m; m = TOKEN_RE.exec(html)) {
    emitText(html.slice(last, m.index));
    last = TOKEN_RE.lastIndex;
    const tagName = m[2];
    if (!tagName) continue; // comment / doctype / processing instruction
    const closing = m[1] === "/";
    const raw = tagName.toLowerCase();

    if (dropTag) {
      if (raw === dropTag) dropDepth += closing ? -1 : 1;
      if (dropDepth <= 0) dropTag = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(raw)) {
      if (!closing && !/\/\s*$/.test(m[3])) {
        dropTag = raw;
        dropDepth = 1;
      }
      continue;
    }

    const tag = ALIASES[raw] ?? raw;
    if (!ALLOWED.has(tag)) continue;

    if (!closing && CLOSES_P.has(tag)) {
      const pIdx = stack.findLastIndex((e) => e.tag === "p");
      if (pIdx !== -1) while (stack.length > pIdx) closeTop();
    }
    if (VOID.has(tag)) {
      if (!closing) out += `<${tag}>`;
      continue;
    }
    if (closing) {
      const idx = stack.findLastIndex((e) => e.tag === tag);
      if (idx === -1) continue;
      while (stack.length > idx) closeTop();
      continue;
    }
    const align = ALIGNABLE.has(tag) ? alignOf(m[3]) : null;
    const start = out.length;
    out += align ? `<${tag} style="text-align: ${align}">` : `<${tag}>`;
    stack.push({ tag, start, content: out.length });
    if (out.length > MAX_DRAFT_HTML) break;
  }
  if (last < html.length && out.length <= MAX_DRAFT_HTML) emitText(html.slice(last));
  while (stack.length) closeTop();
  return out;
}

/** Plain-text check: does the HTML contain any visible text or a divider? */
export function draftHasContent(html: string) {
  if (/<hr\b/i.test(html)) return true;
  return (
    html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;|&#160;/g, " ")
      .trim().length > 0
  );
}
