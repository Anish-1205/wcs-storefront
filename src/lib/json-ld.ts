/**
 * Safely serializes a JSON-LD object for a <script type="application/ld+json">
 * tag. Escapes "<" so admin-authored text (product/collection name or
 * description) containing a literal "</script>" can't break out of the tag —
 * defense in depth, since this data is admin-only today but the escaping
 * costs nothing and removes the assumption entirely.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
