// Rules for editing, switching off and deleting HR employees. Pure functions; app/api/hr/employees/route.ts saves.

export const EMPLOYMENT_STATUSES = ["active", "on_leave", "suspended", "terminated", "resigned"] as const
/** Statuses that mean the person is not working now. Moving into one switches off their linked login. */
export const INACTIVE_STATUSES = ["suspended", "terminated", "resigned"] as const
/** Statuses that mean the person has left; these carry a leaving date. */
const LEFT_STATUSES = ["terminated", "resigned"]
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"]

export function isInactiveStatus(status: unknown): boolean {
  return (INACTIVE_STATUSES as readonly string[]).includes(String(status))
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

const TEXT_FIELDS = ["full_name", "email", "phone", "national_id", "termination_reason"] as const

/** Keeps only the fields the Edit form may change, tidied. Unknown fields (ids, joined objects, numbers) are dropped. */
export function cleanEmployeeUpdate(body: unknown): Checked<Record<string, unknown>> {
  if (!body || typeof body !== "object") return { ok: false, error: "Missing details" }
  const b = body as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const f of TEXT_FIELDS) {
    if (b[f] === undefined) continue
    const v = b[f] === null ? "" : String(b[f]).trim()
    out[f] = v === "" && f !== "full_name" ? null : v
  }
  if (out.full_name !== undefined && !out.full_name) return { ok: false, error: "Name is required" }
  if (b.hire_date !== undefined) {
    const d = String(b.hire_date || "")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, error: "Hire date is required" }
    out.hire_date = d
  }
  for (const f of ["department_id", "position_id"] as const) {
    if (b[f] === undefined) continue
    if (b[f] === null || b[f] === "") { out[f] = null; continue }
    const n = Number(b[f])
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: `Invalid ${f.replace("_id", "")}` }
    out[f] = n
  }
  if (b.employment_type !== undefined) {
    if (!EMPLOYMENT_TYPES.includes(String(b.employment_type))) return { ok: false, error: "Invalid employment type" }
    out.employment_type = String(b.employment_type)
  }
  if (b.employment_status !== undefined) {
    if (!(EMPLOYMENT_STATUSES as readonly string[]).includes(String(b.employment_status))) return { ok: false, error: "Invalid status" }
    out.employment_status = String(b.employment_status)
  }
  return { ok: true, value: out }
}

/** Leaving date follows the status: set on leaving, cleared on coming back, untouched otherwise. */
export function statusDates(prev: unknown, next: unknown, today: string): { termination_date?: string | null } {
  const wasLeft = LEFT_STATUSES.includes(String(prev))
  const isLeft = LEFT_STATUSES.includes(String(next))
  if (isLeft && !wasLeft) return { termination_date: today }
  if (!isLeft && wasLeft) return { termination_date: null }
  return {}
}

export interface EmployeeHistory {
  salaryPayments: number
  payRecords: number
  documents: number
  logins: number
}

/** Why this employee cannot be deleted (keep them as Inactive instead), or null when deleting is safe. */
export function deleteBlocker(h: EmployeeHistory): string | null {
  const parts: string[] = []
  if (h.salaryPayments) parts.push(`${h.salaryPayments} salary payment(s)`)
  if (h.payRecords) parts.push(`${h.payRecords} pay record(s)`)
  if (h.documents) parts.push(`${h.documents} document(s)`)
  if (h.logins) parts.push(`a login in User Management`)
  if (!parts.length) return null
  return `This employee has ${parts.join(", ")}. Make them Inactive instead so the history is kept.`
}
