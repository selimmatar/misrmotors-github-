import { NextRequest, NextResponse } from "next/server"
import { docLinkSecret, verifyDocLink } from "@/lib/doc-links"
import { escapeHtml } from "@/lib/html-escape"
import * as invoicePrint from "@/app/api/invoices/ar/[id]/pdf/route"
import * as salesOrderPrint from "@/app/api/sales-orders/print/route"
import * as permitPrint from "@/app/api/delivery-permits/pdf/route"

export const dynamic = "force-dynamic"

// GET /api/doc-link/<token>: the print of exactly ONE document, for the customer's e-invoice e-mail (owner request
// 2026-11-24). Public path (no login, lib/auth/permissions.ts PUBLIC_PREFIXES): the token is signed with
// DOC_LINK_SECRET (lib/doc-links.ts) and names the kind, the id and the expiry, so it opens only that document,
// read-only, for 180 days. It renders the same print page the staff use (customer invoice, sales order, delivery
// permit) and nothing else: no query string of the caller is passed on, and only an HTML print comes back.
const page = (status: number, ar: string, en: string) =>
  new NextResponse(
    `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="robots" content="noindex"><title>${escapeHtml(en)}</title></head>
<body style="font-family: Tahoma, Arial, sans-serif; padding: 60px; text-align: center; color: #333;">
<h2>${escapeHtml(ar)}</h2><p dir="ltr">${escapeHtml(en)}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  )

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const check = verifyDocLink(token, docLinkSecret())
  if (!check.ok) {
    if (check.reason === "expired") return page(410, "انتهت صلاحية هذا الرابط.", "This link has expired.")
    if (check.reason === "not_configured") return page(503, "الروابط غير متاحة حاليًا.", "Links are not available right now.")
    return page(404, "الرابط غير صحيح.", "This link is not valid.")
  }
  const origin = new URL(request.url).origin
  const inner = (path: string): any => {
    const url = `${origin}${path}`
    const r: any = new NextRequest(url)
    // the print routes read request.nextUrl (for the logo)
    if (!r.nextUrl) Object.assign(r, { nextUrl: new URL(url) })
    return r
  }
  let res: Response
  try {
    if (check.kind === "invoice") res = await invoicePrint.GET(inner(`/api/invoices/ar/${check.id}/pdf`), { params: Promise.resolve({ id: String(check.id) }) })
    else if (check.kind === "sales-order") res = await salesOrderPrint.GET(inner(`/api/sales-orders/print?soId=${check.id}`))
    else res = await permitPrint.GET(inner(`/api/delivery-permits/pdf?permitId=${check.id}`))
  } catch (e: any) {
    console.error(`[doc-link] ${check.kind} ${check.id} failed: ${e?.message || e}`)
    return page(500, "تعذر عرض المستند.", "The document could not be shown.")
  }
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html"))
    return page(res.status === 404 ? 404 : 500, "المستند غير متاح.", "This document is not available.")
  return new NextResponse(await res.text(), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" },
  })
}
