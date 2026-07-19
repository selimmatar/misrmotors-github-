import { put } from "@vercel/blob"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const filename = searchParams.get("filename")
    
    if (!filename) {
      return NextResponse.json({ error: "Filename is required" }, { status: 400 })
    }
    
    
    // Get content-length from request headers
    const contentLength = request.headers.get("content-length")
    
    if (!contentLength) {
      return NextResponse.json({ error: "Content-Length header is required" }, { status: 400 })
    }
    
    
    // Upload with proper options including content-length
    const blob = await put(`hr-documents/${Date.now()}-${filename}`, request.body!, {
      access: "public",
      addRandomSuffix: false,
      contentType: request.headers.get("content-type") || "application/octet-stream",
    })
    
    
    return NextResponse.json({ url: blob.url })
  } catch (error) {
    console.error("Error uploading document:", error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : "Failed to upload file" 
    }, { status: 500 })
  }
}
