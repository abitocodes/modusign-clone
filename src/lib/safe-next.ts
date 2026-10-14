/**
 * `?next=` after login must stay on this site. The WHATWG URL parser treats "\" like "/" and
 * drops TAB / CR / LF, so "/\evil.com" or "/\t/evil.com" would resolve to another origin even
 * though they start with a single "/". Accept only plain same-origin paths.
 */
const ORIGIN = "http://app.internal";
// one leading "/", not followed by "/" or "\"; no backslash, whitespace or control characters
const SAFE_PATH_RE = /^\/(?![/\\])[^\\\s\u0000-\u001f\u007f]*$/;

export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 2048 || !SAFE_PATH_RE.test(raw)) return "/";
  let url: URL;
  try {
    url = new URL(raw, ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== ORIGIN) return "/";
  return url.pathname + url.search + url.hash;
}
