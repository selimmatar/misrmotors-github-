// The signed delivery-permit copies the shipping team uploaded (delivery_permit_files, file_type SIGNED_PERMIT, a public
// Vercel Blob URL each; app/api/delivery-permits/upload/route.ts), as e-mail attachments (owner request 2026-11-24):
// per permit, its JPEG photos become ONE PDF (lib/photos-to-pdf.ts, one photo per page); an uploaded PDF goes as it is;
// another image type (PNG, WEBP, HEIC...) can't be turned into a PDF without an image library and goes as it is.
// A permit with no upload is reported as "not uploaded". What does not fit in the size budget is linked instead.
import { photosToPdf, type PdfPhoto } from "../photos-to-pdf"
import { isMissingRelation } from "../po-bill"
import type { MailAttachment } from "../email/smtp"

type Db = any

/** One downloaded file: its bytes and the type the server said. */
export type FetchFile = (url: string) => Promise<{ bytes: Buffer; type: string }>
export const SIGNED_FILE_MAX_BYTES = 12 * 1024 * 1024
export const SIGNED_FILE_TIMEOUT_MS = 15_000

/** Downloads one https file (at most 12 MB, 15 s). */
export const defaultFetchFile: FetchFile = async (url) => {
  if (!/^https:\/\//i.test(url)) throw new Error("not an https address")
  const res = await fetch(url, { signal: AbortSignal.timeout(SIGNED_FILE_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`download answered ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > SIGNED_FILE_MAX_BYTES) throw new Error("file too large")
  return { bytes, type: res.headers.get("content-type") || "" }
}

/** Width, height and colour channels of a baseline / progressive JPEG (its SOF marker); null when it isn't one. */
export function jpegInfo(b: Uint8Array): { width: number; height: number; components: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null
    const marker = b[i + 1]
    if (marker === 0xff) { i++; continue }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
    const len = (b[i + 2] << 8) | b[i + 3]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = (b[i + 5] << 8) | b[i + 6]
      const width = (b[i + 7] << 8) | b[i + 8]
      return width > 0 && height > 0 ? { width, height, components: b[i + 9] } : null
    }
    if (len < 2) return null
    i += 2 + len
  }
  return null
}

const isPdf = (b: Buffer) => b.subarray(0, 5).toString("latin1") === "%PDF-"
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60) || "file"
const extOf = (name: string, type: string) => {
  const m = /\.([A-Za-z0-9]{2,5})$/.exec(name)
  if (m) return m[1].toLowerCase()
  return type.split("/")[1]?.split(";")[0] || "bin"
}

export interface SignedCopy {
  permitId: number
  /** attached: all of it is attached; linked: (partly) too big, see urls; not_uploaded; failed: could not be downloaded */
  state: "attached" | "linked" | "not_uploaded" | "failed"
  attachments: MailAttachment[]
  /** the uploaded files' own addresses, for "linked" / "failed" */
  urls: string[]
}

/** The signed copies of these permits as attachments (one PDF per permit for its photos). Never throws. */
export async function signedPermitCopies(
  db: Db,
  permits: { permit_id: number; permit_no?: string | null }[],
  fetchFile: FetchFile = defaultFetchFile,
  /** only these uploaded files (the person's choice when a permit has several; owner request 2026-11-26); omitted: all */
  onlyFileIds?: number[],
): Promise<SignedCopy[]> {
  const ids = permits.map((p) => Number(p.permit_id))
  let files: any[] = []
  if (ids.length) {
    const r = await db.from("delivery_permit_files").select("file_id, permit_id, file_type, file_url, file_name, uploaded_at").in("permit_id", ids)
    if (r.error && !isMissingRelation(r.error)) console.error(`[email] signed permit files: ${r.error.message || r.error}`)
    files = ((r.error ? [] : r.data) || []).filter((f: any) => String(f.file_type || "").toUpperCase() === "SIGNED_PERMIT" && /^https:\/\//i.test(String(f.file_url || "")))
    if (onlyFileIds) {
      const keep = new Set(onlyFileIds.map(Number))
      files = files.filter((f: any) => keep.has(Number(f.file_id)))
    }
  }
  const out: SignedCopy[] = []
  for (const p of permits) {
    const mine = files.filter((f) => Number(f.permit_id) === Number(p.permit_id)).sort((a, b) => Number(a.file_id) - Number(b.file_id))
    const urls = mine.map((f) => String(f.file_url))
    if (!mine.length) { out.push({ permitId: Number(p.permit_id), state: "not_uploaded", attachments: [], urls }); continue }
    const name = `signed-${safe(String(p.permit_no || `DP-${p.permit_id}`))}`
    const attachments: MailAttachment[] = []
    const photos: PdfPhoto[] = []
    let failed = false
    for (const [n, f] of mine.entries()) {
      try {
        const { bytes, type } = await fetchFile(String(f.file_url))
        const jpeg = jpegInfo(bytes)
        if (isPdf(bytes)) attachments.push({ filename: `${name}${mine.length > 1 ? `-${n + 1}` : ""}.pdf`, content: bytes, contentType: "application/pdf" })
        else if (jpeg && jpeg.components === 3) photos.push({ jpeg: new Uint8Array(bytes), width: jpeg.width, height: jpeg.height })
        else attachments.push({ filename: `${name}-${n + 1}.${safe(extOf(String(f.file_name || ""), type))}`, content: bytes, contentType: type.split(";")[0] || "application/octet-stream" })
      } catch (e: any) {
        console.error(`[email] signed copy of permit ${p.permit_id} could not be downloaded: ${e?.message || e}`)
        failed = true
      }
    }
    if (photos.length) attachments.unshift({ filename: `${name}.pdf`, content: Buffer.from(photosToPdf(photos)), contentType: "application/pdf" })
    out.push({ permitId: Number(p.permit_id), state: failed ? "failed" : "attached", attachments, urls })
  }
  return out
}

/**
 * Keeps attachments while their total stays within `budget` bytes (the portal PDF is counted first by the caller); a
 * permit's copy that does not fit is dropped and marked "linked" (its file addresses go in the e-mail instead).
 */
export function fitAttachments(copies: SignedCopy[], budget: number): SignedCopy[] {
  let left = budget
  return copies.map((c) => {
    if (!c.attachments.length) return c
    const size = c.attachments.reduce((n, a) => n + a.content.length, 0)
    if (size <= left) { left -= size; return c }
    return { ...c, state: "linked", attachments: [] }
  })
}
