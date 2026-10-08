// Shared upload validation for every route that accepts a user file (receipts, invoices, signed permits, photos,
// reports, approval documents, quotation / PO requests, supplier quotes).
// Extension AND (when the browser sent one) the MIME type must match. SVG/HTML are deliberately not allowed.
// Moved verbatim from app/api/upload/route.ts so all upload routes apply exactly the same rule.

export const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  jpg: ["image/jpeg", "image/pjpeg", "image/jpg"],
  jpeg: ["image/jpeg", "image/pjpeg", "image/jpg"],
  png: ["image/png"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  heic: ["image/heic", "image/heif"],
  heif: ["image/heif", "image/heic"],
  doc: ["application/msword"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10MB
export const UNSUPPORTED_UPLOAD_MESSAGE = "Unsupported file type. Allowed: PDF, JPG, PNG, GIF, WEBP, HEIC, DOC, DOCX"

export interface UploadOptions {
  /** Per-route extra extension -> MIME list, merged over the shared allowlist (no route needs one today). */
  extraTypes?: Record<string, string[]>
  /** Per-route size cap in bytes (defaults to MAX_UPLOAD_BYTES). */
  maxBytes?: number
}

export type UploadRejection = { status: 413 | 415; error: string }

/** Returns null when the file may be stored, otherwise the HTTP status + message to answer with. */
export function checkUpload(
  file: { name?: string; size: number; type?: string },
  options: UploadOptions = {},
): UploadRejection | null {
  const maxSize = options.maxBytes ?? MAX_UPLOAD_BYTES
  if (file.size > maxSize) {
    return { status: 413, error: `File too large. Maximum size is ${maxSize / 1024 / 1024}MB` }
  }

  const types = options.extraTypes ? { ...ALLOWED_UPLOAD_TYPES, ...options.extraTypes } : ALLOWED_UPLOAD_TYPES
  const ext = String(file.name || "").split(".").pop()?.toLowerCase() || ""
  const allowedMimes = Object.prototype.hasOwnProperty.call(types, ext) ? types[ext] : undefined
  const mime = String(file.type || "").toLowerCase()
  if (!allowedMimes || (mime && mime !== "application/octet-stream" && !allowedMimes.includes(mime))) {
    return { status: 415, error: UNSUPPORTED_UPLOAD_MESSAGE }
  }
  return null
}
