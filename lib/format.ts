// Display formatting shared by the ERP building blocks. Presentation only: values are never rounded for storage.
import { keyToReadable } from "./i18n-fallback"

export type Lang = "en" | "ar"

const EMPTY = "—"
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export function formatDate(value: string | Date | null | undefined, lang: Lang): string {
  if (value === null || value === undefined || value === "") return EMPTY
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return EMPTY
  // A date-only string is a calendar day, not an instant: format it in UTC so it never shifts a day.
  const timeZone = typeof value === "string" && DATE_ONLY.test(value) ? "UTC" : undefined
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(date)
}

export function formatMoney(value: number | string | null | undefined, _lang: Lang): string {
  if (value === null || value === undefined || value === "") return EMPTY
  const n = Number(value)
  if (Number.isNaN(n)) return EMPTY
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatEnum(value: string | null | undefined, t: (key: string) => string): string {
  if (!value) return EMPTY
  const key = `enum.${value.toLowerCase()}`
  const label = t(key)
  if (label !== keyToReadable(key)) return label
  const words = value.replace(/[_-]/g, " ").toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function initials(name: string | null | undefined): string {
  const letters = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("")
  return letters || "?"
}
