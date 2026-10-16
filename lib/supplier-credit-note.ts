// The note stored on the remainder row when a supplier credit is split across a purchase order.
// It is saved in English (DB data); the supplier card parses it back to show it in the user's language.
const PATTERN = /^Remainder of credit #(\d+) after ([\d.]+) was applied to (\S+)$/

export function remainderNote(creditId: number, amount: number, poNumber: string): string {
  return `Remainder of credit #${creditId} after ${amount.toFixed(2)} was applied to ${poNumber}`
}

export function parseRemainderNote(notes: string | null | undefined): { creditId: string; amount: string; poNumber: string } | null {
  const m = PATTERN.exec(String(notes ?? ""))
  return m ? { creditId: m[1], amount: m[2], poNumber: m[3] } : null
}
