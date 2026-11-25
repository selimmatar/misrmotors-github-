import { createHash, timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"

// The password asked before anything goes to the tax portal (owner request 2026-11-25): Send / Send all ready / Send
// again / Credit note / Cancel on portal. The value lives only in the ETA_SEND_PIN setting on the server, never in the
// code. When that setting is empty no password is asked (so a missing setting never blocks invoicing).

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest()

/** true when the body's `pin` matches ETA_SEND_PIN (or no password is set). */
export function portalPinOk(body: unknown, env: { ETA_SEND_PIN?: string } = process.env as { ETA_SEND_PIN?: string }): boolean {
  const want = String(env.ETA_SEND_PIN || "").trim()
  if (!want) return true
  const got = body && typeof body === "object" && typeof (body as any).pin === "string" ? (body as any).pin.trim() : ""
  return timingSafeEqual(digest(got), digest(want))
}

/** The 403 answer for a missing or wrong password, or null when it is right. */
export function portalPinRefusal(body: unknown, env?: { ETA_SEND_PIN?: string }): NextResponse | null {
  if (portalPinOk(body, env)) return null
  return NextResponse.json(
    { error: "Wrong password. Nothing was sent to the portal.", errorAr: "كلمة المرور غير صحيحة. لم يتم إرسال أي شيء إلى البوابة.", code: "wrong_pin" },
    { status: 403 },
  )
}
