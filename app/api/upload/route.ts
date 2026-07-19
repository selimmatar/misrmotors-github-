import { put } from "@vercel/blob"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      console.error("[v0] Upload API: No file provided in request")
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }


    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      console.error("[v0] Upload API: File too large", file.size, "max:", maxSize)
      return NextResponse.json(
        { error: `File too large. Maximum size is ${maxSize / 1024 / 1024}MB` },
        { status: 413 }
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
    console.error("[v0] Upload API: Error occurred", {
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
