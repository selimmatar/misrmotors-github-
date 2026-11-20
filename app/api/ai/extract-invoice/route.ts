// Reads a supplier invoice photo into structured data. Claude reads it; the backup (Grok / Groq) reads it when Claude
// cannot (owner, 2026-11-21: Claude for all AI operations, Grok as the backup).
import { z } from "zod"
import { photoReaderReady, readPhoto } from "@/lib/photo-reader"
import { failed, NOT_SETUP_PHOTOS } from "@/lib/photo-read-failure"

export const maxDuration = 60

const invoiceDataSchema = z.object({
  supplierName: z.string(),
  invoiceNumber: z.string().nullish(),
  invoiceDate: z.string(),
  totalAmount: z.number(),
  items: z.array(
    z.object({
      productName: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      totalPrice: z.number(),
    }),
  ),
  paymentTerms: z.string().nullish(),
  dueDate: z.string().nullish(),
})

const INVOICE_SHAPE = `{
  "supplierName": "string",
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD",
  "totalAmount": number,
  "items": [{ "productName": "string", "quantity": number, "unitPrice": number, "totalPrice": number }],
  "paymentTerms": "string or null",
  "dueDate": "YYYY-MM-DD or null"
}`

export async function POST(req: Request) {
  try {
    const { fileData, mediaType } = await req.json()
    if (!fileData || typeof fileData !== "string") return Response.json({ error: "No invoice image was sent" }, { status: 400 })
    if (!photoReaderReady()) return Response.json({ error: NOT_SETUP_PHOTOS }, { status: 503 })

    const read = await readPhoto<unknown>({
      tag: "Invoice extraction",
      system: "You are an invoice data extraction assistant. Extract the invoice information from the photo. Only return the JSON object, no other text.",
      text: "Extract all invoice information from this document. Focus on supplier name, invoice details, line items with quantities and prices.",
      image: fileData.replace(/^data:[^,]*,/, ""),
      mediaType: mediaType || "image/png",
      jsonShape: INVOICE_SHAPE,
    })
    if (!read.ok) return failed(read.kind, read.why, "enter the invoice by hand")

    const validated = invoiceDataSchema.safeParse(read.data)
    if (!validated.success) {
      console.error("Invoice extraction: answer did not match the shape", validated.error.issues.slice(0, 3))
      return Response.json({ error: "Failed to parse invoice data" }, { status: 500 })
    }
    return Response.json({ extractedData: validated.data })
  } catch (error) {
    console.error("Invoice extraction error:", error)
    return Response.json({ error: "Failed to extract invoice data" }, { status: 500 })
  }
}
