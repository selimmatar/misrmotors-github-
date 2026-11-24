/** Escapes text for an HTML text or attribute position. Null/undefined become "". Pure; safe in routes and the browser. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      default:
        return "&#39;"
    }
  })
}

/**
 * Escapes a left-to-right value (phone, fax, e-mail) and wraps it in an LTR bidi isolate, so an RTL (Arabic) page
 * does not reorder its parts: "+20 100 945 5019" would otherwise print as "5019 945 100 20+".
 */
export function ltrText(value: unknown): string {
  return `<bdi dir="ltr">${escapeHtml(value)}</bdi>`
}
