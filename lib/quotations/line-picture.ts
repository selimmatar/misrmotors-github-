// Quotation lines with pictures (owner request 2026-11-24: "send offers with pictures").
// Each quotation line may carry one picture, saved as sales_quotation_items.image_url (a Vercel Blob URL uploaded from
// the quotation form through /api/upload, shrunk on the phone first with lib/shrink-photo.ts). A line picked from the
// catalogue can instead use the product's own picture (the newest row of product_images for that product): the form
// sends with_product_picture: true and the server looks the picture up itself.
// The column comes from scripts/sql/2026-11-25-quote-pictures.sql; until it is applied the quotation is saved without
// pictures and the API answers pictures_not_saved: true so the form can say so.
// The print helpers below are shared by every quotation print (app/api/quotations/generate, the preview dialog, the
// approve dialog): a small thumbnail column, present only when at least one line has a picture.
import { hasColumn } from "@/lib/line-order"
import { escapeHtml } from "@/lib/html-escape"

export const QUOTE_PICTURE_COLUMN = "image_url"

export const hasQuotationPictureColumn = (db: any) => hasColumn(db, "sales_quotation_items", QUOTE_PICTURE_COLUMN)

/** A picture URL that is safe to save and print: http(s) or a same-site path, at most 2000 characters; otherwise null. */
export function cleanPictureUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const url = raw.trim()
  if (!url || url.length > 2000) return null
  if (/^https?:\/\/[^\s]+$/i.test(url)) return url
  if (/^\/(?!\/)[^\s]*$/.test(url)) return url
  return null
}

/** Whether the line asks for its product's saved picture. */
export function wantsProductPicture(item: any): boolean {
  return Boolean(item?.with_product_picture ?? item?.withProductPicture) && Boolean(item?.product_id)
}

/** The picture to show for a product: the newest of its product_images rows (any order in), or null. */
export function productPictureOf(images: { image_url?: string | null; created_at?: string | null; image_id?: number | null }[] | null | undefined): string | null {
  const usable = (images || []).filter((img) => cleanPictureUrl(img?.image_url))
  if (usable.length === 0) return null
  const newest = [...usable].sort((a, b) => {
    const byDate = String(b.created_at || "").localeCompare(String(a.created_at || ""))
    return byDate !== 0 ? byDate : Number(b.image_id || 0) - Number(a.image_id || 0)
  })[0]
  return cleanPictureUrl(newest.image_url)
}

/** product_id -> picture URL for the products whose lines ask for "with picture" (one query; errors = no pictures). */
export async function productPicturesFor(db: any, items: any[]): Promise<Map<number, string>> {
  const ids = [...new Set((items || []).filter(wantsProductPicture).map((i) => Number(i.product_id)).filter((n) => Number.isInteger(n) && n > 0))]
  const out = new Map<number, string>()
  if (ids.length === 0) return out
  try {
    const { data, error } = await db.from("product_images").select("image_id, product_id, image_url, created_at").in("product_id", ids)
    if (error || !data) return out
    for (const id of ids) {
      const url = productPictureOf(data.filter((r: any) => Number(r.product_id) === id))
      if (url) out.set(id, url)
    }
  } catch {
    // no pictures rather than no quotation
  }
  return out
}

/** The picture a line is saved with: its product's picture when "with picture" is ticked (and one exists), else its own. */
export function linePictureUrl(item: any, productPictures: Map<number, string>): string | null {
  if (wantsProductPicture(item)) {
    const fromProduct = productPictures.get(Number(item.product_id))
    if (fromProduct) return fromProduct
  }
  return cleanPictureUrl(item?.image_url ?? item?.imageUrl)
}

/** The column's value for a line being saved; {} while the column is missing. */
export function pictureField(item: any, withColumn: boolean, productPictures: Map<number, string>): Record<string, string | null> {
  if (!withColumn) return {}
  return { [QUOTE_PICTURE_COLUMN]: linePictureUrl(item, productPictures) }
}

/** Whether any line of a request carries (or asks for) a picture. */
export function anyLineWantsPicture(items: any[]): boolean {
  return (items || []).some((i) => wantsProductPicture(i) || cleanPictureUrl(i?.image_url ?? i?.imageUrl) !== null)
}

// ------------------------------------------------------------------------------------------------ printing

/** Whether the printed item table needs the picture column (at least one line has a usable picture). */
export function hasPictureColumn(items: any[]): boolean {
  return (items || []).some((i) => cleanPictureUrl(i?.image_url ?? i?.imageUrl) !== null)
}

/** Styles for the picture column; add only when hasPictureColumn() (the page stays byte-identical otherwise). */
export const QUOTE_PICTURE_CSS = `
tr:has(.q-pic) { break-inside: avoid; page-break-inside: avoid; }
.q-pic-col { inline-size: 80px; text-align: center; vertical-align: middle; }
.q-pic { display: block; inline-size: 68px; block-size: 68px; margin-inline: auto; object-fit: contain; border: 1px solid #d6d6d6; border-radius: 6px; background: #fff; }`

/** The header cell of the picture column ("" when no line has a picture). */
export function pictureHeadHtml(show: boolean, label = "صورة"): string {
  return show ? `<th class="pm-center q-pic-col" style="width: 80px;">${escapeHtml(label)}</th>` : ""
}

/** One line's picture cell ("" when the table has no picture column; an empty cell for a line without a picture). */
export function pictureCellHtml(show: boolean, rawUrl: unknown): string {
  if (!show) return ""
  const url = cleanPictureUrl(rawUrl)
  return `<td class="q-pic-col">${url ? `<img class="q-pic" src="${escapeHtml(url)}" alt="" loading="eager">` : ""}</td>`
}

/**
 * Script for a print window opened with document.write: prints once every picture has loaded (or failed), so the
 * paper copy is not printed with blank thumbnails. Use instead of an immediate window.print().
 */
export function printWhenPicturesLoaded(win: Window): void {
  const doc = win.document
  const pending = Array.prototype.slice.call(doc.images || []).filter((img: HTMLImageElement) => !img.complete)
  if (pending.length === 0) {
    win.print()
    return
  }
  let left = pending.length
  let done = false
  const finish = () => {
    if (done) return
    done = true
    win.print()
  }
  pending.forEach((img: HTMLImageElement) => {
    const one = () => {
      left -= 1
      if (left <= 0) finish()
    }
    img.addEventListener("load", one, { once: true })
    img.addEventListener("error", one, { once: true })
  })
  // never wait for ever on a slow network
  win.setTimeout(finish, 4000)
}
