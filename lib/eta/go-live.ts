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
