// Fills {name} placeholders in a translated template. Unknown placeholders are left as they are.
// Translators may reorder placeholders; there is no plural engine (Arabic uses count-neutral wording).
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  )
}
