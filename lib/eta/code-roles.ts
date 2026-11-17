// Who decides item codes (owner, 2026-11-17): only the accountant (and the CEO / admin, who always pass). Every route
// that confirms a line's code, changes the remembered names or edits the item codes checks this itself, on top of the
// /api/eta rule; the screens show codes read-only to anyone else.
export const CODE_DECIDERS = ["accountant", "ceo", "admin"] as const

/** The roles the auth middleware put on the request (x-mm-roles, comma separated). */
export const requestRoles = (request: Request): string[] =>
  (request.headers.get("x-mm-roles") || "").split(",").map((r) => r.trim()).filter(Boolean)

export const canDecideCodes = (roles: readonly string[]): boolean => roles.some((r) => (CODE_DECIDERS as readonly string[]).includes(r))

export const CODE_DECIDERS_ONLY = {
  error: "Codes are confirmed by the accountant.",
  errorAr: "الأكواد يعتمدها المحاسب.",
}

/** null when the request may change codes; else the 403 body. */
export const codeChangeRefusal = (request: Request): typeof CODE_DECIDERS_ONLY | null => (canDecideCodes(requestRoles(request)) ? null : CODE_DECIDERS_ONLY)
