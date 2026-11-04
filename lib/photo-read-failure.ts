import { NextResponse } from "next/server"
import type { ReadFailure } from "./photo-reader"
/** The screen message for a failed read; `instead` = what the person can do by hand. */
export function failed(kind: ReadFailure, why: string, instead: string) {
  if (kind === "not_setup") return NextResponse.json({ error: "Reading photos is not set up yet (GEMINI_API_KEY or GROQ_API_KEY is missing)" }, { status: 503 })
  if (kind === "key_rejected") return NextResponse.json({ error: "Reading photos is not set up correctly (the API key was rejected)", detail: why }, { status: 503 })
  if (kind === "limit") return NextResponse.json({ error: `The free photo-reading limit was reached. Please try again later or ${instead}.`, detail: why }, { status: 429 })
  if (kind === "timeout") return NextResponse.json({ error: `Reading the photo took too long. Please try again or ${instead}.`, detail: why }, { status: 504 })
  return NextResponse.json({ error: `The photo could not be read. Please try again or ${instead}.`, detail: why }, { status: 502 })
}
