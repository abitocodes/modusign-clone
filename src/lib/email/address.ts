/**
 * E-mail address validation shared by the browser and the server.
 *
 * The pattern splits the domain into dot-separated labels that cannot contain a dot themselves,
 * so a match is found (or rejected) in linear time — the former `[^\s@]+\.[^\s@]{2,}` backtracked
 * quadratically over long runs of dots. Always check the length first (`isValidEmail`).
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[^\s@.]{2,}$/;

export const MAX_EMAIL_LENGTH = 254;

export function isValidEmail(v: unknown): boolean {
  return typeof v === "string" && v.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(v);
}

/**
 * Person names end up in mail headers and PDFs: strip control characters and the characters that
 * carry meaning in an address list (`"<>,;`), collapse whitespace.
 */
export function cleanPersonName(v: unknown, max = 50) {
  return String(v ?? "")
    .replace(/[\u0000-\u001f\u007f"<>,;\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
