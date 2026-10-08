import { put } from "@vercel/blob"
import { NextResponse } from "next/server"

// Only the file kinds the UI really uploads (receipts, invoices, signed permits, photos, reports, approval documents).
// Extension AND (when the browser sent one) the MIME type must match. SVG/HTML are deliberately not allowed.
const ALLOWED_TYPES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  jpg: ["image/jpeg", "image/pjpeg"],
  jpeg: ["image/jpeg", "image/pjpeg"],
  png: ["image/png"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  heic: ["image/heic", "image/heif"],
  heif: ["image/heif", "image/heic"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      console.error("Upload API: No file provided in request")
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }


    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      console.error("Upload API: File too large", file.size, "max:", maxSize)
      return NextResponse.json(
        { error: `File too large. Maximum size is ${maxSize / 1024 / 1024}MB` },
        { status: 413 }
      )
    }

    const ext = String(file.name || "").split(".").pop()?.toLowerCase() || ""
    const allowedMimes = Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, ext) ? ALLOWED_TYPES[ext] : undefined
    const mime = String(file.type || "").toLowerCase()
    if (!allowedMimes || (mime && mime !== "application/octet-stream" && !allowedMimes.includes(mime))) {
      return NextResponse.json(
        { error: "Unsupported file type. Allowed: PDF, JPG, PNG, GIF, WEBP, HEIC, DOC, DOCX" },
        { status: 415 },
      )
    }

    // Convert file to Buffer for upload
    const buffer = await file.arrayBuffer()
    const timestamp = Date.now()
    const safeName = `${timestamp}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`


    const blob = await put(safeName, buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType: file.type,
    })


    return NextResponse.json({ url: blob.url })
  } catch (error: any) {
    console.error("Upload API: Error occurred", {
      message: error?.message,
      code: error?.code,
      status: error?.status,
      error: error?.toString(),
      fullError: error,
    })

    const errorMessage = error?.message || error?.error?.message || "Failed to upload file to storage"

    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
