// Shared by the module-migration guard and the frame test. Relative imports only (the test runner compiles to CJS).

const NAMES = [
  "sales-order", "sales-quotation", "sales-quotations-hub", "approve-sales-orders", "approve-sales-quotations",
  "delivery-permits", "customer", "lost-sales", "accounts-receivable", "accounts-payable", "payment-schedule",
  "balance", "maintenance-invoices", "accountant",
]

// The 14 Sales + Finance module files PR 1b migrates, plus the embedded maintenance-invoice tab.
export const MODULES: readonly string[] = [
  ...NAMES.map((n) => `components/modules/${n}-module.tsx`),
  "components/accounting/maintenance-invoice-tab.tsx",
]

// What a presentation-only migration must not change: API calls, handler names, id/name attributes, fetch and
// toISOString calls. `t` and `onClick` may only grow.
export type Surface = { api: string[]; handlers: string[]; ids: string[]; fetch: number; iso: number; t: number; onClick: number }

const RE = {
  api: /["'`]\/api\/[^"'`]*/g,
  handlers: /\bhandle[A-Z]\w*/g,
  ids: /\b(?:id|name)=(?:"[^"]*"|\{`[^`]*`\}|\{"[^"]*"[^}]*\})/g,
  fetch: /\bfetch\(/g,
  iso: /\.toISOString\(\)/g,
  t: /\bt\(/g,
  onClick: /\bonClick=/g,
}

const all = (src: string, re: RegExp): string[] => src.match(re) ?? []

export function protectedSurface(src: string): Surface {
  return {
    api: all(src, RE.api).sort(),
    handlers: [...new Set(all(src, RE.handlers))].sort(),
    ids: all(src, RE.ids).sort(),
    fetch: all(src, RE.fetch).length,
    iso: all(src, RE.iso).length,
    t: all(src, RE.t).length,
    onClick: all(src, RE.onClick).length,
  }
}

// Physical (left/right) classes. Catches border-r and border-r-2; ignores border-red-500, side="left", aria-* and
// ms-/me-/start-/end-.
export const RTL_BAD = /(?<![\w-])(?:(?:ml|mr|pl|pr|left|right)-[\w[]|text-(?:left|right)\b|(?:border|rounded)-[lr]\b|flex-row\b)/

// Patterns a migrated module must no longer contain (unless an ALLOW entry says how many are expected).
export const BANNED: Record<string, RegExp> = {
  formatCurrency: /\bformatCurrency\(/g,
  toLocaleDateString: /\.toLocaleDateString\(/g,
  statusHelper: /\b(?:getStatusColor|getStatusBadge|statusColors)\b/g,
  egpLiteral: /toFixed\(2\)[^\n]{0,8}EGP/g,
}
