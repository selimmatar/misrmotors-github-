// Puts several JPEG photos into one PDF, one photo per page (each page sized to fit within A4, keeping the photo's
// shape), so a supplier's price sheet photographed page by page is saved as a single file.
export interface PdfPhoto {
  jpeg: Uint8Array
  width: number
  height: number
}

const A4_WIDTH = 595
const A4_HEIGHT = 842

export function photosToPdf(photos: PdfPhoto[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length
    push(`${id} 0 obj\n${body}\n`)
    if (stream) {
      push("stream\n")
      push(stream)
      push("\nendstream\n")
    }
    push("endobj\n")
  }

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
  // objects: 1 catalog, 2 page list, then per photo: page, image, drawing
  const pageIds = photos.map((_, i) => 3 + i * 3)
  object(1, "<< /Type /Catalog /Pages 2 0 R >>")
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${photos.length} >>`)
  photos.forEach((photo, i) => {
    const [pageId, imageId, drawId] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2]
    const scale = Math.min(A4_WIDTH / photo.width, A4_HEIGHT / photo.height)
    const w = Math.round(photo.width * scale * 100) / 100
    const h = Math.round(photo.height * scale * 100) / 100
    const draw = encoder.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`)
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${drawId} 0 R >>`,
    )
    object(
      imageId,
      `<< /Type /XObject /Subtype /Image /Width ${photo.width} /Height ${photo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${photo.jpeg.length} >>`,
      photo.jpeg,
    )
    object(drawId, `<< /Length ${draw.length} >>`, draw)
  })

  const count = 3 + photos.length * 3
  const xref = length
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`)
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}
