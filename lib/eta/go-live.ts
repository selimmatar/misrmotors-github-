// Go-live date helpers: a local Cairo date "YYYY-MM-DD" -> midnight Africa/Cairo as an ISO string with its offset.
export function cairoMidnightIso(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  // Egypt is +02:00 in winter and +03:00 in summer; read the offset in force just before that midnight.
  const guess = new Date(Date.UTC(y, mo - 1, d) - 2 * 3600 * 1000)
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", timeZoneName: "longOffset" })
    .formatToParts(guess)
    .find((p) => p.type === "timeZoneName")?.value
  const om = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(part || "")
  if (!om) return null
  const offset = `${om[1]}${om[2].padStart(2, "0")}:${om[3] || "00"}`
  return `${m[1]}-${m[2]}-${m[3]}T00:00:00${offset}`
}

/** Only the CEO or an admin may set or change the go-live date (spec §9; the settings route checks it too). */
export const canSetGoLive = (roles: readonly string[]): boolean => roles.includes("ceo") || roles.includes("admin")

/** The stored go-live moment back as the local date "YYYY-MM-DD" it was set from ("" when not set). */
export const goLiveDate = (stored: string | null | undefined): string => /^\d{4}-\d{2}-\d{2}/.exec(String(stored ?? ""))?.[0] ?? ""

/** Today's local date in Cairo, "YYYY-MM-DD". */
export function cairoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

/** Tomorrow's local date in Cairo, "YYYY-MM-DD": the earliest go-live that may be set. */
export function cairoTomorrow(now: Date = new Date()): string {
  const [y, m, d] = cairoToday(now).split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** True once the stored go-live moment has passed: from then on it can no longer be changed or cleared. */
export function goLiveStarted(stored: string | null | undefined, now: Date = new Date()): boolean {
  const at = Date.parse(String(stored ?? "").trim())
  return Number.isFinite(at) && at <= now.getTime()
}
