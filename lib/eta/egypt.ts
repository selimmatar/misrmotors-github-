// Egypt-specific reference data and number cleaning for the e-invoice fields.
export const GOVERNORATES: { ar: string; en: string }[] = [
  { en: "Cairo", ar: "القاهرة" }, { en: "Giza", ar: "الجيزة" }, { en: "Alexandria", ar: "الإسكندرية" },
  { en: "Qalyubia", ar: "القليوبية" }, { en: "Sharqia", ar: "الشرقية" }, { en: "Dakahlia", ar: "الدقهلية" },
  { en: "Gharbia", ar: "الغربية" }, { en: "Monufia", ar: "المنوفية" }, { en: "Beheira", ar: "البحيرة" },
  { en: "Kafr El Sheikh", ar: "كفر الشيخ" }, { en: "Damietta", ar: "دمياط" }, { en: "Port Said", ar: "بورسعيد" },
  { en: "Ismailia", ar: "الإسماعيلية" }, { en: "Suez", ar: "السويس" }, { en: "Faiyum", ar: "الفيوم" },
  { en: "Beni Suef", ar: "بني سويف" }, { en: "Minya", ar: "المنيا" }, { en: "Asyut", ar: "أسيوط" },
  { en: "Sohag", ar: "سوهاج" }, { en: "Qena", ar: "قنا" }, { en: "Luxor", ar: "الأقصر" },
  { en: "Aswan", ar: "أسوان" }, { en: "Red Sea", ar: "البحر الأحمر" }, { en: "New Valley", ar: "الوادي الجديد" },
  { en: "Matrouh", ar: "مطروح" }, { en: "North Sinai", ar: "شمال سيناء" }, { en: "South Sinai", ar: "جنوب سيناء" },
]

export const toLatinDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))

function digits(s: string, n: number): string | null {
  const v = toLatinDigits(String(s ?? "")).replace(/[\s-]/g, "")
  return new RegExp(`^\\d{${n}}$`).test(v) ? v : null
}
export const cleanTaxNumber = (s: string): string | null => digits(s, 9)
export const cleanNationalId = (s: string): string | null => digits(s, 14)

/** Cleaned value when valid; otherwise the text as typed plus a warning (never refuse a save). */
export function taxField(field: string, raw: unknown, clean: (s: string) => string | null, len: number, warnings: string[]): string {
  const typed = String(raw ?? "").trim()
  if (!typed) return ""
  const c = clean(typed)
  if (c === null) {
    warnings.push(`${field}: must be ${len} digits`)
    return typed
  }
  return c
}
