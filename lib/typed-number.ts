// A number typed into a box: Arabic or English digits, a decimal point or comma (owner report, 2026-11-12: the PO
// exchange cost box would not take Arabic digits or a cleared value). Empty or unreadable = 0.
import { toEnglishDigits } from "@/lib/po-requests/read-prices"

export const typedNumber = (text: string): number => {
  const clean = toEnglishDigits(String(text ?? "")).replace(/[٫,]/g, ".").replace(/[^\d.]/g, "")
  const n = Number(clean)
  return Number.isFinite(n) ? n : 0
}
